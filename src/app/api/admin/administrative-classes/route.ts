import {
  administrativeClassNameProblem,
  createAdministrativeClass,
  listAdministrativeClasses,
} from "@/lib/administrative-classes";
import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handleApi(
  { roles: ["administrator"], idParam: null },
  async () => {
    const administrativeClasses = await listAdministrativeClasses();
    return jsonOk({ administrativeClasses });
  },
);

/**
 * 教务管理员创建行政班。名称含年级（如「高二 3 班」），全局唯一。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: "optional" },
  async ({ body }) => {
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    const problem = administrativeClassNameProblem(name);
    if (problem) return errorResponse(problem, 400);

    try {
      const administrativeClass = await createAdministrativeClass(name);
      return jsonOk({ administrativeClass }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse("行政班名称已存在，请换一个。", 409);
      }
      throw error;
    }
  },
);
