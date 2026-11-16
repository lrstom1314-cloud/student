import { NextResponse } from "next/server";

import {
  administrativeClassNameProblem,
  renameAdministrativeClass,
} from "@/lib/administrative-classes";
import { requireApiUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUniqueViolation,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 重命名行政班：年级随年度调整时只改名称，不重建名单。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return errorResponse("行政班不存在。", 404);
  }

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  const problem = administrativeClassNameProblem(name);
  if (problem) return errorResponse(problem, 400);

  try {
    const administrativeClass = await renameAdministrativeClass(id, name);
    if (!administrativeClass) {
      return errorResponse("行政班不存在。", 404);
    }
    return NextResponse.json(
      { administrativeClass },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse("行政班名称已存在，请换一个。", 409);
    }
    return internalError(error);
  }
}
