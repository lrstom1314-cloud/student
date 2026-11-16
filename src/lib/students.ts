import { getDb } from "@/db";
import type { EnrollmentStatus } from "@/db/schema";
import { enrollmentStatus } from "@/db/schema";

/** 对外暴露的学生学籍信息。永远不包含密码哈希。 */
export type StudentSummary = {
  id: string;
  studentNumber: string;
  name: string;
  enrollmentStatus: EnrollmentStatus;
  administrativeClass: { id: string; name: string };
};

type StudentRow = {
  id: string;
  student_number: string;
  name: string;
  enrollment_status: EnrollmentStatus;
  administrative_class_id: string;
  administrative_class_name: string;
};

export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] =
  enrollmentStatus.enumValues;

export function isEnrollmentStatus(value: unknown): value is EnrollmentStatus {
  return (
    typeof value === "string" &&
    ENROLLMENT_STATUSES.includes(value as EnrollmentStatus)
  );
}

export function studentNumberProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入学号。";
  }
  const studentNumber = value.trim();
  if (studentNumber.length > 64) {
    return "学号不能超过 64 个字符。";
  }
  if (/\s/.test(studentNumber)) {
    return "学号不能包含空格。";
  }
  return null;
}

function toSummary(row: StudentRow): StudentSummary {
  return {
    id: row.id,
    studentNumber: row.student_number,
    name: row.name,
    enrollmentStatus: row.enrollment_status,
    administrativeClass: {
      id: row.administrative_class_id,
      name: row.administrative_class_name,
    },
  };
}

const STUDENT_COLUMNS = `
  s.id, s.student_number, s.name, s.enrollment_status,
  s.administrative_class_id, c.name as administrative_class_name
`;

export async function listStudents(
  administrativeClassId?: string,
): Promise<StudentSummary[]> {
  const sql = getDb();
  const rows = administrativeClassId
    ? await sql.unsafe<StudentRow[]>(
        `select ${STUDENT_COLUMNS}
         from students s
         join administrative_classes c on c.id = s.administrative_class_id
         where s.administrative_class_id = $1
         order by s.student_number`,
        [administrativeClassId],
      )
    : await sql.unsafe<StudentRow[]>(
        `select ${STUDENT_COLUMNS}
         from students s
         join administrative_classes c on c.id = s.administrative_class_id
         order by c.name, s.student_number`,
      );
  return rows.map(toSummary);
}

export type CreateStudentInput = {
  studentNumber: string;
  name: string;
  administrativeClassId: string;
  enrollmentStatus: EnrollmentStatus;
  /** 仅在该学号还没有账号时使用；已有账号时忽略，绝不改其密码。 */
  initialPasswordHash?: string;
};

export type CreateStudentResult =
  | { ok: true; student: StudentSummary }
  | { ok: false; status: number; error: string };

/**
 * 建立学籍：学生与账号 1:1，以学号为键。
 *
 * - 账号不存在：同时创建学生账号（登录名 = 学号，角色固定为学生，首登强制改密）。
 * - 账号已存在：只建立关联，不改密码；若该账号不是学生角色则拒绝。
 *
 * 学生在同一事务内写入，任何一步失败都不会留下半个学生。
 */
export async function createStudent(
  input: CreateStudentInput,
): Promise<CreateStudentResult> {
  const sql = getDb();

  return sql.begin(async (tx) => {
    const classes = await tx<{ id: string; name: string }[]>`
      select id, name from administrative_classes
      where id = ${input.administrativeClassId}
      limit 1
    `;
    const administrativeClass = classes[0];
    if (!administrativeClass) {
      return {
        ok: false,
        status: 400,
        error: "所选行政班不存在。",
      } satisfies CreateStudentResult;
    }

    const existingStudents = await tx<{ id: string }[]>`
      select id from students where student_number = ${input.studentNumber} limit 1
    `;
    if (existingStudents.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `学号 ${input.studentNumber} 已存在，请勿重复录入。`,
      } satisfies CreateStudentResult;
    }

    const existingAccounts = await tx<{ id: string; role: string }[]>`
      select id, role from accounts where login_name = ${input.studentNumber} limit 1
    `;
    const existingAccount = existingAccounts[0];

    let accountId: string;
    if (existingAccount) {
      if (existingAccount.role !== "student") {
        return {
          ok: false,
          status: 409,
          error: `登录名 ${input.studentNumber} 已被非学生账号占用，请先处理该账号。`,
        } satisfies CreateStudentResult;
      }
      accountId = existingAccount.id;
    } else {
      if (!input.initialPasswordHash) {
        return {
          ok: false,
          status: 400,
          error: "该学号还没有账号，请设置初始密码。",
        } satisfies CreateStudentResult;
      }
      const created = await tx<{ id: string }[]>`
        insert into accounts (
          login_name, display_name, password_hash, role,
          must_change_password, disabled
        )
        values (
          ${input.studentNumber}, ${input.name}, ${input.initialPasswordHash},
          'student', true, false
        )
        returning id
      `;
      accountId = created[0]!.id;
    }

    const rows = await tx<{
      id: string;
      student_number: string;
      name: string;
      enrollment_status: EnrollmentStatus;
      administrative_class_id: string;
    }[]>`
      insert into students (
        student_number, name, administrative_class_id,
        enrollment_status, account_id
      )
      values (
        ${input.studentNumber}, ${input.name}, ${input.administrativeClassId},
        ${input.enrollmentStatus}, ${accountId}
      )
      returning id, student_number, name, enrollment_status,
                administrative_class_id
    `;

    const row = rows[0]!;
    return {
      ok: true,
      student: toSummary({
        ...row,
        administrative_class_name: administrativeClass.name,
      }),
    } satisfies CreateStudentResult;
  });
}
