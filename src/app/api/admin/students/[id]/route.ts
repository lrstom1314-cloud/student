import type { EnrollmentStatus } from "@/db/schema";
import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import { displayNameProblem } from "@/lib/password";
import { isEnrollmentStatus, updateStudent } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * 调整学籍：改名、转班、改学籍状态。只处理请求里出现的字段。
 */
export const PATCH = handleApi(
  { roles: ["administrator"], idError: "学生不存在。", body: true },
  async ({ id, body }) => {
    const patch: {
      name?: string;
      administrativeClassId?: string;
      enrollmentStatus?: EnrollmentStatus;
    } = {};

    if (body!.name !== undefined) {
      const name = typeof body!.name === "string" ? body!.name.trim() : "";
      const problem = displayNameProblem(name);
      if (problem) return errorResponse(problem, 400);
      patch.name = name;
    }

    if (body!.administrativeClassId !== undefined) {
      const administrativeClassId =
        typeof body!.administrativeClassId === "string"
          ? body!.administrativeClassId.trim()
          : "";
      if (!isUuid(administrativeClassId)) {
        return errorResponse("请选择行政班。", 400);
      }
      patch.administrativeClassId = administrativeClassId;
    }

    if (body!.enrollmentStatus !== undefined) {
      if (!isEnrollmentStatus(body!.enrollmentStatus)) {
        return errorResponse("请选择有效的学籍状态。", 400);
      }
      patch.enrollmentStatus = body!.enrollmentStatus;
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse("没有需要修改的内容。", 400);
    }

    const result = await updateStudent(id!, patch);
    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }
    return jsonOk({ student: result.student });
  },
);
