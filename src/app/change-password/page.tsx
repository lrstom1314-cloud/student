import { requirePageUser } from "@/lib/auth";

import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";

  const nextPath = next
    ? `/change-password?next=${encodeURIComponent(next)}`
    : "/change-password";

  const user = await requirePageUser(nextPath, { allowMustChange: true });

  return (
    <main className="page">
      <h1>修改密码</h1>
      <p>
        当前账号：{user.displayName}（{user.loginName}）
      </p>
      <ChangePasswordForm next={next} forced={user.mustChangePassword} />
    </main>
  );
}
