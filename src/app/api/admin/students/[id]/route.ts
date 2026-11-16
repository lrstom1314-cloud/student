import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import type { EnrollmentStatus } from "@/db/schema";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { displayNameProblem } from "@/lib/password";
import { isEnrollmentStatus, updateStudent } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * 调整学籍：改名、转班、改学籍状态。只处理请求里出现的字段。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return errorResponse("学生不存在。", 404);
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse("请求内容无法识别。", 400);
  }

  const patch: {
    name?: string;
    administrativeClassId?: string;
    enrollmentStatus?: EnrollmentStatus;
  } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const problem = displayNameProblem(name);
    if (problem) return errorResponse(problem, 400);
    patch.name = name;
  }

  if (body.administrativeClassId !== undefined) {
    const administrativeClassId =
      typeof body.administrativeClassId === "string"
        ? body.administrativeClassId.trim()
        : "";
    if (!isUuid(administrativeClassId)) {
      return errorResponse("请选择行政班。", 400);
    }
    patch.administrativeClassId = administrativeClassId;
  }

  if (body.enrollmentStatus !== undefined) {
    if (!isEnrollmentStatus(body.enrollmentStatus)) {
      return errorResponse("请选择有效的学籍状态。", 400);
    }
    patch.enrollmentStatus = body.enrollmentStatus;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse("没有需要修改的内容。", 400);
  }

  try {
    const result = await updateStudent(id, patch);
    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }
    return NextResponse.json(
      { student: result.student },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
