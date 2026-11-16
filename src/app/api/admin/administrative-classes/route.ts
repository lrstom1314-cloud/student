import { NextResponse } from "next/server";

import {
  administrativeClassNameProblem,
  createAdministrativeClass,
  listAdministrativeClasses,
} from "@/lib/administrative-classes";
import { requireApiUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUniqueViolation,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  try {
    const administrativeClasses = await listAdministrativeClasses();
    return NextResponse.json(
      { administrativeClasses },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}

/**
 * 教务管理员创建行政班。名称含年级（如「高二 3 班」），全局唯一。
 */
export async function POST(request: Request) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  const problem = administrativeClassNameProblem(name);
  if (problem) return errorResponse(problem, 400);

  try {
    const administrativeClass = await createAdministrativeClass(name);
    return NextResponse.json(
      { administrativeClass },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse("行政班名称已存在，请换一个。", 409);
    }
    return internalError(error);
  }
}
