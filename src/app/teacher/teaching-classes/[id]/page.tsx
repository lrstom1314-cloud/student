import Link from "next/link";
import { forbidden, notFound } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/enrollment-status";
import { isUuid } from "@/lib/http";
import {
  getTeachingClassDetail,
  isTeachingClassTeacher,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

export default async function TeacherTeachingClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/teacher/teaching-classes/${id}`, {
    roles: ["teacher"],
  });

  if (!isUuid(id)) notFound();
  // 教师只能进入自己任教的教学班，其他教学班由服务端渲染 403。
  if (!(await isTeachingClassTeacher(id, user.id))) forbidden();

  const teachingClass = await getTeachingClassDetail(id);
  if (!teachingClass) notFound();

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>{teachingClass.displayName}</h1>
          <p>
            <Link href="/teacher/teaching-classes">返回我的教学班</Link>
            {" · "}
            <Link href={`/teacher/teaching-classes/${id}/grades`}>
              录入成绩
            </Link>
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
              <td>{teachingClass.teacher.displayName}</td>
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
              </tr>
            </thead>
            <tbody>
              {teachingClass.students.map((student) => (
                <tr key={student.id}>
                  <td>{student.studentNumber}</td>
                  <td>{student.name}</td>
                  <td>{student.administrativeClass.name}</td>
                  <td>{ENROLLMENT_STATUS_LABELS[student.enrollmentStatus]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
