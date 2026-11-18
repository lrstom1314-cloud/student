import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";
import { getTeachingClassDetail } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

/**
 * 教学班详情：教务管理员可看全部；教师只能看自己任教的班，
 * 直接请求他人的教学班返回 403。
 */
export const GET = handleApi(
  { idError: "教学班不存在。" },
  async ({ id, user }) => {
    const access = await authorizeTeachingClass(id!, user, "read");
    if (!access.ok) return errorResponse(access.error, access.status);

    const teachingClass = await getTeachingClassDetail(id!);
    if (!teachingClass) return errorResponse("教学班不存在。", 404);
    return jsonOk({ teachingClass });
  },
);
