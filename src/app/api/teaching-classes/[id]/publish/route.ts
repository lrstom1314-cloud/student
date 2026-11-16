import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { publishGrades } from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 发布整个教学班的成绩：固化快照并锁定。
 * 必须带 confirmed: true，二次确认不只是界面文案。
 */
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
    const result = await publishGrades({
      teachingClassId: id,
      user: guard.user,
      confirmed: body.confirmed,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      {
        publication: result.publication,
        lock: result.lock,
        sheet: result.sheet,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
