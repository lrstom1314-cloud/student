import { getDb } from "@/db";
import type { GradeChangeAction, GradeChangeTarget } from "@/db/schema";

export type GradeChangeLogEntry = {
  id: string;
  createdAt: string;
  action: GradeChangeAction;
  target: GradeChangeTarget;
  oldValue: number | null;
  newValue: number | null;
  reason: string | null;
  actor: { id: string; loginName: string; displayName: string };
  teachingClass: { id: string; displayName: string };
  student: { id: string; studentNumber: string; name: string } | null;
  gradeItem: { id: string; name: string } | null;
};

type LogRow = {
  id: string;
  created_at: Date;
  action: GradeChangeAction;
  target: GradeChangeTarget;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  actor_id: string;
  actor_login_name: string;
  actor_display_name: string;
  teaching_class_id: string;
  teaching_class_display_name: string;
  student_id: string | null;
  student_number: string | null;
  student_name: string | null;
  grade_item_id: string | null;
  grade_item_name: string | null;
};

const LOG_SELECT = `
  select gcl.id, gcl.created_at, gcl.action, gcl.target,
    gcl.old_value::text as old_value, gcl.new_value::text as new_value,
    gcl.reason,
    a.id as actor_id, a.login_name as actor_login_name,
    a.display_name as actor_display_name,
    tc.id as teaching_class_id,
    tc.display_name as teaching_class_display_name,
    s.id as student_id, s.student_number, s.name as student_name,
    gi.id as grade_item_id, gi.name as grade_item_name
  from grade_change_logs gcl
  join accounts a on a.id = gcl.actor_account_id
  join teaching_classes tc on tc.id = gcl.teaching_class_id
  left join students s on s.id = gcl.student_id
  left join grade_items gi on gi.id = gcl.grade_item_id
`;

const LOG_ORDER = `order by gcl.created_at desc, gcl.id desc`;

function decimalTextToNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEntry(row: LogRow): GradeChangeLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    action: row.action,
    target: row.target,
    oldValue: decimalTextToNumber(row.old_value),
    newValue: decimalTextToNumber(row.new_value),
    reason: row.reason,
    actor: {
      id: row.actor_id,
      loginName: row.actor_login_name,
      displayName: row.actor_display_name,
    },
    teachingClass: {
      id: row.teaching_class_id,
      displayName: row.teaching_class_display_name,
    },
    student:
      row.student_id === null
        ? null
        : {
            id: row.student_id,
            studentNumber: row.student_number ?? "",
            name: row.student_name ?? "",
          },
    gradeItem:
      row.grade_item_id === null
        ? null
        : { id: row.grade_item_id, name: row.grade_item_name ?? "" },
  };
}

/** 某教学班的全部变更日志，可按学生过滤；按时间倒序。 */
export async function listGradeChangeLogsByTeachingClass(
  teachingClassId: string,
  options: { studentId?: string } = {},
): Promise<GradeChangeLogEntry[]> {
  const sql = getDb();
  const rows = options.studentId
    ? await sql.unsafe<LogRow[]>(
        `${LOG_SELECT}
         where gcl.teaching_class_id = $1 and gcl.student_id = $2
         ${LOG_ORDER}`,
        [teachingClassId, options.studentId],
      )
    : await sql.unsafe<LogRow[]>(
        `${LOG_SELECT}
         where gcl.teaching_class_id = $1
         ${LOG_ORDER}`,
        [teachingClassId],
      );
  return rows.map(toEntry);
}

/** 某学生的全部变更日志，跨教学班；教务管理员按学生追溯时使用。 */
export async function listGradeChangeLogsByStudent(
  studentId: string,
): Promise<GradeChangeLogEntry[]> {
  const sql = getDb();
  const rows = await sql.unsafe<LogRow[]>(
    `${LOG_SELECT}
     where gcl.student_id = $1
     ${LOG_ORDER}`,
    [studentId],
  );
  return rows.map(toEntry);
}
