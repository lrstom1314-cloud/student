import { NextResponse } from "next/server";

import {
  clearSessionCookie,
  currentSessionToken,
  revokeSession,
} from "@/lib/auth";
import { internalError, NO_STORE } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const token = await currentSessionToken();
    if (token) {
      await revokeSession(token);
    }

    const response = NextResponse.json(
      { ok: true, redirectTo: "/login" },
      { headers: NO_STORE },
    );
    return clearSessionCookie(response);
  } catch (error) {
    return internalError(error);
  }
}
