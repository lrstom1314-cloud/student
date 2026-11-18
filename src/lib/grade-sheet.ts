import type { Sql, TransactionSql } from "postgres";

import {
  SCALE,
  computeOverallHundredths,
  parseStoredDecimal,
  scaledToNumber,
  scaledToText,
  type GradeCalcItem,
} from "@/lib/grade-values";
import { loadLatestPublication } from "@/lib/grade-publications";
import type { TeachingClassSummary } from "@/lib/teaching-classes";

/**
 * 成绩表 module。
 *
 * 草稿读取、写入后的重读、系统总评重算与发布快照共用这里的装配逻辑：
 * 成绩项、名单、得分与总评行只在这里解释一次，总评规则（缺项、覆盖、舍入）
 * 也只有这一份实现。
 */

export type GradeItemSummary = {
  id: string;
  name: string;
  maxScore: number;
  weight: number;
};

export type OverallSummary = {
  computedScore: number | null;
  overrideScore: number | null;
  finalScore: number | null;
  finalSource: "computed" | "override" | null;
  status: "complete" | "incomplete";
  missingGradeItemIds: string[];
};

export type GradeSheetStudent = {
  id: string;
  studentNumber: string;
  name: string;
  administrativeClass: { id: string; name: string };
  grades: Record<string, number | null>;
  overall: OverallSummary;
};

/** 发布是整体动作：教学班只有「草稿」与「已发布（锁定）」两种状态。 */
export type GradeLock = {
  state: "draft" | "published";
  latestPublication: {
    id: string;
    version: number;
    publishedAt: string;
  } | null;
};

export type GradeSheet = {
  teachingClass: TeachingClassSummary;
  gradeItems: GradeItemSummary[];
  weightTotal: number;
  weightComplete: boolean;
  weightWarning: string | null;
  students: GradeSheetStudent[];
  lock: GradeLock;
};

/** 已发布时所有角色（包括教务管理员）的写入都被拒绝，必须先解锁。 */
export const GRADE_LOCKED_MESSAGE =
  "成绩已发布并锁定，需教务管理员解锁后才能修改。";

type GradeState = "draft" | "published";

type GradeStateExpectation = {
  /** 期望的状态；不符时返回 conflictError。 */
  expect: GradeState;
  /** 状态不符时展示的中文说明（409）。 */
  conflictError: string;
};

/**
 * 读取教学班的 grade_state。
 *
 * 传入 expectation 时用 `for update` 锁住该行，让发布、解锁与成绩写入
 * 在同一把行锁上排队，锁定语义没有竞态窗口；状态不符直接返回 409。
 * 不传 expectation 时是普通读取（成绩单展示用，不参与写事务）。
 * 教学班不存在统一返回 404。
 */
export async function teachingClassGradeState(
  client: Sql | TransactionSql,
  teachingClassId: string,
  expectation?: GradeStateExpectation,
): Promise<
  | { ok: true; state: GradeState }
  | { ok: false; status: number; error: string }
> {
  const rows = expectation
    ? await client<{ grade_state: GradeState }[]>`
        select grade_state from teaching_classes
        where id = ${teachingClassId}
        for update
      `
    : await client<{ grade_state: GradeState }[]>`
        select grade_state from teaching_classes
        where id = ${teachingClassId}
      `;

  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  if (expectation && row.grade_state !== expectation.expect) {
    return { ok: false, status: 409, error: expectation.conflictError };
  }
  return { ok: true, state: row.grade_state };
}

type ItemRow = {
  id: string;
  name: string;
  max_score: string;
  weight: string;
};

type StudentRow = {
  id: string;
  student_number: string;
  name: string;
  administrative_class_id: string;
  administrative_class_name: string;
};

type ScoreRow = {
  student_id: string;
  grade_item_id: string;
  score: string;
};

type OverallRow = {
  student_id: string;
  computed_score: string | null;
  override_score: string | null;
};

type GradeInputs = {
  itemRows: ItemRow[];
  studentRows: StudentRow[];
  scoreRows: ScoreRow[];
  gradeItems: GradeItemSummary[];
  calcItems: GradeCalcItem[];
  scoresByStudent: Map<string, Map<string, number>>;
  computedByStudent: Map<string, number | null>;
  overrideByStudent: Map<string, number | null>;
};

