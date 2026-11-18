import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation } from "@/lib/http";
import { createAcademicYear } from "@/lib/terms";

export const dynamic = "force-dynamic";

const MIN_START_YEAR = 1900;
const MAX_START_YEAR = 2200;

/**
 * 教务管理员创建学年。学年只用起始年份标识，如 2025 表示 2025-2026 学年。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: "optional" },
  async ({ body }) => {
    const startYear = body?.startYear;

    if (
      typeof startYear !== "number" ||
      !Number.isInteger(startYear) ||
      startYear < MIN_START_YEAR ||
      startYear > MAX_START_YEAR
    ) {
      return errorResponse("请填写有效的学年起始年份，例如 2025。", 400);
    }

    try {
      const academicYear = await createAcademicYear(startYear);
      return jsonOk({ academicYear }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse("该学年已存在，请勿重复创建。", 409);
      }
      throw error;
    }
  },
);
