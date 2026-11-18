import { handleApi, jsonOk } from "@/lib/api-route";
import {
  courseNameProblem,
  createCourse,
  descriptionProblem,
  findCourseByName,
  parseCourseMeasure,
  parseDescription,
} from "@/lib/courses";
import { errorResponse, isUniqueViolation } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 教务管理员创建课程：名称、学分或课时、可选说明。 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: true },
  async ({ body }) => {
    const name = typeof body!.name === "string" ? body!.name.trim() : "";
    const nameProblem = courseNameProblem(name);
    if (nameProblem) return errorResponse(nameProblem, 400);

    const measure = parseCourseMeasure(body!.credits, body!.hours);
    if (!measure.ok) return errorResponse(measure.error, 400);

    const descriptionIssue = descriptionProblem(body!.description);
    if (descriptionIssue) return errorResponse(descriptionIssue, 400);

    const description = parseDescription(body!.description);

    try {
      const existing = await findCourseByName(name);
      if (existing) {
        return errorResponse(`课程名称「${name}」已存在。`, 409);
      }

      const course = await createCourse({
        name,
        credits: measure.credits,
        hours: measure.hours,
        description,
      });
      return jsonOk({ course }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse(`课程名称「${name}」已存在。`, 409);
      }
      throw error;
    }
  },
);
