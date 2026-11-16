import { getDb } from "@/db";
import type { TermHalf } from "@/db/schema";
import { academicYearLabel, termLabel } from "@/lib/term-labels";

export { isTermHalf } from "@/lib/term-labels";

export type TermSummary = {
  id: string;
  half: TermHalf;
  label: string;
  academicYearId: string;
  startYear: number;
  academicYearLabel: string;
  isCurrent: boolean;
};

export type AcademicYearSummary = {
  id: string;
  startYear: number;
  label: string;
  terms: TermSummary[];
};

export type TermsOverview = {
  currentTerm: TermSummary | null;
  academicYears: AcademicYearSummary[];
};

export type AcademicYear = {
  id: string;
  startYear: number;
  label: string;
};

type AcademicYearRow = {
  id: string;
  start_year: number;
};

type TermRow = {
  id: string;
  half: TermHalf;
  academic_year_id: string;
  start_year: number;
  is_current: boolean;
};

function toAcademicYear(row: AcademicYearRow): AcademicYear {
  return {
    id: row.id,
    startYear: row.start_year,
    label: academicYearLabel(row.start_year),
  };
}

function toTerm(row: TermRow): TermSummary {
  return {
    id: row.id,
    half: row.half,
    label: termLabel(row.start_year, row.half),
    academicYearId: row.academic_year_id,
    startYear: row.start_year,
    academicYearLabel: academicYearLabel(row.start_year),
    isCurrent: row.is_current,
  };
}

export async function createAcademicYear(
  startYear: number,
): Promise<AcademicYear> {
  const sql = getDb();
  const rows = await sql<AcademicYearRow[]>`
    insert into academic_years (start_year)
    values (${startYear})
    returning id, start_year
  `;
  return toAcademicYear(rows[0]!);
}

export async function findAcademicYear(
  id: string,
): Promise<AcademicYear | null> {
  const sql = getDb();
  const rows = await sql<AcademicYearRow[]>`
    select id, start_year from academic_years where id = ${id} limit 1
  `;
  const row = rows[0];
  return row ? toAcademicYear(row) : null;
}

/**
 * 创建学期。学年不存在时返回 null，由接口层给出中文错误。
 */
export async function createTerm(input: {
  academicYearId: string;
  half: TermHalf;
}): Promise<TermSummary | null> {
  const academicYear = await findAcademicYear(input.academicYearId);
  if (!academicYear) return null;

  const sql = getDb();
  const rows = await sql<TermRow[]>`
    insert into terms (academic_year_id, half)
    values (${input.academicYearId}, ${input.half})
    returning id, half, academic_year_id,
      ${academicYear.startYear}::int as start_year,
      false as is_current
  `;
  return toTerm(rows[0]!);
}

/**
 * 学期列表：按学年分组，学年从新到旧，学年内按上、下排序。
 * 任何已登录用户都可以读取。
 */
export async function listTermsOverview(): Promise<TermsOverview> {
  const sql = getDb();
  const years = await sql<AcademicYearRow[]>`
    select id, start_year from academic_years order by start_year desc
  `;
  const terms = await sql<TermRow[]>`
    select t.id, t.half, t.academic_year_id, y.start_year,
      coalesce(s.current_term_id = t.id, false) as is_current
    from terms t
    join academic_years y on y.id = t.academic_year_id
    left join term_settings s on s.id = 'singleton'
    order by y.start_year desc,
      case t.half when 'first' then 1 else 2 end
  `;

  const grouped = new Map<string, AcademicYearSummary>();
  for (const year of years) {
    grouped.set(year.id, { ...toAcademicYear(year), terms: [] });
  }

  let currentTerm: TermSummary | null = null;
  for (const row of terms) {
    const term = toTerm(row);
    grouped.get(term.academicYearId)?.terms.push(term);
    if (term.isCurrent) currentTerm = term;
  }

  return { currentTerm, academicYears: [...grouped.values()] };
}

export async function getTermById(
  id: string,
): Promise<TermSummary | null> {
  const sql = getDb();
  const rows = await sql<TermRow[]>`
    select t.id, t.half, t.academic_year_id, y.start_year,
      coalesce(s.current_term_id = t.id, false) as is_current
    from terms t
    join academic_years y on y.id = t.academic_year_id
    left join term_settings s on s.id = 'singleton'
    where t.id = ${id}
    limit 1
  `;
  const row = rows[0];
  return row ? toTerm(row) : null;
}

export async function getCurrentTerm(): Promise<TermSummary | null> {
  const overview = await listTermsOverview();
  return overview.currentTerm;
}

/**
 * 把某个学期设为全局唯一的当前学期。单行设置表用 upsert 写入，
 * 旧值被覆盖，因此任何时刻至多有一个当前学期。
 */
export async function setCurrentTerm(
  termId: string,
): Promise<TermSummary | null> {
  const term = await getTermById(termId);
  if (!term) return null;

  const sql = getDb();
  await sql`
    insert into term_settings (id, current_term_id, updated_at)
    values ('singleton', ${termId}, now())
    on conflict (id) do update
      set current_term_id = excluded.current_term_id,
          updated_at = now()
  `;
  return getTermById(termId);
}
