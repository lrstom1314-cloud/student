import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE, readJsonObject } from "@/lib/http";
import { checkTimetableAccess } from "@/lib/timetable-access";
import {
  createTimetableEntry,
  getTimetable,
  parseTimetableInput,
} from "@/lib/timetable";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 教学班的课表与当前冲突警告。 */
export async function GET(_request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["administrator", "teacher"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  try {
    const access = await checkTimetableAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const timetable = await getTimetable(id);
    return NextResponse.json(timetable, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}

/**
 * 添加课表条目：冲突只告警、不阻塞保存。
 * 请求带 acknowledgeConflicts: true 时，把「已确认冲突」的痕迹留在条目上。
 */
export async function POST(request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["administrator", "teacher"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("请求内容无法识别。", 400);

  const parsed = parseTimetableInput(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  try {
    const access = await checkTimetableAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const result = await createTimetableEntry({
      teachingClassId: id,
      values: parsed.input,
      acknowledgeConflicts: body.acknowledgeConflicts === true,
    });
    if (!result.ok) return errorResponse(result.error, result.status);

    return NextResponse.json(
      { entry: result.entry, conflicts: result.conflicts },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
