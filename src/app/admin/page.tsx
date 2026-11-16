import { LogoutButton } from "@/components/logout-button";
import { listAccounts } from "@/lib/accounts";
import { requirePageUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/role-label";

import {
  CreateAccountForm,
  DisabledToggle,
  ResetPasswordForm,
} from "./account-forms";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requirePageUser("/admin", {
    roles: ["administrator"],
  });
  const accounts = await listAccounts();

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>账号管理</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
        </div>
        <div className="header-actions">
          <a href="/admin/students">学籍管理</a>
          <LogoutButton />
        </div>
      </header>

      <section>
        <h2>新建账号</h2>
        <p className="hint">
          初始密码由教务管理员设置，对方首次登录后必须修改。
        </p>
        <CreateAccountForm />
      </section>

      <section>
        <h2>全部账号</h2>
        <table className="table">
          <thead>
            <tr>
              <th>登录名</th>
              <th>姓名</th>
              <th>角色</th>
              <th>状态</th>
              <th>首次改密</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.loginName}</td>
                <td>{account.displayName}</td>
                <td>{ROLE_LABELS[account.role]}</td>
                <td>{account.disabled ? "已停用" : "正常"}</td>
                <td>{account.mustChangePassword ? "需改密" : "已完成"}</td>
                <td className="actions">
                  <ResetPasswordForm
                    accountId={account.id}
                    loginName={account.loginName}
                  />
                  <DisabledToggle
                    accountId={account.id}
                    disabled={account.disabled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
