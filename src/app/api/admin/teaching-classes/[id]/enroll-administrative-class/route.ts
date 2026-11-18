import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import { enrollAdministrativeClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 把一个行政班「整班加入」教学班：只纳入当前在读学生，重复执行幂等。
 * 名单是快照，之后学籍变化不会自动同步。
 */
export const POST = handleApi(
  {
    roles: ["administrator"],
    idError: "教学班不存在。",
    body: true,
  },
  async ({ id, body }) => {
    const administrativeClassId =
      typeof body!.administrativeClassId === "string"
        ? body!.administrativeClassId.trim()
        : "";
    if (!isUuid(administrativeClassId)) {
      return errorResponse("请选择行政班。", 400);
    }

    const result = await enrollAdministrativeClass(id!, administrativeClassId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({
      teachingClass: result.teachingClass,
      enrollment: result.enrollment,
    });
  },
);
