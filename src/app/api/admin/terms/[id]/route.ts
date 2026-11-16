import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { parseIsoDate } from "@/lib/teaching-week";
import { setTermStartsOn } from "@/lib/terms";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * 设置学期的教学第 1 周起始日期。仅教务管理员可操作。
 * startsOn 为 null 表示清除；空字符串按未填写处理。
 */
export async function PATCH(request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("学期不存在。", 404);

  const body = await readJsonObject(request);
  if (!body || !("startsOn" in body)) {
    return errorResponse("请提供开学日期。", 400);
  }

  let startsOn: string | null;
  if (body.startsOn === null) {
    startsOn = null;
  } else {
    startsOn = parseIsoDate(body.startsOn);
    if (startsOn === null) {
      return errorResponse("请填写有效的开学日期（YYYY-MM-DD）。", 400);
    }
  }

  try {
    const term = await setTermStartsOn(id, startsOn);
    if (!term) return errorResponse("学期不存在。", 404);
    return NextResponse.json({ term }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
