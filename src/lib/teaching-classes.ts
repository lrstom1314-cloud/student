import type { TransactionSql } from "postgres";

import { getDb } from "@/db";
import type {
  EnrollmentStatus,
  TeachingClassStudentSource,
} from "@/db/schema";
import { termLabel } from "@/lib/term-labels";
import {
  getCurrentTerm,
  getTermById,
  type TermSummary,
} from "@/lib/terms";

export type TeachingClassSummary = {
  id: string;
  displayName: string;
  studentCount: number;
  term: { id: string; label: string };
  course: {
    id: string;
    name: string;
    credits: number | null;
    hours: number | null;
    description: string | null;
  };
  teacher: { id: string; loginName: string; displayName: string };
};

export type TeachingClassStudent = {
  id: string;
  studentNumber: string;
  name: string;
  enrollmentStatus: EnrollmentStatus;
  source: TeachingClassStudentSource;
  addedAt: string;
  administrativeClass: { id: string; name: string };
};

export type TeachingClassDetail = TeachingClassSummary & {
  students: TeachingClassStudent[];
};

/** 整班加入的结果计数：名单是快照，非在读学生不会被纳入。 */
export type AdministrativeClassEnrollment = {
  addedCount: number;
  alreadyInClassCount: number;
  notEnrolledCount: number;
};

export type TermScope = {
  currentTerm: TermSummary | null;
  term: TermSummary | null;
};

type TeachingClassRow = {
  id: string;
  display_name: string;
  student_count: number;
  term_id: string;
  start_year: number;
  half: "first" | "second";
  course_id: string;
  course_name: string;
  credits: number | null;
  hours: number | null;
  description: string | null;
  teacher_id: string;
  teacher_login_name: string;
  teacher_display_name: string;
};

type RosterRow = {
  id: string;
  student_number: string;
  name: string;
  enrollment_status: EnrollmentStatus;
  source: TeachingClassStudentSource;
  added_at: Date;
  administrative_class_id: string;
  administrative_class_name: string;
};

function toSummary(row: TeachingClassRow): TeachingClassSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    studentCount: row.student_count,
    term: {
      id: row.term_id,
      label: termLabel(row.start_year, row.half),
    },
    course: {
      id: row.course_id,
      name: row.course_name,
      credits: row.credits,
      hours: row.hours,
      description: row.description,
    },
    teacher: {
      id: row.teacher_id,
      loginName: row.teacher_login_name,
      displayName: row.teacher_display_name,
    },
  };
}

function toStudent(row: RosterRow): TeachingClassStudent {
  return {
    id: row.id,
    studentNumber: row.student_number,
    name: row.name,
    enrollmentStatus: row.enrollment_status,
    source: row.source,
    addedAt: row.added_at.toISOString(),
    administrativeClass: {
      id: row.administrative_class_id,
      name: row.administrative_class_name,
    },
  };
}

const SUMMARY_SELECT = `
  select tc.id, tc.display_name,
    t.id as term_id, y.start_year, t.half,
    c.id as course_id, c.name as course_name,
    c.credits::float8 as credits, c.hours, c.description,
    a.id as teacher_id, a.login_name as teacher_login_name,
    a.display_name as teacher_display_name,
    (
      select count(*)::int from teaching_class_students x
      where x.teaching_class_id = tc.id
    ) as student_count
  from teaching_classes tc
  join terms t on t.id = tc.term_id
  join academic_years y on y.id = t.academic_year_id
  join courses c on c.id = tc.course_id
  join accounts a on a.id = tc.teacher_account_id
`;

const SUMMARY_ORDER = `
  order by y.start_year desc,
    case t.half when 'first' then 1 else 2 end,
    tc.display_name, tc.id
`;

export function teachingClassDisplayNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入教学班显示名。";
  }
  if (value.trim().length > 64) {
    return "教学班显示名不能超过 64 个字符。";
  }
  return null;
}

/**
 * 决定列表的学期范围：显式传学期就用它，否则用当前学期。
 * 未设置当前学期时返回 term = null，由调用方给出提示而不是报错。
 */
