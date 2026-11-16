import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import { listStudentPublishedGrades } from "@/lib/student-grades";
import { resolveTermScope } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 学生本人的成绩：只返回自己的数据；未发布的教学班只有「暂无成绩」，
 * 已发布的读取最近一次发布的快照。
 */
export async function GET(request: Request) {
  const guard = await requireApiUser({ roles: ["student"] });
  if (!guard.ok) return guard.response;

  const termParam = new URL(request.url).searchParams.get("termId");
  if (termParam !== null && !isUuid(termParam)) {
    return errorResponse("学期不存在。", 400);
  }

  try {
    const resolved = await resolveTermScope(termParam);
    if (!resolved.ok) {
      return errorResponse(resolved.error, resolved.status);
    }

    const { currentTerm, term } = resolved.scope;
    const courses = term
      ? await listStudentPublishedGrades(guard.user.id, term.id)
      : [];

    return NextResponse.json(
      { currentTerm, term, courses },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
