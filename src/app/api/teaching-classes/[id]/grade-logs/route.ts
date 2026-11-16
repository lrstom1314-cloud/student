import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { listGradeChangeLogsByTeachingClass } from "@/lib/grade-logs";
import { authorizeGradeAccess } from "@/lib/grades";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 按教学班查询变更日志。教务管理员不限；教师只能查自己任教的班。
 * 可选 ?studentId= 只看某个学生，方便回答针对某个人的质疑。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  const studentId = new URL(request.url).searchParams.get("studentId");
  if (studentId !== null && !isUuid(studentId)) {
    return errorResponse("学生不存在。", 400);
  }

  try {
    const access = await authorizeGradeAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const logs = await listGradeChangeLogsByTeachingClass(
      id,
      studentId === null ? {} : { studentId },
    );
    return NextResponse.json({ logs }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
