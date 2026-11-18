import { getDb } from "@/db";
import type { SessionUser } from "@/lib/auth";
import {
  GRADE_LOCKED_MESSAGE,
  assembleGradeSheet,
  createPublicationSnapshot,
  recomputeComputedOveralls,
  teachingClassGradeState,
  type GradeItemSummary,
  type GradeLock,
  type GradeSheet,
} from "@/lib/grade-sheet";
import {
  MAX_SCORE,
  MAX_WEIGHT,
  parseDecimal,
  parseStoredDecimal,
  scaledToNumber,
  scaledToText,
} from "@/lib/grade-values";
import { isUniqueViolation } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";
import { findTeachingClass } from "@/lib/teaching-classes";

export { GRADE_LOCKED_MESSAGE } from "@/lib/grade-sheet";
export type {
  GradeItemSummary,
  GradeLock,
  GradeSheet,
  GradeSheetStudent,
  OverallSummary,
} from "@/lib/grade-sheet";

const LOCKED_PUBLISH_MESSAGE =
  "该教学班成绩已发布并锁定，如需重新发布请先由教务管理员解锁。";

/** 读取整张成绩表；装配与总评规则由成绩表 module 拥有。 */
export async function getGradeSheet(
  teachingClassId: string,
): Promise<GradeSheet | null> {
  const teachingClass = await findTeachingClass(teachingClassId);
  if (!teachingClass) return null;
  return assembleGradeSheet(getDb(), teachingClass);
}

type LogInput = {
  teachingClassId: string;
  studentId: string | null;
  gradeItemId: string | null;
  target: "grade_item" | "overall" | "teaching_class";
  action:
    | "record"
    | "update"
    | "override_overall"
    | "cancel_override"
    | "publish"
    | "unlock";
  actorAccountId: string;
  oldScaled: number | null;
  newScaled: number | null;
  reason?: string | null;
};

/**
 * 成绩变更日志：录入/修改成绩项、覆盖/取消覆盖总评都留痕。
 * 系统按公式重算总评不算人工变更，因此不写日志。
 */
async function insertGradeChangeLog(
  tx: import("postgres").TransactionSql,
  input: LogInput,
): Promise<void> {
  await tx`
    insert into grade_change_logs (
      teaching_class_id, student_id, grade_item_id, target, action,
      actor_account_id, old_value, new_value, reason
    )
    values (
      ${input.teachingClassId}, ${input.studentId}, ${input.gradeItemId},
      ${input.target}, ${input.action}, ${input.actorAccountId},
      ${input.oldScaled === null ? null : scaledToText(input.oldScaled)},
      ${input.newScaled === null ? null : scaledToText(input.newScaled)},
      ${input.reason ?? null}
    )
  `;
}

export type SaveScoresResult =
  | { ok: true; sheet: GradeSheet; updatedCount: number }
  | { ok: false; status: number; error: string };

type PendingScore = {
  studentId: string;
  gradeItemId: string;
  scaled: number | null;
};

/**
 * 成批保存网格中的得分。整批共用一个事务：任何一格不合法都整批拒绝，
 * 不会留下“改了一半”的成绩。空白表示未录入，会删除对应的成绩行。
 */
