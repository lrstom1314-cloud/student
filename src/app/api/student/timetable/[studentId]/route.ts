import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import { getStudentTimetable } from "@/lib/student-timetable";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ studentId: string }> };

/**
 * 按学生读取课表。路径里的学号只允许是本人；他人一律 403，
 * 不因为「教学班相同」而放宽到同学的视角。
 */
export async function GET(_request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["student"] });
  if (!guard.ok) return guard.response;

  const { studentId } = await context.params;
  if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

  try {
    const timetable = await getStudentTimetable(guard.user.id);
    if (timetable.student?.id !== studentId) {
      return errorResponse("无权访问。", 403);
    }
    return NextResponse.json(timetable, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
