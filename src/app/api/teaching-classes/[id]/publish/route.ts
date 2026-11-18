import { handleApi, jsonOk } from "@/lib/api-route";
import { publishGrades } from "@/lib/grades";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 发布整个教学班的成绩：固化快照并锁定。
 * 必须带 confirmed: true，二次确认不只是界面文案。
 */
export const POST = handleApi(
  { idError: "教学班不存在。", body: true },
  async ({ id, user, body }) => {
    const result = await publishGrades({
      teachingClassId: id!,
      user,
      confirmed: body!.confirmed,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({
      publication: result.publication,
      lock: result.lock,
      sheet: result.sheet,
    });
  },
);
