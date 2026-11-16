import { NextResponse } from "next/server";

import { setAccountDisabled } from "@/lib/accounts";
import { requireApiUser, revokeAccountSessions } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 启用 / 停用账号。停用会立即吊销该账号的所有会话。 */
export async function PATCH(
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
  if (typeof body?.disabled !== "boolean") {
    return errorResponse("请提供有效的账号状态。", 400);
  }

  try {
    const account = await setAccountDisabled(id, body.disabled);
    if (!account) {
      return errorResponse("账号不存在。", 404);
    }

    if (body.disabled) {
      await revokeAccountSessions(id);
    }

    return NextResponse.json({ account }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
