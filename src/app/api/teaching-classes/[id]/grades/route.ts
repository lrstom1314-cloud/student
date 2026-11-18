import { handleApi, jsonOk } from "@/lib/api-route";
import { getGradeSheet, saveScores } from "@/lib/grades";
import { errorResponse } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";

export const dynamic = "force-dynamic";

/**
 * 成绩表：全部学生 × 全部成绩项，加上系统总评与教师覆盖值。
 * 教务管理员可读全部；教师只能读自己任教的班；学生 403。
 */
export const GET = handleApi(
  { idError: "教学班不存在。" },
  async ({ id, user }) => {
    const access = await authorizeTeachingClass(id!, user, "grades");
    if (!access.ok) return errorResponse(access.error, access.status);

    const sheet = await getGradeSheet(id!);
    if (!sheet) return errorResponse("教学班不存在。", 404);
    return jsonOk({ sheet });
  },
);

/** 成批保存网格里的得分；整批要么全部成功，要么全部拒绝。 */
export const PUT = handleApi(
  { idError: "教学班不存在。", body: true },
  async ({ id, user, body }) => {
    const result = await saveScores({
      teachingClassId: id!,
      user,
      scores: body!.scores,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ sheet: result.sheet, updatedCount: result.updatedCount });
  },
);
