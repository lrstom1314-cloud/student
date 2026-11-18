import { setAccountPassword } from "@/lib/accounts";
import { handleApi, jsonOk } from "@/lib/api-route";
import { revokeAccountSessions } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { hashPassword, passwordProblem } from "@/lib/password";

export const dynamic = "force-dynamic";

/**
 * 教务管理员重置任意账号密码。重置后该账号再次被要求改密，
 * 且其现有会话立即失效。
 */
export const POST = handleApi(
  {
    roles: ["administrator"],
    idError: "账号不存在。",
    body: "optional",
  },
  async ({ id, body }) => {
    const newPassword =
      typeof body?.newPassword === "string" ? body.newPassword : "";

    const problem = passwordProblem(newPassword);
    if (problem) return errorResponse(problem, 400);

    const account = await setAccountPassword({
      accountId: id!,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: true,
    });
    if (!account) {
      return errorResponse("账号不存在。", 404);
    }

    await revokeAccountSessions(id!);

    return jsonOk({ ok: true });
  },
);
