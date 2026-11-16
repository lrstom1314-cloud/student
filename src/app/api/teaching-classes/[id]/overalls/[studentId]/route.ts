import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { cancelOverallOverride, setOverallOverride } from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 教师覆盖某学生的总评。 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; studentId: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id, studentId } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);
  if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("请求内容无法识别。", 400);

  try {
    const result = await setOverallOverride({
      teachingClassId: id,
      studentId,
      user: guard.user,
      score: body.score,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json({ sheet: result.sheet }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}

/** 取消覆盖，恢复为系统计算值。 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; studentId: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id, studentId } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);
  if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

  try {
    const result = await cancelOverallOverride({
      teachingClassId: id,
      studentId,
      user: guard.user,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json({ sheet: result.sheet }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
