import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import {
  getStudentGradeReport,
  resolveStudentGradeTerm,
} from "@/lib/student-grades";

export const dynamic = "force-dynamic";

/**
 * 学生本人的成绩：默认当前学期，可用 termId 查看过去学期的已发布快照（只读）。
 * 未来学期、不存在的学期与非法参数一律拒绝；学生身份始终来自会话，
 * 不接受用参数切换到他人（指定他人返回 403）。
 */
export async function GET(request: Request) {
  const guard = await requireApiUser({ roles: ["student"] });
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;

  try {
    const term = await resolveStudentGradeTerm(params.get("termId"));
    if (!term.ok) return errorResponse(term.error, term.status);

    const report = await getStudentGradeReport(guard.user.id, term.term);

    const requestedStudentId = params.get("studentId");
    if (requestedStudentId !== null) {
      if (
        !isUuid(requestedStudentId) ||
        report.student?.id !== requestedStudentId
      ) {
        return errorResponse("无权访问。", 403);
      }
    }

    return NextResponse.json(report, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
