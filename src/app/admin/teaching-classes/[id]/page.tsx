import Link from "next/link";
import { notFound } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { listAdministrativeClasses } from "@/lib/administrative-classes";
import { requirePageUser } from "@/lib/auth";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/enrollment-status";
import { isUuid } from "@/lib/http";
import { listStudents } from "@/lib/students";
import { getTeachingClassDetail } from "@/lib/teaching-classes";

import {
  AddStudentForm,
  EnrollAdministrativeClassForm,
  RemoveStudentButton,
} from "../teaching-class-forms";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  whole_class: "整班加入",
  manual: "手工加入",
};

export default async function AdminTeachingClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageUser(`/admin/teaching-classes/${id}`, {
    roles: ["administrator"],
  });

  if (!isUuid(id)) notFound();
  const teachingClass = await getTeachingClassDetail(id);
  if (!teachingClass) notFound();

  const [students, administrativeClasses] = await Promise.all([
    listStudents(),
    listAdministrativeClasses(),
  ]);
  const rosterIds = new Set(teachingClass.students.map((student) => student.id));
  const candidates = students.filter(
    (student) =>
      student.enrollmentStatus === "enrolled" && !rosterIds.has(student.id),
  );

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>{teachingClass.displayName}</h1>
          <p>
            <Link href="/admin/teaching-classes">返回教学班管理</Link>
          </p>
          <p>
            <Link href="/admin/courses">课程管理</Link>
            {" · "}
            <Link href="/admin/students">学籍管理</Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <section>
        <h2>基本信息</h2>
        <table className="table">
          <tbody>
            <tr>
              <th>学期</th>
              <td>{teachingClass.term.label}</td>
            </tr>
            <tr>
              <th>课程</th>
              <td>
                {teachingClass.course.name}
                {teachingClass.course.credits !== null
                  ? `（${teachingClass.course.credits} 学分）`
                  : teachingClass.course.hours !== null
                    ? `（${teachingClass.course.hours} 课时）`
                    : ""}
              </td>
            </tr>
            <tr>
              <th>任课教师</th>
              <td>
                {teachingClass.teacher.displayName}（
                {teachingClass.teacher.loginName}）
              </td>
            </tr>
            <tr>
              <th>学生人数</th>
              <td>{teachingClass.studentCount}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>学生名单</h2>
        <p className="hint">
          名单是组建时的快照：之后学生的学籍状态变化不会自动同步到这里，
          需要时请手工移出或加入。
        </p>

        {teachingClass.students.length === 0 ? (
          <p>该教学班还没有学生。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>行政班</th>
                <th>学籍状态</th>
                <th>加入方式</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {teachingClass.students.map((student) => (
                <tr key={student.id}>
                  <td>{student.studentNumber}</td>
                  <td>{student.name}</td>
                  <td>{student.administrativeClass.name}</td>
                  <td>{ENROLLMENT_STATUS_LABELS[student.enrollmentStatus]}</td>
                  <td>{SOURCE_LABELS[student.source] ?? student.source}</td>
                  <td>
                    <RemoveStudentButton
                      teachingClassId={teachingClass.id}
                      studentId={student.id}
                      studentName={student.name}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>加入学生</h2>
        <EnrollAdministrativeClassForm
          teachingClassId={teachingClass.id}
          administrativeClasses={administrativeClasses.map(
            (administrativeClass) => ({
              id: administrativeClass.id,
              label: administrativeClass.name,
            }),
          )}
        />
        <AddStudentForm
          teachingClassId={teachingClass.id}
          students={candidates.map((student) => ({
            id: student.id,
            label: `${student.studentNumber} ${student.name}（${student.administrativeClass.name}）`,
          }))}
        />
      </section>
    </main>
  );
}
