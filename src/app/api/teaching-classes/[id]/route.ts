import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { errorResponse, internalError, isUuid, NO_STORE } from "@/lib/http";
import {
  getTeachingClassDetail,
  isTeachingClassTeacher,
} from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 教学班详情：教务管理员可看全部；教师只能看自己任教的班，
 * 直接请求他人的教学班返回 403。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("教学班不存在。", 404);

  try {
    if (guard.user.role === "administrator") {
      const teachingClass = await getTeachingClassDetail(id);
      if (!teachingClass) return errorResponse("教学班不存在。", 404);
      return NextResponse.json({ teachingClass }, { headers: NO_STORE });
    }

    if (guard.user.role === "teacher") {
      const owns = await isTeachingClassTeacher(id, guard.user.id);
      if (!owns) return errorResponse("无权访问。", 403);

      const teachingClass = await getTeachingClassDetail(id);
      if (!teachingClass) return errorResponse("教学班不存在。", 404);
      return NextResponse.json({ teachingClass }, { headers: NO_STORE });
    }

    return errorResponse("无权访问。", 403);
  } catch (error) {
    return internalError(error);
  }
}
