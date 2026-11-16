import type { Sql, TransactionSql } from "postgres";

import { getDb } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/http";
import {
  findTeachingClass,
  type TeachingClassSummary,
} from "@/lib/teaching-classes";

/** 金额式小数统一放大 100 倍后用整数运算，避免浮点误差。 */
const SCALE = 100;
const MAX_SCORE = 999_999; // 9999.99
const MAX_WEIGHT = 10_000; // 100.00

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

export type GradeSheet = {
  teachingClass: TeachingClassSummary;
  gradeItems: GradeItemSummary[];
  weightTotal: number;
  weightComplete: boolean;
  weightWarning: string | null;
  students: GradeSheetStudent[];
};

type GradeAccess =
  | { ok: true; teachingClass: TeachingClassSummary }
  | { ok: false; status: number; error: string };

/**
 * 成绩读写权限：教务管理员全库；教师仅自己任教的教学班；
 * 学生不参与成绩录入，一律 403。
 */
export async function authorizeGradeAccess(
  teachingClassId: string,
  user: SessionUser,
): Promise<GradeAccess> {
  const teachingClass = await findTeachingClass(teachingClassId);
  if (!teachingClass) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }

  if (user.role === "administrator") {
    return { ok: true, teachingClass };
  }
  if (user.role === "teacher" && teachingClass.teacher.id === user.id) {
    return { ok: true, teachingClass };
  }
  return { ok: false, status: 403, error: "无权访问。" };
}

function scaledToText(scaled: number): string {
  const whole = Math.trunc(scaled / SCALE);
  const fraction = Math.abs(scaled % SCALE)
    .toString()
    .padStart(2, "0");
  return `${whole}.${fraction}`;
}

function scaledToNumber(scaled: number): number {
  return Number(scaledToText(scaled));
}

/** 读取数据库 numeric 文本为放大 100 倍的整数。 */
function parseStoredDecimal(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0").slice(0, 2);
  return whole * SCALE + (whole < 0 ? -1 : 1) * Number(fraction);
}

type ParsedDecimal =
  | { ok: true; scaled: number }
  | { ok: false; error: string };

/**
 * 只接受非负的十进制数，最多两位小数；数字与字符串输入都支持。
 * 负数、科学计数法、三位小数等一律拒绝，由调用方给出中文提示。
 */
function parseDecimal(value: unknown, field: string): ParsedDecimal {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        error: `${field}需为 0 到 9999.99 之间的数字，最多两位小数。`,
      };
    }
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value.trim();
  } else {
    return {
      ok: false,
      error: `${field}需为 0 到 9999.99 之间的数字，最多两位小数。`,
    };
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    return {
      ok: false,
      error: `${field}需为 0 到 9999.99 之间的数字，最多两位小数。`,
    };
  }
  if ((match[2] ?? "").length > 2) {
    return { ok: false, error: `${field}最多保留两位小数。` };
  }

  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) {
    return {
      ok: false,
      error: `${field}需为 0 到 9999.99 之间的数字，最多两位小数。`,
    };
  }
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return { ok: true, scaled: whole * SCALE + fraction };
}

type CalcItem = { id: string; maxScaled: number; weightScaled: number };

/**
 * 总评 = Σ(得分 ÷ 满分 × 权重)，权重的单位是百分比。
 * 返回放大 100 倍并四舍五入（半入）到两位小数的整数；
 * 任一分项缺分或没有成绩项时返回 null，绝不把缺失当 0 参与计算。
 */
function computeOverallHundredths(
  items: CalcItem[],
  scores: Map<string, number>,
): { scaled: number | null; missing: string[] } {
  const missing = items
    .filter((item) => !scores.has(item.id))
    .map((item) => item.id);
  if (items.length === 0 || missing.length > 0) {
    return { scaled: null, missing };
  }

  const product = items.reduce(
    (accumulator, item) => accumulator * BigInt(item.maxScaled),
    1n,
  );
  let numerator = 0n;
  for (const item of items) {
    const score = scores.get(item.id)!;
    numerator +=
      BigInt(score) *
      BigInt(item.weightScaled) *
      (product / BigInt(item.maxScaled));
  }

  // 正数四舍五入到整数：floor((2n + d) / 2d)。
  const rounded = (BigInt(2) * numerator + product) / (BigInt(2) * product);
  return { scaled: Number(rounded), missing };
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
  grade_item_id: string;
  student_id: string;
  score: string;
};

type OverallRow = {
  student_id: string;
  computed_score: string | null;
  override_score: string | null;
};

function toGradeItem(row: ItemRow): GradeItemSummary {
  return {
    id: row.id,
    name: row.name,
    maxScore: scaledToNumber(parseStoredDecimal(row.max_score) ?? 0),
    weight: scaledToNumber(parseStoredDecimal(row.weight) ?? 0),
  };
}

