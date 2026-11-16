import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { createGradeItem } from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 为教学班定义一个成绩项：名称、满分、权重（百分比）。 */
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
    const result = await createGradeItem({
      teachingClassId: id,
      user: guard.user,
      name: body.name,
      maxScore: body.maxScore,
      weight: body.weight,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      { gradeItem: result.gradeItem, sheet: result.sheet },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
