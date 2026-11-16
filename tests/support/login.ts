/**
 * 登录请求的共享实现：所有 HTTP 测试都从同一个入口发真实登录请求。
 *
 * 不依赖 Vitest 的 expect，因此 Playwright 的脚手架也能复用；
 * 需要断言失败响应的测试用 loginRequest，只需要可用会话的用 loginCookie。
 */

export type LoginBody = Record<string, unknown>;

export type LoginResult = {
  response: Response;
  body: LoginBody;
  /** 可直接放进后续请求 Cookie 头的 `name=value`；失败时为空串。 */
  cookie: string;
};

function sessionCookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0] ?? "";
}

export async function loginRequest(
  baseUrl: string,
  input: { loginName: string; password: string; next?: string },
): Promise<LoginResult> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      loginName: input.loginName,
      password: input.password,
      ...(input.next === undefined ? {} : { next: input.next }),
    }),
    redirect: "manual",
  });
  const body = (await response.json()) as LoginBody;
  return { response, body, cookie: sessionCookie(response) };
}

/** 登录成功返回会话 cookie；失败直接抛错，免去每个调用点重复断言。 */
export async function loginCookie(
  baseUrl: string,
  loginName: string,
  password: string,
): Promise<string> {
  const result = await loginRequest(baseUrl, { loginName, password });
  if (result.response.status !== 200 || result.cookie.length === 0) {
    throw new Error(
      `测试账号 ${loginName} 登录失败（status=${result.response.status}）。`,
    );
  }
  return result.cookie;
}
