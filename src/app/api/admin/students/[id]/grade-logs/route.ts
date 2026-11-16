import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { requireApiUser } from "@/lib/auth";
import { listGradeChangeLogsByStudent } from "@/lib/grade-logs";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
} from "@/lib/http";

export const dynamic = "force-dynamic";

/** 按学生查询变更日志（跨教学班），仅教务管理员可用。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("学生不存在。", 404);

  try {
    const sql = getDb();
    const rows = await sql<{ id: string }[]>`
      select id from students where id = ${id} limit 1
    `;
    if (rows.length === 0) return errorResponse("学生不存在。", 404);

    const logs = await listGradeChangeLogsByStudent(id);
    return NextResponse.json({ logs }, { headers: NO_STORE });
  } catch (error) {
    return internalError(error);
  }
}
