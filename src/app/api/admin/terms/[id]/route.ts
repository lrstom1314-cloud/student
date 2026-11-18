import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse } from "@/lib/http";
import { setTermStartsOn } from "@/lib/terms";
import { parseIsoDate } from "@/lib/teaching-week";

export const dynamic = "force-dynamic";

/**
 * 设置学期的教学第 1 周起始日期。仅教务管理员可操作。
 * startsOn 为 null 表示清除；空字符串按未填写处理。
 */
export const PATCH = handleApi(
  {
    roles: ["administrator"],
    idError: "学期不存在。",
    body: "optional",
  },
  async ({ id, body }) => {
    if (!body || !("startsOn" in body)) {
      return errorResponse("请提供开学日期。", 400);
    }

    let startsOn: string | null;
    if (body.startsOn === null) {
      startsOn = null;
    } else {
      startsOn = parseIsoDate(body.startsOn);
      if (startsOn === null) {
        return errorResponse("请填写有效的开学日期（YYYY-MM-DD）。", 400);
      }
    }

    const term = await setTermStartsOn(id!, startsOn);
    if (!term) return errorResponse("学期不存在。", 404);
    return jsonOk({ term });
  },
);
