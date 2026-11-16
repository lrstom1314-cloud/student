import { NextResponse } from "next/server";

import { getDb } from "@/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET() {
  const startedAt = Date.now();

  try {
    const sql = getDb();
    const rows = await sql<{ schema: string | null }[]>`
      select current_schema() as schema
    `;
    const currentSchema = rows[0]?.schema ?? null;

    return NextResponse.json(
      {
        status: "ok",
        checks: { database: "ok" },
        schema: currentSchema,
        latencyMs: Date.now() - startedAt,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("健康检查失败：数据库不可用。", error);
    return NextResponse.json(
      {
        status: "error",
        checks: { database: "error" },
        message: "数据库不可用",
        latencyMs: Date.now() - startedAt,
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
