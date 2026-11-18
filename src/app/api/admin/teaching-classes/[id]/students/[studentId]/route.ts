import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import { removeStudentFromTeachingClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教务管理员手工把一位学生移出教学班名单。 */
export const DELETE = handleApi(
  { roles: ["administrator"], idError: "教学班不存在。" },
  async ({ id, params }) => {
    const studentId = params.studentId;
    if (!isUuid(studentId)) return errorResponse("学生不存在。", 404);

    const result = await removeStudentFromTeachingClass(id!, studentId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ teachingClass: result.teachingClass });
  },
);
