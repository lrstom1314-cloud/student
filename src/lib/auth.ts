import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import type { AccountRole } from "@/db/schema";

import { NO_STORE } from "./http";

export const SESSION_COOKIE = "student_session";

/**
 * 会话为绝对过期：签发后 7 天失效，不随访问续期。
 * 过期后无论 cookie 是否还在，服务端都拒绝。
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

const SESSION_COOKIE_SECURE = process.env.NODE_ENV === "production";

export type SessionUser = {
  id: string;
  loginName: string;
  displayName: string;
  role: AccountRole;
  mustChangePassword: boolean;
};

type SessionRow = {
  id: string;
  login_name: string;
  display_name: string;
  role: AccountRole;
  must_change_password: boolean;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function roleHome(role: AccountRole): string {
  switch (role) {
    case "student":
      return "/student";
    case "teacher":
      return "/teacher";
    case "administrator":
      return "/admin";
  }
}

/**
 * 只接受站内相对路径，拒绝协议相对地址、反斜杠与控制字符，避免开放重定向。
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;

  try {
    const url = new URL(value, "http://student.invalid");
    if (url.origin !== "http://student.invalid") return null;
    if (url.pathname === "/login") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * 登录成功后的落点：需强制改密的账号先改密，并记住原目标。
 */
export function landingFor(user: SessionUser, next?: unknown): string {
  if (user.mustChangePassword) {
    const target = safeNext(next) ?? roleHome(user.role);
    return `/change-password?next=${encodeURIComponent(target)}`;
  }
  return safeNext(next) ?? roleHome(user.role);
}

export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const sql = getDb();
  await sql`
    insert into sessions (token_hash, account_id, expires_at)
    values (${sha256(token)}, ${accountId}, ${expiresAt})
  `;
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  const sql = getDb();
  await sql`delete from sessions where token_hash = ${sha256(token)}`;
}

export async function revokeAccountSessions(accountId: string): Promise<void> {
  const sql = getDb();
  await sql`delete from sessions where account_id = ${accountId}`;
}

async function findUserByToken(token: string): Promise<SessionUser | null> {
  const sql = getDb();
  const tokenHash = sha256(token);

  const rows = await sql<SessionRow[]>`
    select a.id, a.login_name, a.display_name, a.role, a.must_change_password
    from sessions s
    join accounts a on a.id = s.account_id
    left join students st on st.account_id = a.id
    where s.token_hash = ${tokenHash}
      and s.expires_at > now()
      and a.disabled = false
      and (st.id is null or st.enrollment_status = 'enrolled')
    limit 1
  `;

  const row = rows[0];
  if (!row) {
    // 顺手清理过期会话；伪造的 token 不会命中任何行。
    await sql`
      delete from sessions
      where token_hash = ${tokenHash} and expires_at <= now()
    `;
    return null;
  }

  return {
    id: row.id,
    loginName: row.login_name,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}

export async function currentSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await currentSessionToken();
  if (!token) return null;
  return findUserByToken(token);
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  response.headers.set("cache-control", NO_STORE["cache-control"]);
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: 0,
  });
  return response;
}

type PageGuardOptions = {
  roles?: readonly AccountRole[];
  allowMustChange?: boolean;
};

/**
 * 页面守卫：未登录跳登录页并记住原目标；需改密先跳改密页；
 * 角色不符由服务端渲染 403，而不是前端隐藏。
 */
export async function requirePageUser(
  nextPath: string,
  options: PageGuardOptions = {},
): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (user.mustChangePassword && !options.allowMustChange) {
    redirect(`/change-password?next=${encodeURIComponent(nextPath)}`);
  }
  if (options.roles && !options.roles.includes(user.role)) {
    forbidden();
  }
  return user;
}

type ApiGuardOptions = {
  roles?: readonly AccountRole[];
  allowMustChange?: boolean;
};

export type ApiGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireApiUser(
  options: ApiGuardOptions = {},
): Promise<ApiGuardResult> {
  const user = await getSessionUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "请先登录。" },
        { status: 401, headers: NO_STORE },
      ),
    };
  }
  if (user.mustChangePassword && !options.allowMustChange) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "请先修改初始密码。" },
        { status: 403, headers: NO_STORE },
      ),
    };
  }
  if (options.roles && !options.roles.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "无权访问。" },
        { status: 403, headers: NO_STORE },
      ),
    };
  }
  return { ok: true, user };
}
