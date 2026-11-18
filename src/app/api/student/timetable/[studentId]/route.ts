import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse } from "@/lib/http";
import { getStudentTimetable } from "@/lib/student-timetable";

export const dynamic = "force-dynamic";

/**
 * 按学生读取课表。路径里的学号只允许是本人；他人一律 403，
 * 不因为「教学班相同」而放宽到同学的视角。
 */
export const GET = handleApi(
  { roles: ["student"], idParam: "studentId", idError: "学生不存在。" },
  async ({ id, user }) => {
    const timetable = await getStudentTimetable(user.id);
    if (timetable.student?.id !== id) {
      return errorResponse("无权访问。", 403);
    }
    return jsonOk(timetable);
  },
);
