import type { SessionUser } from "@/lib/auth";
import {
  findTeachingClass,
  isTeachingClassTeacher,
} from "@/lib/teaching-classes";

export type TimetableAccess =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * 课表读写权限：教务管理员可写全部；教师只能写自己任教的教学班；
 * 学生与其他角色一律 403。教学班不存在时返回 404，避免把「无权限」
 * 与「不存在」混为一谈。
 */
export async function checkTimetableAccess(
  teachingClassId: string,
  user: SessionUser,
): Promise<TimetableAccess> {
  if (user.role !== "administrator" && user.role !== "teacher") {
    return { ok: false, status: 403, error: "无权访问。" };
  }

  const teachingClass = await findTeachingClass(teachingClassId);
  if (!teachingClass) {
    return { ok: false, status: 404, error: "教学班不存在。" };
  }

  if (
    user.role === "teacher" &&
    !(await isTeachingClassTeacher(teachingClassId, user.id))
  ) {
    return { ok: false, status: 403, error: "无权访问。" };
  }

  return { ok: true };
}
