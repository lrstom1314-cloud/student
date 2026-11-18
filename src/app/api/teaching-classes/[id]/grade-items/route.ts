import { handleApi, jsonOk } from "@/lib/api-route";
import { createGradeItem } from "@/lib/grades";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 为教学班定义一个成绩项：名称、满分、权重（百分比）。 */
export const POST = handleApi(
  { idError: "教学班不存在。", body: true },
  async ({ id, user, body }) => {
    const result = await createGradeItem({
      teachingClassId: id!,
      user,
      name: body!.name,
      maxScore: body!.maxScore,
      weight: body!.weight,
    });
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk(
      { gradeItem: result.gradeItem, sheet: result.sheet },
      201,
    );
  },
);
