import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation, isUuid } from "@/lib/http";
import { createTerm, isTermHalf } from "@/lib/terms";

export const dynamic = "force-dynamic";

/**
 * 教务管理员在学年下创建学期（上学期 / 下学期）。
 * 同一学年 + 同一半程由数据库唯一索引兜底。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: "optional" },
  async ({ body }) => {
    const academicYearId = body?.academicYearId;
    const half = body?.half;

    if (!isUuid(academicYearId)) {
      return errorResponse("请选择有效的学年。", 400);
    }
    if (!isTermHalf(half)) {
      return errorResponse("请选择学期（上学期或下学期）。", 400);
    }

    try {
      const term = await createTerm({ academicYearId, half });
      if (!term) {
        return errorResponse("学年不存在，请刷新页面后重试。", 400);
      }
      return jsonOk({ term }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse("该学年下已有这个学期，请勿重复创建。", 409);
      }
      throw error;
    }
  },
);