export async function saveScores(input: {
  teachingClassId: string;
  user: SessionUser;
  scores: unknown;
}): Promise<SaveScoresResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "grades",
  );
  if (!access.ok) return access;

  if (!Array.isArray(input.scores)) {
    return { ok: false, status: 400, error: "请提供要保存的成绩。" };
  }
  const scores = input.scores;

  const sql = getDb();
  const outcome = await sql.begin<
    | { ok: true; updatedCount: number }
    | { ok: false; status: number; error: string }
  >(async (tx) => {
    const state = await teachingClassGradeState(tx, input.teachingClassId, {
      expect: "draft",
      conflictError: GRADE_LOCKED_MESSAGE,
    });
    if (!state.ok) return state;

    const itemRows = await tx<{ id: string; max_score: string }[]>`
      select id, max_score::text as max_score
      from grade_items
      where teaching_class_id = ${input.teachingClassId}
    `;
    const itemMax = new Map(
      itemRows.map((row) => [row.id, parseStoredDecimal(row.max_score) ?? 0]),
    );

    const rosterRows = await tx<{ student_id: string }[]>`
      select student_id from teaching_class_students
      where teaching_class_id = ${input.teachingClassId}
    `;
    const roster = new Set(rosterRows.map((row) => row.student_id));

    const validated: PendingScore[] = [];
    for (const entry of scores) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return { ok: false, status: 400, error: "成绩数据无法识别。" };
      }
      const record = entry as Record<string, unknown>;
      const studentId =
        typeof record.studentId === "string" ? record.studentId : "";
      const gradeItemId =
        typeof record.gradeItemId === "string" ? record.gradeItemId : "";
      const maxScaled = itemMax.get(gradeItemId);
      if (maxScaled === undefined) {
        return { ok: false, status: 404, error: "成绩项不存在。" };
      }
      if (!roster.has(studentId)) {
        return {
          ok: false,
          status: 400,
          error: "该学生不在本教学班名单中。",
        };
      }

      const raw = record.score;
      if (raw === null || raw === "") {
        validated.push({ studentId, gradeItemId, scaled: null });
        continue;
      }
      const looksNegative =
        (typeof raw === "number" && raw < 0) ||
        (typeof raw === "string" && raw.trim().startsWith("-"));
      if (looksNegative) {
        return {
          ok: false,
          status: 400,
          error: `得分需在 0 到 ${scaledToNumber(maxScaled)} 之间。`,
        };
      }

      const parsed = parseDecimal(raw, "得分");
      if (!parsed.ok) {
        return { ok: false, status: 400, error: parsed.error };
      }
      if (parsed.scaled > maxScaled) {
        return {
          ok: false,
          status: 400,
          error: `得分需在 0 到 ${scaledToNumber(maxScaled)} 之间。`,
        };
      }
      validated.push({ studentId, gradeItemId, scaled: parsed.scaled });
    }

    const existingRows = await tx<
      { grade_item_id: string; student_id: string; score: string }[]
    >`
      select sg.grade_item_id, sg.student_id, sg.score::text as score
      from student_grades sg
      join grade_items gi on gi.id = sg.grade_item_id
      where gi.teaching_class_id = ${input.teachingClassId}
    `;
    const existing = new Map<string, number>();
    for (const row of existingRows) {
      const score = parseStoredDecimal(row.score);
      if (score === null) continue;
      existing.set(`${row.grade_item_id}:${row.student_id}`, score);
    }

    let updatedCount = 0;
    for (const entry of validated) {
      const key = `${entry.gradeItemId}:${entry.studentId}`;
      const oldScaled = existing.get(key) ?? null;
      if (oldScaled === entry.scaled) continue;

      if (entry.scaled === null) {
        await tx`
          delete from student_grades
          where grade_item_id = ${entry.gradeItemId}
            and student_id = ${entry.studentId}
        `;
      } else {
        await tx`
          insert into student_grades (grade_item_id, student_id, score)
          values (
            ${entry.gradeItemId}, ${entry.studentId},
            ${scaledToText(entry.scaled)}
          )
          on conflict (grade_item_id, student_id) do update
          set score = excluded.score, updated_at = now()
        `;
      }

      await insertGradeChangeLog(tx, {
        teachingClassId: input.teachingClassId,
        studentId: entry.studentId,
        gradeItemId: entry.gradeItemId,
        target: "grade_item",
        action: oldScaled === null ? "record" : "update",
        actorAccountId: input.user.id,
        oldScaled,
        newScaled: entry.scaled,
      });
      if (entry.scaled === null) existing.delete(key);
      else existing.set(key, entry.scaled);
      updatedCount += 1;
    }

    await recomputeComputedOveralls(tx, input.teachingClassId);
    return { ok: true, updatedCount };
  });

  if (!outcome.ok) return outcome;

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  return { ok: true, sheet, updatedCount: outcome.updatedCount };
}

