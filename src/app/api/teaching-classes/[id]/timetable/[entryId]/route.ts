import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid, NO_STORE } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";
import {
  deleteTimetableEntry,
  parseTimetableInput,
  updateTimetableEntry,
} from "@/lib/timetable";

export const dynamic = "force-dynamic";

/** 修改课表条目：整条替换，保存前先判定冲突，未确认时不落库。 */
export const PATCH = handleApi(
  {
    roles: ["administrator", "teacher"],
    idError: "课表条目不存在。",
    body: true,
  },
  async ({ id, user, params, body }) => {
    const entryId = params.entryId;
    if (!isUuid(entryId)) {
      return errorResponse("课表条目不存在。", 404);
    }

    const parsed = parseTimetableInput(body!);
    if (!parsed.ok) return errorResponse(parsed.error, 400);

    const access = await authorizeTeachingClass(id!, user, "timetable");
    if (!access.ok) return errorResponse(access.error, access.status);

    const result = await updateTimetableEntry({
      teachingClassId: id!,
      entryId,
      values: parsed.input,
      acknowledgeConflicts: body!.acknowledgeConflicts === true,
    });
    if (!result.ok) {
      // 409 带冲突详情，前端据此先展示冲突，确认后再提交。
      if (result.conflicts !== undefined) {
        return jsonOk(
          { error: result.error, conflicts: result.conflicts },
          result.status,
        );
      }
      return errorResponse(result.error, result.status);
    }

    return jsonOk({ entry: result.entry, conflicts: result.conflicts });
  },
);

/** 删除课表条目；相关冲突警告会随条目一起消失。 */
export const DELETE = handleApi(
  {
    roles: ["administrator", "teacher"],
    idError: "课表条目不存在。",
  },
  async ({ id, user, params }) => {
    const entryId = params.entryId;
    if (!isUuid(entryId)) {
      return errorResponse("课表条目不存在。", 404);
    }

    const access = await authorizeTeachingClass(id!, user, "timetable");
    if (!access.ok) return errorResponse(access.error, access.status);

    const removed = await deleteTimetableEntry(id!, entryId);
    if (!removed) return errorResponse("课表条目不存在。", 404);

    return new Response(null, { status: 204, headers: NO_STORE });
  },
);
