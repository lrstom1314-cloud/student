import Link from "next/link";

import { GradeLogTable } from "@/components/grade-log-table";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import {
  listGradeChangeLogsByStudent,
  listGradeChangeLogsByTeachingClass,
  type GradeChangeLogEntry,
} from "@/lib/grade-logs";
import { isUuid } from "@/lib/http";
import { listStudents } from "@/lib/students";
import {
  findTeachingClass,
  listAllTeachingClasses,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 教务管理员查询成绩变更日志：可按教学班，也可按学生（跨教学班）。
 * 页面按时间倒序展示谁、何时、哪个学生、哪一项、旧值→新值、动作。
 */
export default async function AdminGradeLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ teachingClassId?: string; studentId?: string }>;
}) {
  await requirePageUser("/admin/grade-logs", { roles: ["administrator"] });

  const params = await searchParams;
  const teachingClassId =
    typeof params.teachingClassId === "string" &&
    isUuid(params.teachingClassId)
      ? params.teachingClassId
      : null;
  const studentId =
    typeof params.studentId === "string" && isUuid(params.studentId)
      ? params.studentId
      : null;

  const [teachingClasses, students] = await Promise.all([
    listAllTeachingClasses(),
    listStudents(),
  ]);

  const teachingClass = teachingClassId
    ? await findTeachingClass(teachingClassId)
    : null;
  const student = studentId
    ? students.find((entry) => entry.id === studentId)
    : null;

  let logs: GradeChangeLogEntry[] = [];
  if (teachingClassId !== null) {
    logs = await listGradeChangeLogsByTeachingClass(
      teachingClassId,
      studentId === null ? {} : { studentId },
    );
  } else if (studentId !== null) {
    logs = await listGradeChangeLogsByStudent(studentId);
  }

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>成绩变更日志</h1>
          <p>
            <Link href="/admin/teaching-classes">教学班管理</Link>
            {" · "}
            <Link href="/admin/students">学籍管理</Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <section>
        <h2>查询</h2>
        <form
          method="get"
          action="/admin/grade-logs"
          className="form form-inline"
        >
          <label className="form-field">
            <span>按教学班查询</span>
            <select
              name="teachingClassId"
              required
              defaultValue={teachingClassId ?? ""}
            >
              <option value="">选择教学班</option>
              {teachingClasses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.term.label} · {entry.displayName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">查询教学班</button>
        </form>

        <form
          method="get"
          action="/admin/grade-logs"
          className="form form-inline"
        >
          <label className="form-field">
            <span>按学生查询</span>
            <select name="studentId" required defaultValue={studentId ?? ""}>
              <option value="">选择学生</option>
              {students.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.studentNumber} {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">查询学生</button>
        </form>
      </section>

      <section>
        <h2>
          变更记录
          {teachingClass
            ? `：${teachingClass.displayName}`
            : student
              ? `：${student.studentNumber} ${student.name}`
              : ""}
        </h2>
        {teachingClassId !== null && teachingClass === null ? (
          <p className="form-error" role="alert">
            教学班不存在。
          </p>
        ) : studentId !== null && student === undefined ? (
          <p className="form-error" role="alert">
            学生不存在。
          </p>
        ) : (
          <GradeLogTable entries={logs} />
        )}
      </section>
    </main>
  );
}