export type OverallResult =
  | { ok: true; sheet: GradeSheet }
  | { ok: false; status: number; error: string };

/** 教师人工覆盖某学生的总评；原值是覆盖前的有效值（上次覆盖值或系统计算值）。 */
export async function setOverallOverride(input: {
  teachingClassId: string;
  studentId: string;
  user: SessionUser;
  score: unknown;
}): Promise<OverallResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "grades",
  );
  if (!access.ok) return access;

  const sql = getDb();
  const outcome = await sql.begin<
    { ok: true } | { ok: false; status: number; error: string }
  >(async (tx) => {
    const state = await teachingClassGradeState(tx, input.teachingClassId, {
      expect: "draft",
      conflictError: GRADE_LOCKED_MESSAGE,
    });
    if (!state.ok) return state;

    const rosterRows = await tx<{ student_id: string }[]>`
      select student_id from teaching_class_students
      where teaching_class_id = ${input.teachingClassId}
        and student_id = ${input.studentId}
      limit 1
    `;
    if (rosterRows.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "该学生不在本教学班名单中。",
      };
    }

    const parsed = parseDecimal(input.score, "总评");
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    if (parsed.scaled > MAX_SCORE) {
      return { ok: false, status: 400, error: "总评不能超过 9999.99。" };
    }

    const overallRows = await tx<
      { computed_score: string | null; override_score: string | null }[]
    >`
      select computed_score::text as computed_score,
        override_score::text as override_score
      from grade_overalls
      where teaching_class_id = ${input.teachingClassId}
        and student_id = ${input.studentId}
      for update
    `;
    const current = overallRows[0];
    const computed = parseStoredDecimal(current?.computed_score ?? null);
    const previousOverride = parseStoredDecimal(
      current?.override_score ?? null,
    );
    const oldEffective = previousOverride ?? computed;

    // 覆盖值没有变化时不产生新日志。
    if (previousOverride !== null && previousOverride === parsed.scaled) {
      return { ok: true };
    }

    await tx`
      insert into grade_overalls (
        teaching_class_id, student_id, override_score,
        override_updated_at, override_updated_by
      )
      values (
        ${input.teachingClassId}, ${input.studentId},
        ${scaledToText(parsed.scaled)}, now(), ${input.user.id}
      )
      on conflict (teaching_class_id, student_id) do update
      set override_score = excluded.override_score,
        override_updated_at = excluded.override_updated_at,
        override_updated_by = excluded.override_updated_by
    `;

    await insertGradeChangeLog(tx, {
      teachingClassId: input.teachingClassId,
      studentId: input.studentId,
      gradeItemId: null,
      target: "overall",
      action: "override_overall",
      actorAccountId: input.user.id,
      oldScaled: oldEffective,
      newScaled: parsed.scaled,
    });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  return { ok: true, sheet };
}

