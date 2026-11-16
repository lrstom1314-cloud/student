import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE, readJsonObject } from "@/lib/http";
import { addStudentToTeachingClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教务管理员手工把一位学生加入教学班名单。 */
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

  const studentId =
    typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!isUuid(studentId)) return errorResponse("请选择学生。", 400);

  try {
    const result = await addStudentToTeachingClass(id, studentId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      { teachingClass: result.teachingClass },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
