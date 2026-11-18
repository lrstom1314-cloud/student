import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import { addStudentToTeachingClass } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/** 教务管理员手工把一位学生加入教学班名单。 */
export const POST = handleApi(
  {
    roles: ["administrator"],
    idError: "教学班不存在。",
    body: true,
  },
  async ({ id, body }) => {
    const studentId =
      typeof body!.studentId === "string" ? body!.studentId.trim() : "";
    if (!isUuid(studentId)) return errorResponse("请选择学生。", 400);

    const result = await addStudentToTeachingClass(id!, studentId);
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonOk({ teachingClass: result.teachingClass });
  },
);