/** 取消覆盖：恢复系统计算值，并把取消动作写入变更日志。 */
export async function cancelOverallOverride(input: {
  teachingClassId: string;
  studentId: string;
  user: SessionUser;
}): Promise<OverallResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "grades",
  );
  if (!access.ok) return access;

  const sql = getDb();
  const outcome = await sql.begin<
    { ok: true } | { ok: false; status: number; error: string }
  >(async (tx) => {
    const state = await teachingClassGradeState(tx, input.teachingClassId, {
      expect: "draft",
      conflictError: GRADE_LOCKED_MESSAGE,
    });
    if (!state.ok) return state;

    const overallRows = await tx<
      { computed_score: string | null; override_score: string | null }[]
    >`
      select computed_score::text as computed_score,
        override_score::text as override_score
      from grade_overalls
      where teaching_class_id = ${input.teachingClassId}
        and student_id = ${input.studentId}
      for update
    `;
    const current = overallRows[0];
    const previousOverride = parseStoredDecimal(
      current?.override_score ?? null,
    );
    if (current === undefined || previousOverride === null) {
      return {
        ok: false,
        status: 409,
        error: "该学生当前没有总评覆盖。",
      };
    }
    const computed = parseStoredDecimal(current.computed_score);

    await tx`
      update grade_overalls
      set override_score = null,
        override_updated_at = now(),
        override_updated_by = ${input.user.id}
      where teaching_class_id = ${input.teachingClassId}
        and student_id = ${input.studentId}
    `;

    await insertGradeChangeLog(tx, {
      teachingClassId: input.teachingClassId,
      studentId: input.studentId,
      gradeItemId: null,
      target: "overall",
      action: "cancel_override",
      actorAccountId: input.user.id,
      oldScaled: previousOverride,
      newScaled: computed,
    });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  return { ok: true, sheet };
}

export type CreateGradeItemResult =
  | { ok: true; gradeItem: GradeItemSummary; sheet: GradeSheet }
  | { ok: false; status: number; error: string };

export async function createGradeItem(input: {
  teachingClassId: string;
  user: SessionUser;
  name: unknown;
  maxScore: unknown;
  weight: unknown;
}): Promise<CreateGradeItemResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "grades",
  );
  if (!access.ok) return access;

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return { ok: false, status: 400, error: "请输入成绩项名称。" };
  }
  const name = input.name.trim();
  if (name.length > 64) {
    return {
      ok: false,
      status: 400,
      error: "成绩项名称不能超过 64 个字符。",
    };
  }

  const maxScore = parseDecimal(input.maxScore, "满分");
  if (!maxScore.ok) return { ok: false, status: 400, error: maxScore.error };
  if (maxScore.scaled <= 0) {
    return { ok: false, status: 400, error: "满分必须大于 0。" };
  }
  if (maxScore.scaled > MAX_SCORE) {
    return { ok: false, status: 400, error: "满分不能超过 9999.99。" };
  }

  const weight = parseDecimal(input.weight, "权重");
  if (!weight.ok) return { ok: false, status: 400, error: weight.error };
  if (weight.scaled <= 0) {
    return { ok: false, status: 400, error: "权重必须大于 0。" };
  }
  if (weight.scaled > MAX_WEIGHT) {
    return { ok: false, status: 400, error: "权重不能超过 100。" };
  }

  const sql = getDb();
  let gradeItemId: string;
  try {
    const outcome = await sql.begin<
      | { ok: true; gradeItemId: string }
      | { ok: false; status: number; error: string }
    >(async (tx) => {
      const state = await teachingClassGradeState(tx, input.teachingClassId, {
        expect: "draft",
        conflictError: GRADE_LOCKED_MESSAGE,
      });
      if (!state.ok) return state;

      const inserted = await tx<{ id: string }[]>`
        insert into grade_items (teaching_class_id, name, max_score, weight)
        values (
          ${input.teachingClassId}, ${name},
          ${scaledToText(maxScore.scaled)}, ${scaledToText(weight.scaled)}
        )
        returning id
      `;
      await recomputeComputedOveralls(tx, input.teachingClassId);
      return { ok: true as const, gradeItemId: inserted[0]!.id };
    });
    if (!outcome.ok) return outcome;
    gradeItemId = outcome.gradeItemId;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "该教学班已有同名成绩项，请换一个名称。",
      };
    }
    throw error;
  }

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  const gradeItem = sheet.gradeItems.find((item) => item.id === gradeItemId);
  if (!gradeItem) {
    return { ok: false, status: 500, error: "成绩项创建失败，请稍后再试。" };
  }
  return { ok: true, gradeItem, sheet };
}

