import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import {
  listTeachingClassesByTerm,
  resolveTermScope,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教师只看到自己任教的教学班；不传学期则按当前学期。 */
export async function GET(request: Request) {
  const guard = await requireApiUser({ roles: ["teacher"] });
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
    const teachingClasses = term
      ? await listTeachingClassesByTerm(term.id, guard.user.id)
      : [];

    return NextResponse.json(
      { currentTerm, term, teachingClasses },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
