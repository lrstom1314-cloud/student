import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { listCourses, type CourseSummary } from "@/lib/courses";

import { CreateCourseForm } from "./course-forms";

export const dynamic = "force-dynamic";

function measureLabel(course: CourseSummary): string {
  const parts: string[] = [];
  if (course.credits !== null) parts.push(`${course.credits} 学分`);
  if (course.hours !== null) parts.push(`${course.hours} 课时`);
  return parts.join(" / ");
}

export default async function AdminCoursesPage() {
  const user = await requirePageUser("/admin/courses", {
    roles: ["administrator"],
  });
  const courses = await listCourses();

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>课程管理</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p>
            <Link href="/admin">返回账号管理</Link>
            {" · "}
            <Link href="/admin/teaching-classes">教学班管理</Link>
          </p>
        </div>
        <div className="header-actions">
          <a href="/admin/teaching-classes">教学班</a>
          <LogoutButton />
        </div>
      </header>

      <section>
        <h2>新建课程</h2>
        <p className="hint">
          课程是跨学期复用的学科定义，只记录名称、学分或课时与说明；
          同一门课换学期、换教师时不必重复创建。
        </p>
        <CreateCourseForm />
      </section>

      <section>
        <h2>全部课程</h2>
        {courses.length === 0 ? (
          <p>还没有课程，请先新建课程。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>课程名称</th>
                <th>学分与课时</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>{course.name}</td>
                  <td>{measureLabel(course)}</td>
                  <td>{course.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
