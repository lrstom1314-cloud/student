import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import { getStudentTimetable } from "@/lib/student-timetable";

export const dynamic = "force-dynamic";

/**
 * 学生自己的课表。学期范围固定为当前学期，学生身份来自会话，
 * 不接受用参数切换到他人或历史学期。
 */
export async function GET(request: Request) {
  const guard = await requireApiUser({ roles: ["student"] });
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  if (params.get("termId") !== null) {
    return errorResponse("学生课表只显示当前学期，不能指定学期。", 400);
  }

  try {
    const timetable = await getStudentTimetable(guard.user.id);

    const requestedStudentId = params.get("studentId");
    if (requestedStudentId !== null) {
      if (
        !isUuid(requestedStudentId) ||
        timetable.student?.id !== requestedStudentId
      ) {
        return errorResponse("无权访问。", 403);
      }
    }

    return NextResponse.json(timetable, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
