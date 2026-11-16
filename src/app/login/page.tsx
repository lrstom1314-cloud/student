import { redirect } from "next/navigation";

import { getSessionUser, landingFor } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";

  const user = await getSessionUser();
  if (user) {
    redirect(landingFor(user, next));
  }

  return (
    <main className="page">
      <h1>登录</h1>
      <p>学生、教师与教务管理员使用同一个入口登录。</p>
      <LoginForm next={next} />
      <p className="hint">
        忘记密码请联系教务管理员重置。首次登录后需要修改初始密码。
      </p>
    </main>
  );
}