export type PublishResult =
  | {
      ok: true;
      publication: { id: string; version: number; publishedAt: string };
      lock: GradeLock;
      sheet: GradeSheet;
    }
  | { ok: false; status: number; error: string };

/**
 * 发布整个教学班：把当时的成绩项定义、每人每项得分与每人总评固化成快照，
 * 并把教学班切到已发布（锁定）。发布前必须显式确认（confirmed === true），
 * 避免误触后学生立刻看到半成品。
 */
export async function publishGrades(input: {
  teachingClassId: string;
  user: SessionUser;
  confirmed: unknown;
}): Promise<PublishResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "grades",
  );
  if (!access.ok) return access;

  if (input.confirmed !== true) {
    return {
      ok: false,
      status: 400,
      error:
        "发布后全体学生将立即看到本次成绩，且教学班会被锁定；请确认成绩无误后再发布。",
    };
  }

  const sql = getDb();
  const outcome = await sql.begin<
    { ok: true } | { ok: false; status: number; error: string }
  >(async (tx) => {
    const state = await teachingClassGradeState(tx, input.teachingClassId, {
      expect: "draft",
      conflictError: LOCKED_PUBLISH_MESSAGE,
    });
    if (!state.ok) return state;

    const snapshot = await createPublicationSnapshot(tx, {
      teachingClassId: input.teachingClassId,
      actorAccountId: input.user.id,
    });
    if (!snapshot.ok) return snapshot;

    await tx`
      update teaching_classes
      set grade_state = 'published', updated_at = now()
      where id = ${input.teachingClassId}
    `;
    await insertGradeChangeLog(tx, {
      teachingClassId: input.teachingClassId,
      studentId: null,
      gradeItemId: null,
      target: "teaching_class",
      action: "publish",
      actorAccountId: input.user.id,
      oldScaled: null,
      newScaled: null,
    });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet || !sheet.lock.latestPublication) {
    return { ok: false, status: 500, error: "发布失败，请稍后再试。" };
  }
  return {
    ok: true,
    publication: sheet.lock.latestPublication,
    lock: sheet.lock,
    sheet,
  };
}

export type UnlockResult =
  | { ok: true; lock: GradeLock; sheet: GradeSheet }
  | { ok: false; status: number; error: string };

/**
 * 教务管理员解锁：必须写明理由，理由落入变更日志的 reason 字段。
 * 解锁只把教学班切回草稿，已发布的快照原样保留，学生继续看到旧版本。
 */
export async function unlockGrades(input: {
  teachingClassId: string;
  user: SessionUser;
  reason: unknown;
}): Promise<UnlockResult> {
  const access = await authorizeTeachingClass(
    input.teachingClassId,
    input.user,
    "unlock",
  );
  if (!access.ok) return access;

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: "请填写解锁理由，解锁记录会保留理由。",
    };
  }
  const reason = input.reason.trim();
  if (reason.length > 500) {
    return {
      ok: false,
      status: 400,
      error: "解锁理由不能超过 500 个字符。",
    };
  }

  const sql = getDb();
  const outcome = await sql.begin<
    { ok: true } | { ok: false; status: number; error: string }
  >(async (tx) => {
    const state = await teachingClassGradeState(tx, input.teachingClassId, {
      expect: "published",
      conflictError: "该教学班当前未锁定，无需解锁。",
    });
    if (!state.ok) return state;

    await tx`
      update teaching_classes
      set grade_state = 'draft', updated_at = now()
      where id = ${input.teachingClassId}
    `;
    await insertGradeChangeLog(tx, {
      teachingClassId: input.teachingClassId,
      studentId: null,
      gradeItemId: null,
      target: "teaching_class",
      action: "unlock",
      actorAccountId: input.user.id,
      oldScaled: null,
      newScaled: null,
      reason,
    });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;

  const sheet = await getGradeSheet(input.teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  return { ok: true, lock: sheet.lock, sheet };
}
