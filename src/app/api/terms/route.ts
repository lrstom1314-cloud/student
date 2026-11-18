import { handleApi, jsonOk } from "@/lib/api-route";
import { listTermsOverview } from "@/lib/terms";

export const dynamic = "force-dynamic";

/**
 * 学期列表：三个角色都可读取，学生端与教师端据此确定默认视图的范围。
 */
export const GET = handleApi(
  { idParam: null },
  async () => {
    const overview = await listTermsOverview();
    return jsonOk(overview);
  },
);
