import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import {
  listTeachingClassesForStudentAccount,
  resolveTermScope,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 学生只看到自己被加入的教学班；不传学期则按当前学期。 */
export const GET = handleApi(
  { roles: ["student"], idParam: null },
  async ({ request, user }) => {
    const termParam = new URL(request.url).searchParams.get("termId");
    if (termParam !== null && !isUuid(termParam)) {
      return errorResponse("学期不存在。", 400);
    }

    const resolved = await resolveTermScope(termParam);
    if (!resolved.ok) {
      return errorResponse(resolved.error, resolved.status);
    }

    const { currentTerm, term } = resolved.scope;
    const teachingClasses = term
      ? await listTeachingClassesForStudentAccount(term.id, user.id)
      : [];

    return jsonOk({ currentTerm, term, teachingClasses });
  },
);
