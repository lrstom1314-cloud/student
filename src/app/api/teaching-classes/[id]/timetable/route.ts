import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";
import {
  createTimetableEntry,
  getTimetable,
  parseTimetableInput,
} from "@/lib/timetable";

export const dynamic = "force-dynamic";

/** 教学班的课表与当前冲突警告。 */
export const GET = handleApi(
  {
    roles: ["administrator", "teacher"],
    idError: "教学班不存在。",
  },
  async ({ id, user }) => {
    const access = await authorizeTeachingClass(id!, user, "timetable");
    if (!access.ok) return errorResponse(access.error, access.status);

    const timetable = await getTimetable(id!);
    return jsonOk(timetable);
  },
);

/**
 * 添加课表条目：保存前先判定冲突。
 * 有冲突且未带 acknowledgeConflicts: true 时返回 409 与冲突详情，不落库；
 * 确认后才写入，并把「已确认冲突」的痕迹留在条目上。
 */
export const POST = handleApi(
  {
    roles: ["administrator", "teacher"],
    idError: "教学班不存在。",
    body: true,
  },
  async ({ id, user, body }) => {
    const parsed = parseTimetableInput(body!);
    if (!parsed.ok) return errorResponse(parsed.error, 400);

    const access = await authorizeTeachingClass(id!, user, "timetable");
    if (!access.ok) return errorResponse(access.error, access.status);

    const result = await createTimetableEntry({
      teachingClassId: id!,
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

    return jsonOk({ entry: result.entry, conflicts: result.conflicts }, 201);
  },
);
