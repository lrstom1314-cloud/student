import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation, isUuid } from "@/lib/http";
import {
  displayNameProblem,
  hashPassword,
  passwordProblem,
} from "@/lib/password";
import {
  createStudent,
  isEnrollmentStatus,
  listStudents,
  studentNumberProblem,
} from "@/lib/students";

export const dynamic = "force-dynamic";

/** 按行政班浏览名单；不传行政班则返回全部学生。 */
export const GET = handleApi(
  { roles: ["administrator"], idParam: null },
  async ({ request }) => {
    const administrativeClassId = new URL(request.url).searchParams.get(
      "administrativeClassId",
    );
    if (administrativeClassId !== null && !isUuid(administrativeClassId)) {
      return errorResponse("行政班不存在。", 400);
    }

    const students = await listStudents(administrativeClassId ?? undefined);
    return jsonOk({ students });
  },
);

/**
 * 教务管理员逐个新建学生。学号即登录名：该学号还没有账号时同时建号，
 * 已有学生账号时只建立关联（绝不改密码）。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: "optional" },
  async ({ body }) => {
    const studentNumber =
      typeof body?.studentNumber === "string" ? body.studentNumber.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const administrativeClassId =
      typeof body?.administrativeClassId === "string"
        ? body.administrativeClassId.trim()
        : "";
    const enrollment = body?.enrollmentStatus ?? "enrolled";
    const initialPassword =
      typeof body?.initialPassword === "string" ? body.initialPassword : "";

    const studentNumberError = studentNumberProblem(studentNumber);
    if (studentNumberError) return errorResponse(studentNumberError, 400);

    const nameError = displayNameProblem(name);
    if (nameError) return errorResponse(nameError, 400);

    if (!isUuid(administrativeClassId)) {
      return errorResponse("请选择行政班。", 400);
    }

    if (!isEnrollmentStatus(enrollment)) {
      return errorResponse("请选择有效的学籍状态。", 400);
    }

    let initialPasswordHash: string | undefined;
    if (initialPassword.length > 0) {
      const passwordError = passwordProblem(initialPassword);
      if (passwordError) return errorResponse(passwordError, 400);
      initialPasswordHash = await hashPassword(initialPassword);
    }

    try {
      const result = await createStudent({
        studentNumber,
        name,
        administrativeClassId,
        enrollmentStatus: enrollment,
        initialPasswordHash,
      });

      if (!result.ok) {
        return errorResponse(result.error, result.status);
      }

      return jsonOk({ student: result.student }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse(
          `学号 ${studentNumber} 已存在，请勿重复录入。`,
          409,
        );
      }
      throw error;
    }
  },
);
