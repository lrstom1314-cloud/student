import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { unlockGrades } from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 教务管理员解锁已发布的教学班，必须填写理由。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("请求内容无法识别。", 400);

  try {
    const result = await unlockGrades({
      teachingClassId: id,
      user: guard.user,
      reason: body.reason,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      { lock: result.lock, sheet: result.sheet },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
