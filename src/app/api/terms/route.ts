import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { internalError, NO_STORE } from "@/lib/http";
import { listTermsOverview } from "@/lib/terms";

export const dynamic = "force-dynamic";

/**
 * 学期列表：三个角色都可读取，学生端与教师端据此确定默认视图的范围。
 */
export async function GET() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  try {
    const overview = await listTermsOverview();
    return NextResponse.json(overview, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