async function loadGradeInputs(
  client: Sql | TransactionSql,
  teachingClassId: string,
): Promise<GradeInputs> {
  const [itemRows, studentRows, scoreRows, overallRows] = await Promise.all([
    client<ItemRow[]>`
      select id, name, max_score::text as max_score, weight::text as weight
      from grade_items
      where teaching_class_id = ${teachingClassId}
      order by created_at, id
    `,
    client<StudentRow[]>`
      select s.id, s.student_number, s.name,
        c.id as administrative_class_id,
        c.name as administrative_class_name
      from teaching_class_students tcs
      join students s on s.id = tcs.student_id
      join administrative_classes c on c.id = s.administrative_class_id
      where tcs.teaching_class_id = ${teachingClassId}
      order by s.student_number
    `,
    client<ScoreRow[]>`
      select sg.grade_item_id, sg.student_id, sg.score::text as score
      from student_grades sg
      join grade_items gi on gi.id = sg.grade_item_id
      where gi.teaching_class_id = ${teachingClassId}
    `,
    client<OverallRow[]>`
      select student_id, computed_score::text as computed_score,
        override_score::text as override_score
      from grade_overalls
      where teaching_class_id = ${teachingClassId}
    `,
  ]);

  const calcItems: GradeCalcItem[] = itemRows.map((row) => ({
    id: row.id,
    maxScaled: parseStoredDecimal(row.max_score) ?? 0,
    weightScaled: parseStoredDecimal(row.weight) ?? 0,
  }));

  const scoresByStudent = new Map<string, Map<string, number>>();
  for (const row of scoreRows) {
    const score = parseStoredDecimal(row.score);
    if (score === null) continue;
    let byItem = scoresByStudent.get(row.student_id);
    if (!byItem) {
      byItem = new Map();
      scoresByStudent.set(row.student_id, byItem);
    }
    byItem.set(row.grade_item_id, score);
  }

  return {
    itemRows,
    studentRows,
    scoreRows,
    gradeItems: itemRows.map((row) => ({
      id: row.id,
      name: row.name,
      maxScore: scaledToNumber(parseStoredDecimal(row.max_score) ?? 0),
      weight: scaledToNumber(parseStoredDecimal(row.weight) ?? 0),
    })),
    calcItems,
    scoresByStudent,
    computedByStudent: new Map(
      overallRows.map((row) => [
        row.student_id,
        parseStoredDecimal(row.computed_score),
      ]),
    ),
    overrideByStudent: new Map(
      overallRows.map((row) => [
        row.student_id,
        parseStoredDecimal(row.override_score),
      ]),
    ),
  };
}

export type OverallDerivation = {
  summary: OverallSummary;
  computedScaled: number | null;
  finalScaled: number | null;
};

/**
 * 总评的唯一判定：
 * - 系统值优先使用已落库的 computed_score（草稿读取），传入 null 表示重新计算；
 * - 覆盖值优先于系统值；
 * - 任一成绩项缺失时总评未完成，不按 0 分折算。
 */
export function deriveOverall(input: {
  calcItems: GradeCalcItem[];
  scores: Map<string, number>;
  storedComputedScaled: number | null;
  overrideScaled: number | null;
}): OverallDerivation {
  const computed = computeOverallHundredths(input.calcItems, input.scores);
  const computedScaled = input.storedComputedScaled ?? computed.scaled;
  const finalScaled = input.overrideScaled ?? computedScaled;

  return {
    computedScaled,
    finalScaled,
    summary: {
      computedScore:
        computedScaled === null ? null : scaledToNumber(computedScaled),
      overrideScore:
        input.overrideScaled === null
          ? null
          : scaledToNumber(input.overrideScaled),
      finalScore: finalScaled === null ? null : scaledToNumber(finalScaled),
      finalSource:
        input.overrideScaled !== null
          ? "override"
          : computedScaled !== null
            ? "computed"
            : null,
      status: computed.scaled === null ? "incomplete" : "complete",
      missingGradeItemIds: computed.missing,
    },
  };
}

/** 装配一整张成绩表；调用方负责先确认教学班存在。 */
export async function assembleGradeSheet(
  client: Sql | TransactionSql,
  teachingClass: TeachingClassSummary,
): Promise<GradeSheet> {
  const inputs = await loadGradeInputs(client, teachingClass.id);
  const [gradeState, latestPublication] = await Promise.all([
    teachingClassGradeState(client, teachingClass.id),
    loadLatestPublication(client, teachingClass.id),
  ]);

  const weightTotalScaled = inputs.calcItems.reduce(
    (accumulator, item) => accumulator + item.weightScaled,
    0,
  );
  const weightTotal = scaledToNumber(weightTotalScaled);
  const weightComplete = weightTotalScaled === 100 * SCALE;
  const weightWarning =
    inputs.calcItems.length > 0 && !weightComplete
      ? `成绩项权重合计为 ${weightTotal}%，不等于 100%，总评可能不准确。`
      : null;

  const students = inputs.studentRows.map<GradeSheetStudent>((row) => {
    const scores = inputs.scoresByStudent.get(row.id) ?? new Map<string, number>();
    const grades: Record<string, number | null> = {};
    for (const item of inputs.gradeItems) {
      const score = scores.get(item.id);
      grades[item.id] = score === undefined ? null : scaledToNumber(score);
    }

    const overall = deriveOverall({
      calcItems: inputs.calcItems,
      scores,
      storedComputedScaled: inputs.computedByStudent.get(row.id) ?? null,
      overrideScaled: inputs.overrideByStudent.get(row.id) ?? null,
    });

    return {
      id: row.id,
      studentNumber: row.student_number,
      name: row.name,
      administrativeClass: {
        id: row.administrative_class_id,
        name: row.administrative_class_name,
      },
      grades,
      overall: overall.summary,
    };
  });

  return {
    teachingClass,
    gradeItems: inputs.gradeItems,
    weightTotal,
    weightComplete,
    weightWarning,
    students,
    lock: {
      state: gradeState.ok ? gradeState.state : "draft",
      latestPublication: latestPublication
        ? {
            id: latestPublication.id,
            version: latestPublication.version,
            publishedAt: latestPublication.publishedAt.toISOString(),
          }
        : null,
    },
  };
}

