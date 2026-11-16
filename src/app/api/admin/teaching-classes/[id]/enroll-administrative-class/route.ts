import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE, readJsonObject } from "@/lib/http";
import { enrollAdministrativeClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 把一个行政班「整班加入」教学班：只纳入当前在读学生，重复执行幂等。
 * 名单是快照，之后学籍变化不会自动同步。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("请求内容无法识别。", 400);

  const administrativeClassId =
    typeof body.administrativeClassId === "string"
      ? body.administrativeClassId.trim()
      : "";
  if (!isUuid(administrativeClassId)) {
    return errorResponse("请选择行政班。", 400);
  }

  try {
    const result = await enrollAdministrativeClass(id, administrativeClassId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      {
        teachingClass: result.teachingClass,
        enrollment: result.enrollment,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
