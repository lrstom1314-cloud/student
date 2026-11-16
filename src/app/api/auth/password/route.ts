import { NextResponse } from "next/server";

import { findAccountByLoginName, setAccountPassword } from "@/lib/accounts";
import {
  createSession,
  landingFor,
  requireApiUser,
  revokeAccountSessions,
  setSessionCookie,
} from "@/lib/auth";
import {
  errorResponse,
  internalError,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

/**
 * 修改自己的密码。需强制改密的账号也允许访问——这是唯一放行的写接口。
 * 成功后吊销该账号全部会话并轮换当前 cookie。
 */
export async function POST(request: Request) {
  const guard = await requireApiUser({ allowMustChange: true });
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(request);
  const currentPassword =
    typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : "";

  if (currentPassword.length === 0) {
    return errorResponse("请输入当前密码。", 400);
  }

  const problem = passwordProblem(newPassword);
  if (problem) {
    return errorResponse(problem, 400);
  }

  try {
    const account = await findAccountByLoginName(guard.user.loginName);
    if (!account) {
      return errorResponse("请先登录。", 401);
    }

    const currentOk = await verifyPassword(
      account.passwordHash,
      currentPassword,
    );
    if (!currentOk) {
      return errorResponse("当前密码不正确。", 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await setAccountPassword({
      accountId: account.id,
      passwordHash,
      mustChangePassword: false,
    });
    if (!updated) {
      return errorResponse("账号不存在。", 404);
    }

    await revokeAccountSessions(account.id);
    const token = await createSession(account.id);

    const response = NextResponse.json(
      {
        ok: true,
        redirectTo: landingFor(
          { ...guard.user, mustChangePassword: false },
          body?.next,
        ),
      },
      { headers: NO_STORE },
    );
    return setSessionCookie(response, token);
  } catch (error) {
    return internalError(error);
  }
}
