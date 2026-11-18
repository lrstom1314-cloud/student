import {
  administrativeClassNameProblem,
  renameAdministrativeClass,
} from "@/lib/administrative-classes";
import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 重命名行政班：年级随年度调整时只改名称，不重建名单。 */
export const PATCH = handleApi(
  {
    roles: ["administrator"],
    idError: "行政班不存在。",
    body: "optional",
  },
  async ({ id, body }) => {
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    const problem = administrativeClassNameProblem(name);
    if (problem) return errorResponse(problem, 400);

    try {
      const administrativeClass = await renameAdministrativeClass(id!, name);
      if (!administrativeClass) {
        return errorResponse("行政班不存在。", 404);
      }
      return jsonOk({ administrativeClass });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse("行政班名称已存在，请换一个。", 409);
      }
      throw error;
    }
  },
);
