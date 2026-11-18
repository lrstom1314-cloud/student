import { setAccountDisabled } from "@/lib/accounts";
import { handleApi, jsonOk } from "@/lib/api-route";
import { revokeAccountSessions } from "@/lib/auth";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 启用 / 停用账号。停用会立即吊销该账号的所有会话。 */
export const PATCH = handleApi(
  {
    roles: ["administrator"],
    idError: "账号不存在。",
    body: "optional",
  },
  async ({ id, body }) => {
    if (typeof body?.disabled !== "boolean") {
      return errorResponse("请提供有效的账号状态。", 400);
    }

    const account = await setAccountDisabled(id!, body.disabled);
    if (!account) {
      return errorResponse("账号不存在。", 404);
    }

    if (body.disabled) {
      await revokeAccountSessions(id!);
    }

    return jsonOk({ account });
  },
);
