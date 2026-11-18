import { handleApi, jsonOk } from "@/lib/api-route";
import { cancelOverallOverride, setOverallOverride } from "@/lib/grades";
import { errorResponse, isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 教师覆盖某学生的总评。 */
export const PUT = handleApi(
  { idError: "教学班不存在。", body: true },
  async ({ id, user, params, body }) => {
    const studentId = params.studentId;
    if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

    const result = await setOverallOverride({
      teachingClassId: id!,
      studentId,
      user,
      score: body!.score,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ sheet: result.sheet });
  },
);

/** 取消覆盖，恢复为系统计算值。 */
export const DELETE = handleApi(
  { idError: "教学班不存在。" },
  async ({ id, user, params }) => {
    const studentId = params.studentId;
    if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

    const result = await cancelOverallOverride({
      teachingClassId: id!,
      studentId,
      user,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ sheet: result.sheet });
  },
);
