import Link from "next/link";

import { CurrentTermScope } from "@/components/current-term-scope";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { listTeachingClassesByTerm } from "@/lib/teaching-classes";
import { getCurrentTerm } from "@/lib/terms";

export const dynamic = "force-dynamic";

export default async function TeacherTeachingClassesPage() {
  const user = await requirePageUser("/teacher/teaching-classes", {
    roles: ["teacher"],
  });
  const currentTerm = await getCurrentTerm();
  const teachingClasses = currentTerm
    ? await listTeachingClassesByTerm(currentTerm.id, user.id)
    : [];

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>我的教学班</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p>
            <Link href="/teacher">返回工作台</Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <CurrentTermScope />

      {currentTerm === null ? null : teachingClasses.length === 0 ? (
        <p>本学期还没有任教的教学班。如需调整，请联系教务管理员。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>教学班</th>
              <th>课程</th>
              <th>学期</th>
              <th>学生人数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {teachingClasses.map((teachingClass) => (
              <tr key={teachingClass.id}>
                <td>{teachingClass.displayName}</td>
                <td>{teachingClass.course.name}</td>
                <td>{teachingClass.term.label}</td>
                <td>{teachingClass.studentCount}</td>
                <td>
                  <a href={`/teacher/teaching-classes/${teachingClass.id}`}>
                    查看名单
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
