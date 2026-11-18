import { handleApi, jsonOk } from "@/lib/api-route";
import { unlockGrades } from "@/lib/grades";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 教务管理员解锁已发布的教学班，必须填写理由。 */
export const POST = handleApi(
  { idError: "教学班不存在。", body: true },
  async ({ id, user, body }) => {
    const result = await unlockGrades({
      teachingClassId: id!,
      user,
      reason: body!.reason,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ lock: result.lock, sheet: result.sheet });
  },
);
