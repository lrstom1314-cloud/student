import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUniqueViolation,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { createAcademicYear } from "@/lib/terms";

export const dynamic = "force-dynamic";

const MIN_START_YEAR = 1900;
const MAX_START_YEAR = 2200;

/**
 * 教务管理员创建学年。学年只用起始年份标识，如 2025 表示 2025-2026 学年。
 */
export async function POST(request: Request) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(request);
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
    return NextResponse.json({ academicYear }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse("该学年已存在，请勿重复创建。", 409);
    }
    return internalError(error);
  }
}