export async function resolveTermScope(
  termId: string | null,
): Promise<
  { ok: true; scope: TermScope } | { ok: false; status: number; error: string }
> {
  if (termId !== null) {
    const term = await getTermById(termId);
    if (!term) {
      return { ok: false, status: 400, error: "学期不存在。" };
    }
    return {
      ok: true,
      scope: { currentTerm: await getCurrentTerm(), term },
    };
  }

  const current = await getCurrentTerm();
  return { ok: true, scope: { currentTerm: current, term: current } };
}

export async function listTeachingClassesByTerm(
  termId: string,
  teacherAccountId?: string,
): Promise<TeachingClassSummary[]> {
  const sql = getDb();
  const rows = teacherAccountId
    ? await sql.unsafe<TeachingClassRow[]>(
        `${SUMMARY_SELECT} where tc.term_id = $1 and tc.teacher_account_id = $2 ${SUMMARY_ORDER}`,
        [termId, teacherAccountId],
      )
    : await sql.unsafe<TeachingClassRow[]>(
        `${SUMMARY_SELECT} where tc.term_id = $1 ${SUMMARY_ORDER}`,
        [termId],
      );
  return rows.map(toSummary);
}

export async function listTeachingClassesForStudent(
  termId: string,
  studentId: string,
): Promise<TeachingClassSummary[]> {
  const sql = getDb();
  const rows = await sql.unsafe<TeachingClassRow[]>(
    `${SUMMARY_SELECT}
     join teaching_class_students roster
       on roster.teaching_class_id = tc.id and roster.student_id = $2
     where tc.term_id = $1
     ${SUMMARY_ORDER}`,
    [termId, studentId],
  );
  return rows.map(toSummary);
}

export async function findTeachingClass(
  id: string,
): Promise<TeachingClassSummary | null> {
  const sql = getDb();
  const rows = await sql.unsafe<TeachingClassRow[]>(
    `${SUMMARY_SELECT} where tc.id = $1 limit 1`,
    [id],
  );
  const row = rows[0];
  return row ? toSummary(row) : null;
}

export async function getTeachingClassDetail(
  id: string,
): Promise<TeachingClassDetail | null> {
  const summary = await findTeachingClass(id);
  if (!summary) return null;

  const sql = getDb();
  const rows = await sql<RosterRow[]>`
    select s.id, s.student_number, s.name, s.enrollment_status,
      tcs.source, tcs.added_at,
      c.id as administrative_class_id,
      c.name as administrative_class_name
    from teaching_class_students tcs
    join students s on s.id = tcs.student_id
    join administrative_classes c on c.id = s.administrative_class_id
    where tcs.teaching_class_id = ${id}
    order by s.student_number
  `;

  return { ...summary, students: rows.map(toStudent) };
}

