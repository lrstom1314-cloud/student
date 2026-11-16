import { getDb } from "@/db";

/** 对外暴露的课程信息。课程是跨学期复用的学科定义，不带学期与教师。 */
export type CourseSummary = {
  id: string;
  name: string;
  credits: number | null;
  hours: number | null;
  description: string | null;
};

type CourseRow = {
  id: string;
  name: string;
  credits: number | null;
  hours: number | null;
  description: string | null;
};

function toSummary(row: CourseRow): CourseSummary {
  return {
    id: row.id,
    name: row.name,
    credits: row.credits,
    hours: row.hours,
    description: row.description,
  };
}

export function courseNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入课程名称。";
  }
  if (value.trim().length > 64) {
    return "课程名称不能超过 64 个字符。";
  }
  return null;
}

export type ParsedMeasure =
  | { ok: true; credits: number | null; hours: number | null }
  | { ok: false; error: string };

function measureInput(value: unknown): { provided: boolean; value: number } {
  if (value === undefined || value === null || value === "") {
    return { provided: false, value: Number.NaN };
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  return {
    provided: true,
    value: Number.isFinite(parsed) ? parsed : Number.NaN,
  };
}

/**
 * 学分或课时：至少填一项，各自校验取值范围。
 * 学分允许一位小数；课时必须是正整数。
 */
export function parseCourseMeasure(
  creditsValue: unknown,
  hoursValue: unknown,
): ParsedMeasure {
  const creditsInput = measureInput(creditsValue);
  const hoursInput = measureInput(hoursValue);

  if (creditsInput.provided && Number.isNaN(creditsInput.value)) {
    return { ok: false, error: "学分必须是大于 0 的数字（最多一位小数）。" };
  }
  if (hoursInput.provided && Number.isNaN(hoursInput.value)) {
    return { ok: false, error: "课时必须是大于 0 的整数。" };
  }

  const credits = creditsInput.provided ? creditsInput.value : null;
  const hours = hoursInput.provided ? hoursInput.value : null;

  if (credits === null && hours === null) {
    return { ok: false, error: "请填写学分或课时（至少一项）。" };
  }

  if (credits !== null) {
    if (credits <= 0 || credits > 99.9) {
      return { ok: false, error: "学分必须大于 0 且不超过 99.9。" };
    }
    if (Math.round(credits * 10) !== credits * 10) {
      return { ok: false, error: "学分最多保留一位小数。" };
    }
  }

  if (hours !== null) {
    if (!Number.isInteger(hours) || hours <= 0 || hours > 9999) {
      return { ok: false, error: "课时必须是大于 0 的整数。" };
    }
  }

  return { ok: true, credits, hours };
}

/** 说明为可选字段：空白视为未填写。 */
export function parseDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value.trim();
  return description.length === 0 ? null : description;
}

export function descriptionProblem(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.trim().length > 500) {
    return "说明不能超过 500 个字符。";
  }
  return null;
}

export async function listCourses(): Promise<CourseSummary[]> {
  const sql = getDb();
  const rows = await sql<CourseRow[]>`
    select id, name, credits::float8 as credits, hours, description
    from courses
    order by name
  `;
  return rows.map(toSummary);
}

export async function findCourse(id: string): Promise<CourseSummary | null> {
  const sql = getDb();
  const rows = await sql<CourseRow[]>`
    select id, name, credits::float8 as credits, hours, description
    from courses
    where id = ${id}
    limit 1
  `;
  const row = rows[0];
  return row ? toSummary(row) : null;
}

export async function findCourseByName(
  name: string,
): Promise<CourseSummary | null> {
  const sql = getDb();
  const rows = await sql<CourseRow[]>`
    select id, name, credits::float8 as credits, hours, description
    from courses
    where name = ${name}
    limit 1
  `;
  const row = rows[0];
  return row ? toSummary(row) : null;
}

export async function createCourse(input: {
  name: string;
  credits: number | null;
  hours: number | null;
  description: string | null;
}): Promise<CourseSummary> {
  const sql = getDb();
  const rows = await sql<CourseRow[]>`
    insert into courses (name, credits, hours, description)
    values (${input.name}, ${input.credits}, ${input.hours}, ${input.description})
    returning id, name, credits::float8 as credits, hours, description
  `;
  return toSummary(rows[0]!);
}
