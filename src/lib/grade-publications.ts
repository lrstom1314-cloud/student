import type { Sql, TransactionSql } from "postgres";

/**
 * 发布快照的读模型。
 *
 * 学生成绩报告、CSV 导出与成绩表的「最近一次发布」都从这里取数，
 * 不再各自拼 grade_publication_* 的 JOIN。发布时写入的快照表是唯一事实源。
 */

export type PublicationSummary = {
  id: string;
  version: number;
  publishedAt: Date;
};

type PublicationRow = {
  id: string;
  version: number;
  published_at: Date;
};

type OverallRow = {
  computed_score: string | null;
  override_score: string | null;
  final_score: string | null;
  final_source: "computed" | "override" | null;
  status: "complete" | "incomplete";
};

type ItemRow = {
  grade_item_id: string;
  name: string;
  max_score: string;
  weight: string;
  score: string | null;
};

export type PublishedStudentOverall = {
  computedScore: number | null;
  overrideScore: number | null;
  finalScore: number | null;
  finalSource: "computed" | "override" | null;
  status: "complete" | "incomplete";
};

export type PublishedStudentItem = {
  gradeItemId: string;
  name: string;
  maxScore: number;
  weight: number;
  score: number | null;
};

export type PublishedStudentView = {
  overall: PublishedStudentOverall;
  items: PublishedStudentItem[];
};

export type PublishedTableStudent = {
  id: string;
  studentNumber: string;
  name: string;
  scores: Map<string, string | null>;
  finalScore: string | null;
};

export type PublishedTable = {
  items: Array<{ id: string; name: string }>;
  students: PublishedTableStudent[];
};

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 教学班最近一次发布；从未发布时返回 null。 */
export async function loadLatestPublication(
  client: Sql | TransactionSql,
  teachingClassId: string,
): Promise<PublicationSummary | null> {
  const rows = await client<PublicationRow[]>`
    select id, version, published_at
    from grade_publications
    where teaching_class_id = ${teachingClassId}
    order by version desc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    publishedAt: row.published_at,
  };
}

/**
 * 一位学生在某次发布里的可见视图。
 * 发布之后才加入名单的学生没有总评行，返回 null（学生端显示「暂无成绩」）。
 */
export async function loadPublishedStudentView(
  client: Sql | TransactionSql,
  publicationId: string,
  studentId: string,
): Promise<PublishedStudentView | null> {
  const [overallRows, itemRows] = await Promise.all([
    client<OverallRow[]>`
      select computed_score::text as computed_score,
        override_score::text as override_score,
        final_score::text as final_score, final_source, status
      from grade_publication_overalls
      where publication_id = ${publicationId}
        and student_id = ${studentId}
      limit 1
    `,
    client<ItemRow[]>`
      select gpi.grade_item_id, gpi.name,
        gpi.max_score::text as max_score, gpi.weight::text as weight,
        gps.score::text as score
      from grade_publication_items gpi
      left join grade_publication_scores gps
        on gps.publication_id = gpi.publication_id
        and gps.grade_item_id = gpi.grade_item_id
        and gps.student_id = ${studentId}
      where gpi.publication_id = ${publicationId}
      order by gpi.position
    `,
  ]);

  const overall = overallRows[0];
  if (!overall) return null;

  return {
    overall: {
      computedScore: numberOrNull(overall.computed_score),
      overrideScore: numberOrNull(overall.override_score),
      finalScore: numberOrNull(overall.final_score),
      finalSource: overall.final_source,
      status: overall.status,
    },
    items: itemRows.map((item) => ({
      gradeItemId: item.grade_item_id,
      name: item.name,
      maxScore: numberOrNull(item.max_score) ?? 0,
      weight: numberOrNull(item.weight) ?? 0,
      score: numberOrNull(item.score),
    })),
  };
}

/** 整张发布快照，供 CSV 导出使用。 */
export async function loadPublicationTable(
  client: Sql | TransactionSql,
  publicationId: string,
): Promise<PublishedTable> {
  const [itemRows, overallRows, scoreRows] = await Promise.all([
    client<{ grade_item_id: string; name: string }[]>`
      select grade_item_id, name
      from grade_publication_items
      where publication_id = ${publicationId}
      order by position
    `,
    client<
      {
        student_id: string;
        student_number: string;
        student_name: string;
        final_score: string | null;
      }[]
    >`
      select student_id, student_number, student_name,
        final_score::text as final_score
      from grade_publication_overalls
      where publication_id = ${publicationId}
      order by student_number, student_id
    `,
    client<
      { grade_item_id: string; student_id: string; score: string | null }[]
    >`
      select grade_item_id, student_id, score::text as score
      from grade_publication_scores
      where publication_id = ${publicationId}
    `,
  ]);

  const scoresByStudent = new Map<string, Map<string, string | null>>();
  for (const row of scoreRows) {
    let byItem = scoresByStudent.get(row.student_id);
    if (!byItem) {
      byItem = new Map();
      scoresByStudent.set(row.student_id, byItem);
    }
    byItem.set(row.grade_item_id, row.score);
  }

  return {
    items: itemRows.map((row) => ({ id: row.grade_item_id, name: row.name })),
    students: overallRows.map((row) => ({
      id: row.student_id,
      studentNumber: row.student_number,
      name: row.student_name,
      scores: scoresByStudent.get(row.student_id) ?? new Map(),
      finalScore: row.final_score,
    })),
  };
}