async function studentIdOfAccount(
  accountId: string,
): Promise<string | null> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    select id from students where account_id = ${accountId} limit 1
  `;
  return rows[0]?.id ?? null;
}

export async function listTeachingClassesForStudentAccount(
  termId: string,
  accountId: string,
): Promise<TeachingClassSummary[]> {
  const studentId = await studentIdOfAccount(accountId);
  if (!studentId) return [];
  return listTeachingClassesForStudent(termId, studentId);
}

type EnrollTxResult =
  | {
      ok: true;
      teachingClass: TeachingClassDetail;
      enrollment: AdministrativeClassEnrollment;
    }
  | { ok: false; status: number; error: string };

/**
 * 把某个行政班当前在读的学生加入教学班。已经在该名单里的学生保持原样，
 * 因此重复执行是幂等的；之后学籍状态变化不会影响已经写入的名单。
 */
async function enrollAdministrativeClassTx(
  tx: TransactionSql,
  teachingClassId: string,
  administrativeClassId: string,
): Promise<EnrollTxResult> {
  const classes = await tx<{ id: string }[]>`
    select id from administrative_classes
    where id = ${administrativeClassId}
    limit 1
  `;
  if (classes.length === 0) {
    return { ok: false, status: 400, error: "所选行政班不存在。" };
  }

  const counts = await tx<
    { total: number; enrolled: number; existing: number }[]
  >`
    select count(*)::int as total,
      count(*) filter (where s.enrollment_status = 'enrolled')::int as enrolled,
      count(*) filter (where roster.student_id is not null)::int as existing
    from students s
    left join teaching_class_students roster
      on roster.teaching_class_id = ${teachingClassId}
      and roster.student_id = s.id
    where s.administrative_class_id = ${administrativeClassId}
  `;
  const row = counts[0]!;

  const inserted = await tx<{ student_id: string }[]>`
    insert into teaching_class_students (
      teaching_class_id, student_id, source
    )
    select ${teachingClassId}, s.id, 'whole_class'
    from students s
    where s.administrative_class_id = ${administrativeClassId}
      and s.enrollment_status = 'enrolled'
    on conflict (teaching_class_id, student_id) do nothing
    returning student_id
  `;

  const detail = await getTeachingClassDetailInTx(tx, teachingClassId);
  if (!detail) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }

  return {
    ok: true,
    teachingClass: detail,
    enrollment: {
      addedCount: inserted.length,
      alreadyInClassCount: row.existing,
      notEnrolledCount: row.total - row.enrolled,
    },
  };
}

async function getTeachingClassDetailInTx(
  tx: TransactionSql,
  id: string,
): Promise<TeachingClassDetail | null> {
  const rows = await tx.unsafe<TeachingClassRow[]>(
    `${SUMMARY_SELECT} where tc.id = $1 limit 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  const students = await tx<RosterRow[]>`
    select s.id, s.student_number, s.name, s.enrollment_status,
      tcs.source, tcs.added_at,
      c.id as administrative_class_id,
      c.name as administrative_class_name
    from teaching_class_students tcs
    join students s on s.id = tcs.student_id
    join administrative_classes c on c.id = s.administrative_class_id
    where tcs.teaching_class_id = ${id}
    order by s.student_number
  `;

  return { ...toSummary(row), students: students.map(toStudent) };
}

async function findTeacher(
  tx: TransactionSql,
  accountId: string,
): Promise<{ id: string; role: string } | null> {
  const rows = await tx<{ id: string; role: string }[]>`
    select id, role from accounts where id = ${accountId} limit 1
  `;
  return rows[0] ?? null;
}

export type CreateTeachingClassResult =
  | {
      ok: true;
      teachingClass: TeachingClassDetail;
      enrollment: AdministrativeClassEnrollment | null;
    }
  | { ok: false; status: number; error: string };

export async function createTeachingClass(input: {
  termId: string;
  courseId: string;
  teacherAccountId: string;
  displayName: string;
  administrativeClassId: string | null;
}): Promise<CreateTeachingClassResult> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const terms = await tx<{ id: string }[]>`
      select id from terms where id = ${input.termId} limit 1
    `;
    if (terms.length === 0) {
      return { ok: false, status: 400, error: "所选学期不存在。" };
    }

    const courses = await tx<{ id: string }[]>`
      select id from courses where id = ${input.courseId} limit 1
    `;
    if (courses.length === 0) {
      return { ok: false, status: 400, error: "所选课程不存在。" };
    }

    const teacher = await findTeacher(tx, input.teacherAccountId);
    if (!teacher) {
      return { ok: false, status: 400, error: "所选任课教师不存在。" };
    }
    if (teacher.role !== "teacher") {
      return { ok: false, status: 400, error: "所选账号不是教师。" };
    }

    const created = await tx<{ id: string }[]>`
      insert into teaching_classes (
        term_id, course_id, teacher_account_id, display_name
      )
      values (
        ${input.termId}, ${input.courseId}, ${input.teacherAccountId},
        ${input.displayName}
      )
      returning id
    `;
    const teachingClassId = created[0]!.id;

    if (input.administrativeClassId !== null) {
      const enrolled = await enrollAdministrativeClassTx(
        tx,
        teachingClassId,
        input.administrativeClassId,
      );
      if (!enrolled.ok) return enrolled;
      return {
        ok: true,
        teachingClass: enrolled.teachingClass,
        enrollment: enrolled.enrollment,
      };
    }

    const detail = await getTeachingClassDetailInTx(tx, teachingClassId);
    if (!detail) {
      return { ok: false, status: 500, error: "教学班创建失败，请稍后再试。" };
    }
    return { ok: true, teachingClass: detail, enrollment: null };
  });
}

