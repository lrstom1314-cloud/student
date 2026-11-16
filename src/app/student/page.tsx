import { CurrentTermScope } from "@/components/current-term-scope";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StudentPage() {
  const user = await requirePageUser("/student", { roles: ["student"] });

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>学生首页</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
        </div>
        <LogoutButton />
      </header>
      <CurrentTermScope />
      <p>课表与成绩将在后续功能中加入。</p>
    </main>
  );
}
