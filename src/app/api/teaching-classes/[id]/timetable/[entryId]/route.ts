import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE, readJsonObject } from "@/lib/http";
import { checkTimetableAccess } from "@/lib/timetable-access";
import {
  deleteTimetableEntry,
  parseTimetableInput,
  updateTimetableEntry,
} from "@/lib/timetable";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; entryId: string }> };

/** 修改课表条目：整条替换，保存后重新计算冲突。 */
export async function PATCH(request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["administrator", "teacher"] });
  if (!guard.ok) return guard.response;

  const { id, entryId } = await context.params;
  if (!isUuid(id) || !isUuid(entryId)) {
    return errorResponse("课表条目不存在。", 404);
  }

  const body = await readJsonObject(request);
  if (!body) return errorResponse("请求内容无法识别。", 400);

  const parsed = parseTimetableInput(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  try {
    const access = await checkTimetableAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const result = await updateTimetableEntry({
      teachingClassId: id,
      entryId,
      values: parsed.input,
      acknowledgeConflicts: body.acknowledgeConflicts === true,
    });
    if (!result.ok) return errorResponse(result.error, result.status);

    return NextResponse.json(
      { entry: result.entry, conflicts: result.conflicts },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}

/** 删除课表条目；相关冲突警告会随条目一起消失。 */
export async function DELETE(_request: Request, context: Context) {
  const guard = await requireApiUser({ roles: ["administrator", "teacher"] });
  if (!guard.ok) return guard.response;

  const { id, entryId } = await context.params;
  if (!isUuid(id) || !isUuid(entryId)) {
    return errorResponse("课表条目不存在。", 404);
  }

  try {
    const access = await checkTimetableAccess(id, guard.user);
    if (!access.ok) return errorResponse(access.error, access.status);

    const removed = await deleteTimetableEntry(id, entryId);
    if (!removed) return errorResponse("课表条目不存在。", 404);

    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