/** 重新计算并落库某教学班全部学生的系统总评；覆盖值保持不变。 */
export async function recomputeComputedOveralls(
  client: Sql | TransactionSql,
  teachingClassId: string,
): Promise<void> {
  const inputs = await loadGradeInputs(client, teachingClassId);

  for (const row of inputs.studentRows) {
    const overall = deriveOverall({
      calcItems: inputs.calcItems,
      scores: inputs.scoresByStudent.get(row.id) ?? new Map(),
      storedComputedScaled: null,
      overrideScaled: null,
    });
    const text =
      overall.computedScaled === null
        ? null
        : scaledToText(overall.computedScaled);

    await client`
      insert into grade_overalls (
        teaching_class_id, student_id, computed_score, computed_at
      )
      values (${teachingClassId}, ${row.id}, ${text}, now())
      on conflict (teaching_class_id, student_id) do update
      set computed_score = excluded.computed_score,
        computed_at = excluded.computed_at
    `;
  }
}

export type SnapshotResult =
  | { ok: true; publicationId: string; version: number }
  | { ok: false; status: number; error: string };

/**
 * 把当前成绩固化成发布快照。必须在持有教学班行锁的事务里调用；
 * 快照的一切数值都来自与草稿相同的装配口径。
 */
export async function createPublicationSnapshot(
  client: TransactionSql,
  input: { teachingClassId: string; actorAccountId: string },
): Promise<SnapshotResult> {
  const inputs = await loadGradeInputs(client, input.teachingClassId);
  if (inputs.itemRows.length === 0) {
    return { ok: false, status: 400, error: "还没有成绩项，无法发布。" };
  }

  const versionRows = await client<{ next_version: number }[]>`
    select coalesce(max(version), 0) + 1 as next_version
    from grade_publications
    where teaching_class_id = ${input.teachingClassId}
  `;
  const version = versionRows[0]!.next_version;

  const publicationRows = await client<{ id: string }[]>`
    insert into grade_publications (
      teaching_class_id, version, published_by
    )
    values (
      ${input.teachingClassId}, ${version}, ${input.actorAccountId}
    )
    returning id
  `;
  const publicationId = publicationRows[0]!.id;

  for (const [position, item] of inputs.itemRows.entries()) {
    await client`
      insert into grade_publication_items (
        publication_id, grade_item_id, position, name, max_score, weight
      )
      values (
        ${publicationId}, ${item.id}, ${position}, ${item.name},
        ${item.max_score}, ${item.weight}
      )
    `;
  }

  for (const row of inputs.scoreRows) {
    await client`
      insert into grade_publication_scores (
        publication_id, grade_item_id, student_id, score
      )
      values (
        ${publicationId}, ${row.grade_item_id}, ${row.student_id},
        ${row.score}
      )
    `;
  }

  for (const student of inputs.studentRows) {
    const overrideScaled = inputs.overrideByStudent.get(student.id) ?? null;
    const overall = deriveOverall({
      calcItems: inputs.calcItems,
      scores: inputs.scoresByStudent.get(student.id) ?? new Map(),
      storedComputedScaled: null,
      overrideScaled,
    });

    await client`
      insert into grade_publication_overalls (
        publication_id, student_id, student_number, student_name,
        computed_score, override_score, final_score, final_source, status
      )
      values (
        ${publicationId}, ${student.id}, ${student.student_number},
        ${student.name},
        ${overall.computedScaled === null ? null : scaledToText(overall.computedScaled)},
        ${overrideScaled === null ? null : scaledToText(overrideScaled)},
        ${overall.finalScaled === null ? null : scaledToText(overall.finalScaled)},
        ${overall.summary.finalSource}, ${overall.summary.status}
      )
    `;
  }

  return { ok: true, publicationId, version };
}
