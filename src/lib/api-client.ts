/**
 * 客户端提交 module。
 *
 * 表单只需要说「提交什么」，不需要重复拼 fetch、解析 { error } 与兜底文案。
 * 一个 interface 同时覆盖成功数据、后端中文错误、网络异常与冲突详情；
 * JSON 与 multipart 共用同一条错误契约。
 */

export type ApiFailure = {
  ok: false;
  message: string;
  status: number;
  body: Record<string, unknown> | null;
};

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | ApiFailure;

export type SubmitOptions = {
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** 后端没有给出 error 时的兜底中文提示。 */
  fallback?: string;
};

async function send<T>(
  route: string,
  init: RequestInit,
  fallback: string,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(route, init);
  } catch {
    return {
      ok: false,
      message: "网络异常，请稍后再试。",
      status: 0,
      body: null,
    };
  }

  const raw: unknown = await response.json().catch(() => null);
  const body =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  if (!response.ok) {
    const error = body?.error;
    return {
      ok: false,
      message:
        typeof error === "string" && error.length > 0 ? error : fallback,
      status: response.status,
      body,
    };
  }

  return { ok: true, data: raw as T, status: response.status };
}

export async function submitJson<T>(
  route: string,
  options: SubmitOptions = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? "POST";
  const hasBody = options.body !== undefined;

  return send<T>(
    route,
    {
      method,
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    },
    options.fallback ?? "操作失败，请稍后再试。",
  );
}

export async function submitForm<T>(
  route: string,
  form: FormData,
  options: { fallback?: string } = {},
): Promise<ApiResult<T>> {
  return send<T>(
    route,
    { method: "POST", body: form },
    options.fallback ?? "操作失败，请稍后再试。",
  );
}
