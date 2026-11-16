import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import {
  authorizeGradeAccess,
  getGradeSheet,
  type GradeSheet,
} from "@/lib/grades";
import type { TeachingClassSummary } from "@/lib/teaching-classes";

/**
 * 导出内容固定为「最后一次发布的快照」，而不是 student_grades 等实时表。
 * 解锁期间教师继续改分时，导出的文件仍与上一次发布一致，不会漂移。
 * 从未发布过的教学班才回落到实时草稿，并在文件名与首行明确标注「未发布」。
 */
const DRAFT_NOTICE =
  "未发布：本教学班成绩尚未发布，以下为教师草稿，不是正式成绩。";

/** 缺考/未录入在导出里显式写成「未录入」，绝不折算成 0 分。 */
const MISSING = "未录入";

type PublicationRow = { id: string; version: number; published_at: Date };

type PublicationItemRow = { grade_item_id: string; name: string };

type PublicationOverallRow = {
  student_id: string;
  student_number: string;
  student_name: string;
  final_score: string | null;
};

type PublicationScoreRow = {
  grade_item_id: string;
  student_id: string;
  score: string;
};

export type GradeExport = {
  filename: string;
  /** 已含 UTF-8 BOM 的 CSV 文本。 */
  content: string;
  published: boolean;
  publicationVersion: number | null;
};

export type GradeExportResult =
  | { ok: true; export: GradeExport }
  | { ok: false; status: number; error: string };

/**
 * 去掉小数末尾的 0，让 85.00 显示为 85、85.50 显示为 85.5。
 * 缺失值一律返回空字符串，绝不补 0。
 */
function formatScoreText(value: string | number | null): string {
  if (value === null) return "";
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (raw.length === 0) return "";
  if (!raw.includes(".")) return raw;
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/** RFC 4180：含逗号、引号或换行的字段用引号包裹，内部引号翻倍。 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** 文件名里不能出现的字符统一替换，避免下载时被浏览器丢弃或截断。 */
function sanitizeFilenameBase(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "成绩表";
}

/** RFC 5987 的 ext-value 编码：中文文件名必须这样传，否则会变成乱码。 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * 同时提供 ASCII 兜底文件名和 RFC 5987 的 UTF-8 文件名：
 * 旧客户端用前者，现代浏览器（含 Excel）用后者拿到正确中文名。
 */
export function contentDisposition(filename: string): string {
  return `attachment; filename="grade-sheet.csv"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function buildRows(
  items: Array<{ id: string; name: string }>,
  students: Array<{
    id: string;
    studentNumber: string;
    name: string;
    scores: Map<string, string | null>;
    overall: string | null;
  }>,
): string[][] {
  return students.map((student) => [
    student.studentNumber,
    student.name,
    ...items.map((item) => {
      const score = student.scores.get(item.id) ?? null;
      return score === null ? MISSING : formatScoreText(score);
    }),
    student.overall === null ? MISSING : formatScoreText(student.overall),
  ]);
}

function assembleCsv(input: {
  notice: string | null;
  items: Array<{ id: string; name: string }>;
  rows: string[][];
}): string {
  const lines: string[] = [];
  if (input.notice !== null) lines.push(csvLine([input.notice]));
  lines.push(
    csvLine(["学号", "姓名", ...input.items.map((item) => item.name), "总评"]),
  );
  for (const row of input.rows) lines.push(csvLine(row));
  // 末尾换行让 Excel 与命令行工具都把最后一行当作完整记录。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

async function fromPublication(
  teachingClass: TeachingClassSummary,
  publication: PublicationRow,
): Promise<GradeExport> {
  const sql = getDb();
  const [itemRows, overallRows, scoreRows] = await Promise.all([
    sql<PublicationItemRow[]>`
      select grade_item_id, name
      from grade_publication_items
      where publication_id = ${publication.id}
      order by position
    `,
    sql<PublicationOverallRow[]>`
      select student_id, student_number, student_name,
        final_score::text as final_score
      from grade_publication_overalls
      where publication_id = ${publication.id}
      order by student_number, student_id
    `,
    sql<PublicationScoreRow[]>`
      select grade_item_id, student_id, score::text as score
      from grade_publication_scores
      where publication_id = ${publication.id}
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

  const items = itemRows.map((row) => ({
    id: row.grade_item_id,
    name: row.name,
  }));
  const rows = buildRows(
    items,
    overallRows.map((row) => ({
      id: row.student_id,
      studentNumber: row.student_number,
      name: row.student_name,
      scores: scoresByStudent.get(row.student_id) ?? new Map(),
      overall: row.final_score,
    })),
  );

  return {
    filename: `${sanitizeFilenameBase(
      `${teachingClass.term.label} ${teachingClass.displayName} 成绩表`,
    )}.csv`,
    content: assembleCsv({ notice: null, items, rows }),
    published: true,
    publicationVersion: publication.version,
  };
}

function fromLiveDraft(
  teachingClass: TeachingClassSummary,
  sheet: GradeSheet,
): GradeExport {
  const items = sheet.gradeItems.map((item) => ({
    id: item.id,
    name: item.name,
  }));
  const rows = sheet.students.map((student) => [
    student.studentNumber,
    student.name,
    ...items.map((item) => {
      const score = student.grades[item.id] ?? null;
      return score === null ? MISSING : formatScoreText(score);
    }),
    student.overall.finalScore === null
      ? MISSING
      : formatScoreText(student.overall.finalScore),
  ]);

  return {
    filename: `${sanitizeFilenameBase(
      `${teachingClass.term.label} ${teachingClass.displayName} 成绩表（未发布）`,
    )}.csv`,
    content: assembleCsv({ notice: DRAFT_NOTICE, items, rows }),
    published: false,
    publicationVersion: null,
  };
}

/**
 * 导出入参是会话用户与教学班 ID。权限与成绩录入一致：
 * 教务管理员全库，教师仅自己任教的教学班，学生与其他教师一律 403。
 */
export async function buildGradeExport(
  teachingClassId: string,
  user: SessionUser,
): Promise<GradeExportResult> {
  const access = await authorizeGradeAccess(teachingClassId, user);
  if (!access.ok) return access;

  const sql = getDb();
  const publicationRows = await sql<PublicationRow[]>`
    select id, version, published_at
    from grade_publications
    where teaching_class_id = ${teachingClassId}
    order by version desc
    limit 1
  `;
  const publication = publicationRows[0];
  if (publication) {
    return {
      ok: true,
      export: await fromPublication(access.teachingClass, publication),
    };
  }

  const sheet = await getGradeSheet(teachingClassId);
  if (!sheet) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }
  return { ok: true, export: fromLiveDraft(access.teachingClass, sheet) };
}
