import { getDb } from "@/db";
import {
  loadLatestPublication,
  loadPublishedStudentView,
} from "@/lib/grade-publications";
import { isUuid } from "@/lib/http";
import { termLabel } from "@/lib/term-labels";
import {
  getCurrentTerm,
  getTermById,
  listTermsOverview,
  type TermSummary,
} from "@/lib/terms";

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
  /** 本次展示的学期：默认当前学期；显式指定时可以是过去的学期（只读）。 */
  term: TermSummary | null;
  /**
   * 学生端可切换的学期：该学生有教学班的学期，加上当前学期（若有）。
   * 按新到旧排列，用于首页的轻量学期切换，而不是完整的日历。
   */
  terms: TermSummary[];
  student: { id: string; studentNumber: string; name: string } | null;
  courses: StudentGradeCourse[];
};

/**
 * 学生成绩允许的学期范围。
 * - 未指定：当前学期；
 * - 显式指定：必须存在、不得晚于当前学期（历史学期只读可查，未来学期不允许）。
 */
export type StudentGradeTermResolution =
  | { ok: true; term: TermSummary | null; currentTerm: TermSummary | null }
  | { ok: false; status: number; error: string };

function halfOrder(half: "first" | "second"): number {
  return half === "first" ? 1 : 2;
}

function isAfter(term: TermSummary, reference: TermSummary): boolean {
  if (term.startYear !== reference.startYear) {
    return term.startYear > reference.startYear;
  }
  return halfOrder(term.half) > halfOrder(reference.half);
}

export async function resolveStudentGradeTerm(
  termId: string | null,
): Promise<StudentGradeTermResolution> {
  const currentTerm = await getCurrentTerm();
  if (termId === null) {
    return { ok: true, term: currentTerm, currentTerm };
  }

  if (!isUuid(termId)) {
    return { ok: false, status: 400, error: "学期参数无法识别。" };
  }

  const term = await getTermById(termId);
  if (!term) {
    return { ok: false, status: 404, error: "学期不存在。" };
  }
  if (!currentTerm) {
    return {
      ok: false,
      status: 400,
      error: "尚未设置当前学期，暂时无法查看其它学期。",
    };
  }
  if (term.id === currentTerm.id) {
    return { ok: true, term, currentTerm };
  }
  if (isAfter(term, currentTerm)) {
    return {
      ok: false,
      status: 400,
      error: "不能查看未来学期的成绩，只能查看当前学期与过去的学期。",
    };
  }
  return { ok: true, term, currentTerm };
}

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
};

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
      teacher.display_name as teacher_name
    from teaching_class_students roster
    join teaching_classes tc on tc.id = roster.teaching_class_id
    join courses c on c.id = tc.course_id
    join terms t on t.id = tc.term_id
    join academic_years y on y.id = t.academic_year_id
    join accounts teacher on teacher.id = tc.teacher_account_id
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
    const publication = await loadLatestPublication(sql, row.id);
    if (!publication) {
      courses.push({ teachingClass, published: false });
      continue;
    }

    // 发布之后才加入名单的学生不在快照里，同样只显示「暂无成绩」。
    const view = await loadPublishedStudentView(
      sql,
      publication.id,
      studentId,
    );
    if (!view) {
      courses.push({ teachingClass, published: false });
      continue;
    }

    courses.push({
      teachingClass,
      published: true,
      publication: {
        id: publication.id,
        version: publication.version,
        publishedAt: publication.publishedAt.toISOString(),
      },
      overall: view.overall,
      // 快照里没有得分行就是缺考/未录入：保留 null，界面绝不折算成 0 分。
      items: view.items,
    });
  }

  return courses;
}

/**
 * 学生可切换的学期：他有过教学班的学期，加上当前学期。
 * 排序沿用学期列表的「新到旧」，学生端因此不需要自己算学期顺序。
 */
async function listStudentTerms(
  studentId: string,
  currentTerm: TermSummary | null,
): Promise<TermSummary[]> {
  const sql = getDb();
  const rows = await sql<{ term_id: string }[]>`
    select distinct tc.term_id
    from teaching_class_students roster
    join teaching_classes tc on tc.id = roster.teaching_class_id
    where roster.student_id = ${studentId}
  `;
  const visible = new Set(rows.map((row) => row.term_id));
  if (currentTerm) visible.add(currentTerm.id);

  const overview = await listTermsOverview();
  return overview.academicYears
    .flatMap((year) => year.terms)
    .filter((term) => visible.has(term.id));
}

/**
 * 学生成绩报告的入口：学期（默认当前学期，可显式指定历史学期）+ 学生本人 + 已发布快照。
 *
 * `selectedTerm` 为 undefined 时使用当前学期；显式传 null 表示没有可展示的学期。
 * 历史学期同样只读已发布快照：从未发布或发布后被解锁且尚未重新发布的教学班
 * 仍只显示「暂无成绩」，不会因为能切换学期就泄露草稿。
 */
export async function getStudentGradeReport(
  accountId: string,
  selectedTerm?: TermSummary | null,
): Promise<StudentGradeReport> {
  const currentTerm = await getCurrentTerm();
  const term = selectedTerm === undefined ? currentTerm : selectedTerm;
  const student = await findStudentByAccountId(accountId);
  if (!student) {
    return {
      currentTerm,
      term,
      terms: [],
      student: null,
      courses: [],
    };
  }

  const [courses, terms] = await Promise.all([
    term ? listPublishedCourses(student.id, term.id) : Promise.resolve([]),
    listStudentTerms(student.id, currentTerm),
  ]);

  return {
    currentTerm,
    term,
    terms,
    student: {
      id: student.id,
      studentNumber: student.student_number,
      name: student.name,
    },
    courses,
  };
}