async function loadSheetParts(
  tx: Sql | TransactionSql,
  teachingClass: TeachingClassSummary,
): Promise<GradeSheet> {
  const itemRows = await tx<ItemRow[]>`
    select id, name, max_score::text as max_score, weight::text as weight
    from grade_items
    where teaching_class_id = ${teachingClass.id}
    order by created_at, id
  `;
  const studentRows = await tx<StudentRow[]>`
    select s.id, s.student_number, s.name,
      c.id as administrative_class_id,
      c.name as administrative_class_name
    from teaching_class_students tcs
    join students s on s.id = tcs.student_id
    join administrative_classes c on c.id = s.administrative_class_id
    where tcs.teaching_class_id = ${teachingClass.id}
    order by s.student_number
  `;
  const scoreRows = await tx<ScoreRow[]>`
    select sg.grade_item_id, sg.student_id, sg.score::text as score
    from student_grades sg
    join grade_items gi on gi.id = sg.grade_item_id
    where gi.teaching_class_id = ${teachingClass.id}
  `;
  const overallRows = await tx<OverallRow[]>`
    select student_id, computed_score::text as computed_score,
      override_score::text as override_score
    from grade_overalls
    where teaching_class_id = ${teachingClass.id}
  `;

  const gradeItems = itemRows.map(toGradeItem);
  const calcItems: CalcItem[] = itemRows.map((row) => ({
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

  const overallsByStudent = new Map(
    overallRows.map((row) => [row.student_id, row]),
  );

  const weightTotalScaled = calcItems.reduce(
    (accumulator, item) => accumulator + item.weightScaled,
    0,
  );
  const weightTotal = scaledToNumber(weightTotalScaled);
  const weightComplete = weightTotalScaled === 100 * SCALE;
  const weightWarning =
    calcItems.length > 0 && !weightComplete
      ? `成绩项权重合计为 ${weightTotal}%，不等于 100%，总评可能不准确。`
      : null;

  const students = studentRows.map<GradeSheetStudent>((row) => {
    const scoreMap = scoresByStudent.get(row.id) ?? new Map<string, number>();
    const grades: Record<string, number | null> = {};
    for (const item of gradeItems) {
      const score = scoreMap.get(item.id);
      grades[item.id] = score === undefined ? null : scaledToNumber(score);
    }

    const computed = computeOverallHundredths(calcItems, scoreMap);
    const stored = overallsByStudent.get(row.id);
    const storedComputed = parseStoredDecimal(stored?.computed_score ?? null);
    const override = parseStoredDecimal(stored?.override_score ?? null);
    const computedScaled = storedComputed ?? computed.scaled;
    const finalScaled = override ?? computedScaled;

    return {
      id: row.id,
      studentNumber: row.student_number,
      name: row.name,
      administrativeClass: {
        id: row.administrative_class_id,
        name: row.administrative_class_name,
      },
      grades,
      overall: {
        computedScore:
          computedScaled === null ? null : scaledToNumber(computedScaled),
        overrideScore: override === null ? null : scaledToNumber(override),
        finalScore: finalScaled === null ? null : scaledToNumber(finalScaled),
        finalSource:
          override !== null
            ? "override"
            : computedScaled !== null
              ? "computed"
              : null,
        status: computed.scaled === null ? "incomplete" : "complete",
        missingGradeItemIds: computed.missing,
      },
    };
  });

  return {
    teachingClass,
    gradeItems,
    weightTotal,
    weightComplete,
    weightWarning,
    students,
  };
}

export async function getGradeSheet(
  teachingClassId: string,
): Promise<GradeSheet | null> {
  const teachingClass = await findTeachingClass(teachingClassId);
  if (!teachingClass) return null;
  return loadSheetParts(getDb(), teachingClass);
}

/** 重新计算并落库某教学班全部学生的系统总评；覆盖值保持不变。 */
async function recomputeOveralls(
  tx: TransactionSql,
  teachingClassId: string,
): Promise<void> {
  const itemRows = await tx<{ id: string; max_score: string; weight: string }[]>`
    select id, max_score::text as max_score, weight::text as weight
    from grade_items
    where teaching_class_id = ${teachingClassId}
  `;
  const calcItems: CalcItem[] = itemRows.map((row) => ({
    id: row.id,
    maxScaled: parseStoredDecimal(row.max_score) ?? 0,
    weightScaled: parseStoredDecimal(row.weight) ?? 0,
  }));

  const studentRows = await tx<{ student_id: string }[]>`
    select student_id from teaching_class_students
    where teaching_class_id = ${teachingClassId}
  `;
  const scoreRows = await tx<
    { student_id: string; grade_item_id: string; score: string }[]
  >`
    select sg.student_id, sg.grade_item_id, sg.score::text as score
    from student_grades sg
    join grade_items gi on gi.id = sg.grade_item_id
    where gi.teaching_class_id = ${teachingClassId}
  `;

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

  for (const row of studentRows) {
    const computed = computeOverallHundredths(
      calcItems,
      scoresByStudent.get(row.student_id) ?? new Map(),
    );
    const text =
      computed.scaled === null ? null : scaledToText(computed.scaled);
    await tx`
      insert into grade_overalls (
        teaching_class_id, student_id, computed_score, computed_at
      )
      values (${teachingClassId}, ${row.student_id}, ${text}, now())
      on conflict (teaching_class_id, student_id) do update
      set computed_score = excluded.computed_score,
        computed_at = excluded.computed_at
    `;
  }
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
  const access = await authorizeGradeAccess(input.teachingClassId, input.user);
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
    gradeItemId = await sql.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        insert into grade_items (teaching_class_id, name, max_score, weight)
        values (
          ${input.teachingClassId}, ${name},
          ${scaledToText(maxScore.scaled)}, ${scaledToText(weight.scaled)}
        )
        returning id
      `;
      await recomputeOveralls(tx, input.teachingClassId);
      return inserted[0]!.id;
    });
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
