import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import {
  authorizeGradeAccess,
  getGradeSheet,
  saveScores,
} from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 成绩表：全部学生 × 全部成绩项，加上系统总评与教师覆盖值。
 * 教务管理员可读全部；教师只能读自己任教的班；学生 403。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  try {
    const access = await authorizeGradeAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const sheet = await getGradeSheet(id);
    if (!sheet) return errorResponse("教学班不存在。", 404);
    return NextResponse.json({ sheet }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}

/** 成批保存网格里的得分；整批要么全部成功，要么全部拒绝。 */
export async function PUT(
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
    const result = await saveScores({
      teachingClassId: id,
      user: guard.user,
      scores: body.scores,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      { sheet: result.sheet, updatedCount: result.updatedCount },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