export type EnrollResult =
  | {
      ok: true;
      teachingClass: TeachingClassDetail;
      enrollment: AdministrativeClassEnrollment;
    }
  | { ok: false; status: number; error: string };

export async function enrollAdministrativeClass(
  teachingClassId: string,
  administrativeClassId: string,
): Promise<EnrollResult> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      select id from teaching_classes where id = ${teachingClassId} limit 1
    `;
    if (existing.length === 0) {
      return { ok: false, status: 404, error: "教学班不存在。" };
    }
    return enrollAdministrativeClassTx(
      tx,
      teachingClassId,
      administrativeClassId,
    );
  });
}

export type RosterResult =
  | { ok: true; teachingClass: TeachingClassDetail }
  | { ok: false; status: number; error: string };

/** 手工加入一位学生：只校验学生存在且当前在读。 */
export async function addStudentToTeachingClass(
  teachingClassId: string,
  studentId: string,
): Promise<RosterResult> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const classes = await tx<{ id: string }[]>`
      select id from teaching_classes where id = ${teachingClassId} limit 1
    `;
    if (classes.length === 0) {
      return { ok: false, status: 404, error: "教学班不存在。" };
    }

    const students = await tx<{ id: string; enrollment_status: string }[]>`
      select id, enrollment_status from students where id = ${studentId} limit 1
    `;
    const student = students[0];
    if (!student) {
      return { ok: false, status: 404, error: "学生不存在。" };
    }
    if (student.enrollment_status !== "enrolled") {
      return {
        ok: false,
        status: 409,
        error: "该学生不是在读状态，无法加入教学班。",
      };
    }

    const inserted = await tx<{ student_id: string }[]>`
      insert into teaching_class_students (
        teaching_class_id, student_id, source
      )
      values (${teachingClassId}, ${studentId}, 'manual')
      on conflict (teaching_class_id, student_id) do nothing
      returning student_id
    `;
    if (inserted.length === 0) {
      return {
        ok: false,
        status: 409,
        error: "该学生已在该教学班名单中。",
      };
    }

    const detail = await getTeachingClassDetailInTx(tx, teachingClassId);
    if (!detail) {
      return { ok: false, status: 404, error: "教学班不存在。" };
    }
    return { ok: true, teachingClass: detail };
  });
}

export async function removeStudentFromTeachingClass(
  teachingClassId: string,
  studentId: string,
): Promise<RosterResult> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const classes = await tx<{ id: string }[]>`
      select id from teaching_classes where id = ${teachingClassId} limit 1
    `;
    if (classes.length === 0) {
      return { ok: false, status: 404, error: "教学班不存在。" };
    }

    const removed = await tx<{ student_id: string }[]>`
      delete from teaching_class_students
      where teaching_class_id = ${teachingClassId}
        and student_id = ${studentId}
      returning student_id
    `;
    if (removed.length === 0) {
      return { ok: false, status: 404, error: "该学生不在本教学班名单中。" };
    }

    const detail = await getTeachingClassDetailInTx(tx, teachingClassId);
    if (!detail) {
      return { ok: false, status: 404, error: "教学班不存在。" };
    }
    return { ok: true, teachingClass: detail };
  });
}

/** 教师能否查看该教学班：只允许任课教师本人。 */
export async function isTeachingClassTeacher(
  teachingClassId: string,
  accountId: string,
): Promise<boolean> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    select id from teaching_classes
    where id = ${teachingClassId} and teacher_account_id = ${accountId}
    limit 1
  `;
  return rows.length > 0;
}
