import { NextResponse } from "next/server";

export const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * 读取 JSON 请求体；不是对象时返回 null，由调用方给出中文错误。
 */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function internalError(error: unknown): NextResponse {
  console.error("请求处理失败：", error);
  return errorResponse("服务暂时不可用，请稍后再试。", 500);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只接受标准 UUID，避免把非法字符串送进数据库触发语法错误。 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** PostgreSQL 唯一约束冲突。 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}
