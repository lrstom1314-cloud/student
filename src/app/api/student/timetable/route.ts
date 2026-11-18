import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUuid } from "@/lib/http";
import { getStudentTimetable } from "@/lib/student-timetable";

export const dynamic = "force-dynamic";

/**
 * 学生自己的课表。学期范围固定为当前学期，学生身份来自会话，
 * 不接受用参数切换到他人或历史学期。
 */
export const GET = handleApi(
  { roles: ["student"], idParam: null },
  async ({ request, user }) => {
    const params = new URL(request.url).searchParams;
    if (params.get("termId") !== null) {
      return errorResponse("学生课表只显示当前学期，不能指定学期。", 400);
    }

    const timetable = await getStudentTimetable(user.id);

    const requestedStudentId = params.get("studentId");
    if (requestedStudentId !== null) {
      if (
        !isUuid(requestedStudentId) ||
        timetable.student?.id !== requestedStudentId
      ) {
        return errorResponse("无权访问。", 403);
      }
    }

    return jsonOk(timetable);
  },
);
