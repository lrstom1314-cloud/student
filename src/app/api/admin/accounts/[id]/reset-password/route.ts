import { NextResponse } from "next/server";

import { setAccountPassword } from "@/lib/accounts";
import { requireApiUser, revokeAccountSessions } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { hashPassword, passwordProblem } from "@/lib/password";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 教务管理员重置任意账号密码。重置后该账号再次被要求改密，
 * 且其现有会话立即失效。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return errorResponse("账号不存在。", 404);
  }

  const body = await readJsonObject(request);
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : "";

  const problem = passwordProblem(newPassword);
  if (problem) return errorResponse(problem, 400);

  try {
    const account = await setAccountPassword({
      accountId: id,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: true,
    });
    if (!account) {
      return errorResponse("账号不存在。", 404);
    }

    await revokeAccountSessions(id);

    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
