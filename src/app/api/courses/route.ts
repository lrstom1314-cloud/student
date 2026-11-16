import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import { listCourses } from "@/lib/courses";
import { internalError, NO_STORE } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 课程目录：已登录用户都可以读取，用于教学班表单与后续课表。 */
export async function GET() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  try {
    const courses = await listCourses();
    return NextResponse.json({ courses }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
