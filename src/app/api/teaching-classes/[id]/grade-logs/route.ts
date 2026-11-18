import { handleApi, jsonOk } from "@/lib/api-route";
import { listGradeChangeLogsByTeachingClass } from "@/lib/grade-logs";
import { errorResponse, isUuid } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";

export const dynamic = "force-dynamic";

/**
 * 按教学班查询变更日志。教务管理员不限；教师只能查自己任教的班。
 * 可选 ?studentId= 只看某个学生，方便回答针对某个人的质疑。
 */
export const GET = handleApi(
  { idError: "教学班不存在。" },
  async ({ id, user, request }) => {
    const studentId = new URL(request.url).searchParams.get("studentId");
    if (studentId !== null && !isUuid(studentId)) {
      return errorResponse("学生不存在。", 400);
    }

    const access = await authorizeTeachingClass(id!, user, "grades");
    if (!access.ok) return errorResponse(access.error, access.status);

    const logs = await listGradeChangeLogsByTeachingClass(
      id!,
      studentId === null ? {} : { studentId },
    );
    return jsonOk({ logs });
  },
);
