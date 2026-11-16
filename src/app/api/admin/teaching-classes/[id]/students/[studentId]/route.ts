import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import { removeStudentFromTeachingClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教务管理员手工把一位学生移出教学班名单。 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; studentId: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id, studentId } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);
  if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

  try {
    const result = await removeStudentFromTeachingClass(id, studentId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return NextResponse.json(
      { teachingClass: result.teachingClass },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
