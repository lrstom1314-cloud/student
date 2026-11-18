import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import {
  createTeachingClass,
  listTeachingClassesByTerm,
  resolveTermScope,
  teachingClassDisplayNameProblem,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教务管理员按学期查看全部教学班；不传学期则按当前学期。 */
export const GET = handleApi(
  { roles: ["administrator"], idParam: null },
  async ({ request }) => {
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
      ? await listTeachingClassesByTerm(term.id)
      : [];

    return jsonOk({ currentTerm, term, teachingClasses });
  },
);

/**
 * 教务管理员在某学期开设教学班：选课程、指定一位教师、填显示名。
 * 可同时选一个行政班整班加入，只纳入当前在读学生。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: true },
  async ({ body }) => {
    const termId = typeof body!.termId === "string" ? body!.termId.trim() : "";
    const courseId =
      typeof body!.courseId === "string" ? body!.courseId.trim() : "";
    const teacherAccountId =
      typeof body!.teacherAccountId === "string"
        ? body!.teacherAccountId.trim()
        : "";
    const displayName =
      typeof body!.displayName === "string" ? body!.displayName.trim() : "";
    const administrativeClassId =
      typeof body!.administrativeClassId === "string"
        ? body!.administrativeClassId.trim()
        : "";

    if (!isUuid(termId)) return errorResponse("请选择学期。", 400);
    if (!isUuid(courseId)) return errorResponse("请选择课程。", 400);
    if (!isUuid(teacherAccountId)) {
      return errorResponse("请选择任课教师。", 400);
    }
    const displayNameProblem = teachingClassDisplayNameProblem(displayName);
    if (displayNameProblem) return errorResponse(displayNameProblem, 400);
    if (administrativeClassId.length > 0 && !isUuid(administrativeClassId)) {
      return errorResponse("所选行政班不存在。", 400);
    }

    const result = await createTeachingClass({
      termId,
      courseId,
      teacherAccountId,
      displayName,
      administrativeClassId:
        administrativeClassId.length > 0 ? administrativeClassId : null,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    return jsonOk(
      {
        teachingClass: result.teachingClass,
        enrollment: result.enrollment,
      },
      201,
    );
  },
);
