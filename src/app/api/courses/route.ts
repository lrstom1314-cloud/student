import { handleApi, jsonOk } from "@/lib/api-route";
import { listCourses } from "@/lib/courses";

export const dynamic = "force-dynamic";

/** 课程目录：已登录用户都可以读取，用于教学班表单与后续课表。 */
export const GET = handleApi({ idParam: null }, async () => {
  const courses = await listCourses();
  return jsonOk({ courses });
});
