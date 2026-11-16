import { CurrentTermScope } from "@/components/current-term-scope";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TeacherPage() {
  const user = await requirePageUser("/teacher", { roles: ["teacher"] });

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>教师工作台</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p>
            <a href="/teacher/teaching-classes">我的教学班</a>
          </p>
        </div>
        <LogoutButton />
      </header>
      <CurrentTermScope />
      <p>课表可在「我的教学班」详情页维护；成绩录入将在后续功能中加入。</p>
    </main>
  );
}
