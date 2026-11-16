import { NextResponse } from "next/server";

import { findAccountByLoginName } from "@/lib/accounts";
import {
  createSession,
  currentSessionToken,
  landingFor,
  revokeSession,
  setSessionCookie,
} from "@/lib/auth";
import {
  errorResponse,
  internalError,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/password";

/**
 * 空密码、错误密码、不存在的账号、已停用账号共用这一条提示。
 * 不区分原因，避免通过响应判断账号是否存在或是否被停用。
 */
const LOGIN_FAILED = "登录名或密码错误。";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const loginName =
    typeof body?.loginName === "string" ? body.loginName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  try {
    const account = loginName ? await findAccountByLoginName(loginName) : null;

    // 账号不存在时也做一次同等代价的 Argon2id 校验。
    const passwordOk = await verifyPassword(
      account?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    if (!account || account.disabled || !passwordOk) {
      return errorResponse(LOGIN_FAILED, 401);
    }

    // 登录即轮换：丢弃浏览器带来的旧会话，签发全新的服务端会话。
    const existing = await currentSessionToken();
    if (existing) {
      await revokeSession(existing);
    }

    const token = await createSession(account.id);
    const response = NextResponse.json(
      { ok: true, redirectTo: landingFor(account, body?.next) },
      { headers: NO_STORE },
    );
    return setSessionCookie(response, token);
  } catch (error) {
    return internalError(error);
  }
}
