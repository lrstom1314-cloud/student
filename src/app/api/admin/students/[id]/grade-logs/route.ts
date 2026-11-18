import { getDb } from "@/db";
import { handleApi, jsonOk } from "@/lib/api-route";
import { listGradeChangeLogsByStudent } from "@/lib/grade-logs";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 按学生查询变更日志（跨教学班），仅教务管理员可用。 */
export const GET = handleApi(
  { roles: ["administrator"], idError: "学生不存在。" },
  async ({ id }) => {
    const sql = getDb();
    const rows = await sql<{ id: string }[]>`
      select id from students where id = ${id!} limit 1
    `;
    if (rows.length === 0) return errorResponse("学生不存在。", 404);

    const logs = await listGradeChangeLogsByStudent(id!);
    return jsonOk({ logs });
  },
);
