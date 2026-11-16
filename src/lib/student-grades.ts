import { getDb } from "@/db";
import { termLabel } from "@/lib/term-labels";
import { getCurrentTerm, type TermSummary } from "@/lib/terms";

/**
 * 学生看到的一门课：只有在该教学班发生过发布之后才有成绩字段。
 * 草稿态（含已解锁但尚未重新发布）严格只返回 published: false，
 * 不携带任何分数、状态或成绩项，避免「看到 0 分」或「看到未完成」。
 */
export type StudentGradeCourse =
  | {
      teachingClass: {
        id: string;
        displayName: string;
        courseName: string;
        teacherName: string;
        termLabel: string;
      };
      published: false;
    }
  | {
      teachingClass: {
        id: string;
        displayName: string;
        courseName: string;
        teacherName: string;
        termLabel: string;
      };
      published: true;
      publication: { id: string; version: number; publishedAt: string };
      overall: {
        computedScore: number | null;
        overrideScore: number | null;
        finalScore: number | null;
        finalSource: "computed" | "override" | null;
        status: "complete" | "incomplete";
      };
      items: Array<{
        gradeItemId: string;
        name: string;
        maxScore: number;
        weight: number;
        score: number | null;
      }>;
    };

export type StudentGradeReport = {
  /** 全局唯一的当前学期；未设置时为 null。 */
  currentTerm: TermSummary | null;
  /** 学生端固定的学期范围，永远等于 currentTerm，不开放历史学期入口。 */
  term: TermSummary | null;
  student: { id: string; studentNumber: string; name: string } | null;
  courses: StudentGradeCourse[];
};

type StudentRow = {
  id: string;
  student_number: string;
  name: string;
};

type CourseRow = {
  id: string;
  display_name: string;
  course_name: string;
  start_year: number;
  half: "first" | "second";
  teacher_name: string;
  publication_id: string | null;
  version: number | null;
  published_at: Date | null;
};

type ItemRow = {
  grade_item_id: string;
  name: string;
  max_score: string;
  weight: string;
  score: string | null;
};

type OverallRow = {
  computed_score: string | null;
  override_score: string | null;
  final_score: string | null;
  final_source: "computed" | "override" | null;
  status: "complete" | "incomplete";
};

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function findStudentByAccountId(
  accountId: string,
): Promise<StudentRow | null> {
  const sql = getDb();
  const rows = await sql<StudentRow[]>`
    select id, student_number, name
    from students
    where account_id = ${accountId}
    limit 1
  `;
  return rows[0] ?? null;
}

/**
 * 学生本人的成绩：范围固定为当前学期，只取自己所在的教学班。
 *
 * 读取路径严格限于发布快照（grade_publications / grade_publication_*），
 * 从不读取 student_grades 或 grade_overalls 这些实时表。因此教师解锁后
 * 继续改分时，学生仍看到上一次发布的完整结果。
 */
async function listPublishedCourses(
  studentId: string,
  termId: string,
): Promise<StudentGradeCourse[]> {
  const sql = getDb();
  const courseRows = await sql<CourseRow[]>`
    select tc.id, tc.display_name, c.name as course_name,
      y.start_year, t.half,
      teacher.display_name as teacher_name,
      p.id as publication_id, p.version, p.published_at
    from teaching_class_students roster
    join teaching_classes tc on tc.id = roster.teaching_class_id
    join courses c on c.id = tc.course_id
    join terms t on t.id = tc.term_id
    join academic_years y on y.id = t.academic_year_id
    join accounts teacher on teacher.id = tc.teacher_account_id
    left join lateral (
      select gp.id, gp.version, gp.published_at
      from grade_publications gp
      where gp.teaching_class_id = tc.id
      order by gp.version desc
      limit 1
    ) p on true
    where roster.student_id = ${studentId} and tc.term_id = ${termId}
    order by c.name, tc.display_name, tc.id
  `;

  const courses: StudentGradeCourse[] = [];
  for (const row of courseRows) {
    const teachingClass = {
      id: row.id,
      displayName: row.display_name,
      courseName: row.course_name,
      teacherName: row.teacher_name,
      termLabel: termLabel(row.start_year, row.half),
    };

    // 从未发布（或已发布后被解锁且尚未重新发布）的教学班没有任何可见数据。
    if (row.publication_id === null) {
      courses.push({ teachingClass, published: false });
      continue;
    }

    const overallRows = await sql<OverallRow[]>`
      select computed_score::text as computed_score,
        override_score::text as override_score,
        final_score::text as final_score, final_source, status
      from grade_publication_overalls
      where publication_id = ${row.publication_id}
        and student_id = ${studentId}
      limit 1
    `;
    const overall = overallRows[0];
    // 发布之后才加入名单的学生不在快照里，同样只显示「暂无成绩」。
    if (!overall) {
      courses.push({ teachingClass, published: false });
      continue;
    }

    const itemRows = await sql<ItemRow[]>`
      select gpi.grade_item_id, gpi.name,
        gpi.max_score::text as max_score, gpi.weight::text as weight,
        gps.score::text as score
      from grade_publication_items gpi
      left join grade_publication_scores gps
        on gps.publication_id = gpi.publication_id
        and gps.grade_item_id = gpi.grade_item_id
        and gps.student_id = ${studentId}
      where gpi.publication_id = ${row.publication_id}
      order by gpi.position
    `;

    courses.push({
      teachingClass,
      published: true,
      publication: {
        id: row.publication_id,
        version: row.version ?? 1,
        publishedAt: row.published_at!.toISOString(),
      },
      overall: {
        computedScore: toNumber(overall.computed_score),
        overrideScore: toNumber(overall.override_score),
        finalScore: toNumber(overall.final_score),
        finalSource: overall.final_source,
        status: overall.status,
      },
      // 快照里没有得分行就是缺考/未录入：保留 null，界面绝不折算成 0 分。
      items: itemRows.map((item) => ({
        gradeItemId: item.grade_item_id,
        name: item.name,
        maxScore: toNumber(item.max_score) ?? 0,
        weight: toNumber(item.weight) ?? 0,
        score: toNumber(item.score),
      })),
    });
  }

  return courses;
}

/**
 * 学生成绩报告的入口：当前学期 + 学生本人 + 已发布快照。
 * 未设置当前学期时返回空课程列表，由页面给出与「暂无成绩」不同的提示。
 */
export async function getStudentGradeReport(
  accountId: string,
): Promise<StudentGradeReport> {
  const currentTerm = await getCurrentTerm();
  const student = await findStudentByAccountId(accountId);
  if (!student) {
    return { currentTerm, term: currentTerm, student: null, courses: [] };
  }

  const courses = currentTerm
    ? await listPublishedCourses(student.id, currentTerm.id)
    : [];

  return {
    currentTerm,
    term: currentTerm,
    student: {
      id: student.id,
      studentNumber: student.student_number,
      name: student.name,
    },
    courses,
  };
}
