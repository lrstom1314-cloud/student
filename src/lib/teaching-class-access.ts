import type { SessionUser } from "@/lib/auth";
import {
  findTeachingClass,
  isTeachingClassTeacher,
  type TeachingClassSummary,
} from "@/lib/teaching-classes";

/**
 * 教学班访问 module。
 *
 * 「谁能读、谁能写成绩、谁能排课、谁能解锁」只在在这里回答一次：
 * 角色矩阵、任课归属、404 与 403 的先后顺序都收敛到同一条 seam。
 * route、页面与导出都跨这个 interface，不再各自拼角色分支。
 */

export type TeachingClassNeed =
  /** 成绩读写：教务管理员全库，教师仅本人任教。 */
  | "grades"
  /** 课表读写：教务管理员或任课教师。 */
  | "timetable"
  /** 解锁成绩：仅教务管理员。 */
  | "unlock"
  /** 教学班详情：教务管理员或任课教师。 */
  | "read"
  /** 教师页面：只确认任课归属（不存在与无权限都按 403 处理）。 */
  | "teach";

export type TeachingClassAccess =
  | { ok: true; teachingClass: TeachingClassSummary }
  | { ok: false; status: number; error: string };

const NOT_FOUND = { ok: false, status: 404, error: "教学班不存在。" } as const;
const FORBIDDEN = { ok: false, status: 403, error: "无权访问。" } as const;
const UNLOCK_FORBIDDEN = {
  ok: false,
  status: 403,
  error: "只有教务管理员可以解锁成绩。",
} as const;

export async function authorizeTeachingClass(
  teachingClassId: string,
  user: SessionUser,
  need: TeachingClassNeed,
): Promise<TeachingClassAccess> {
  if (need === "teach") {
    if (user.role !== "teacher") return FORBIDDEN;
    if (!(await isTeachingClassTeacher(teachingClassId, user.id))) {
      return FORBIDDEN;
    }
    const teachingClass = await findTeachingClass(teachingClassId);
    return teachingClass ? { ok: true, teachingClass } : FORBIDDEN;
  }

  // 课表保留原有的判定顺序：先看角色，再查教学班。
  if (need === "timetable" && user.role !== "administrator" && user.role !== "teacher") {
    return FORBIDDEN;
  }
  if (need === "unlock" && user.role !== "administrator") {
    // 解锁仍要先确认教学班存在，保持 404 优先于角色拒绝。
    const teachingClass = await findTeachingClass(teachingClassId);
    return teachingClass ? UNLOCK_FORBIDDEN : NOT_FOUND;
  }
  // 详情页对非任课教师直接 403，不暴露教学班是否存在。
  if (need === "read" && user.role === "teacher") {
    if (!(await isTeachingClassTeacher(teachingClassId, user.id))) {
      return FORBIDDEN;
    }
    const teachingClass = await findTeachingClass(teachingClassId);
    return teachingClass ? { ok: true, teachingClass } : NOT_FOUND;
  }
  if (need === "read" && user.role !== "administrator") {
    return FORBIDDEN;
  }

  const teachingClass = await findTeachingClass(teachingClassId);
  if (!teachingClass) return NOT_FOUND;

  if (user.role === "administrator") {
    return { ok: true, teachingClass };
  }

  if (user.role === "teacher") {
    if (need === "grades") {
      return teachingClass.teacher.id === user.id
        ? { ok: true, teachingClass }
        : FORBIDDEN;
    }
    if (await isTeachingClassTeacher(teachingClassId, user.id)) {
      return { ok: true, teachingClass };
    }
    return FORBIDDEN;
  }

  return FORBIDDEN;
}
