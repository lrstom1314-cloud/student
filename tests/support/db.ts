import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { databaseUrl, ROOT } from "./env";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

export function quoteSchema(schema: string): string {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`非法的 schema 名称：${schema}`);
  }
  return `"${schema}"`;
}

export function newSchemaName(prefix = "test"): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function adminClient() {
  return postgres(databaseUrl(), { max: 1, connect_timeout: 5 });
}

export async function createSchema(schema: string): Promise<void> {
  const sql = adminClient();
  try {
    await sql.unsafe(`CREATE SCHEMA ${quoteSchema(schema)}`);
  } finally {
    await sql.end();
  }
}

export async function dropSchema(schema: string): Promise<void> {
  const sql = adminClient();
  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${quoteSchema(schema)} CASCADE`);
  } finally {
    await sql.end();
  }
}

export async function schemaExists(schema: string): Promise<boolean> {
  const sql = adminClient();
  try {
    const rows = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.schemata where schema_name = ${schema}
      ) as exists
    `;
    return rows[0]?.exists ?? false;
  } finally {
    await sql.end();
  }
}

/**
 * 在指定 schema 内执行仓库中的版本化迁移。连接级 search_path 指向该 schema，
 * 因此迁移 SQL 中的未限定表名都会落在隔离 schema 里。
 */
export async function runMigrations(schema: string): Promise<void> {
  const sql = postgres(databaseUrl(), {
    max: 1,
    connect_timeout: 5,
    onnotice: false,
    connection: { search_path: quoteSchema(schema) },
  });

  try {
    await migrate(drizzle(sql), {
      migrationsFolder: path.join(ROOT, "drizzle"),
      migrationsSchema: schema,
    });
  } finally {
    await sql.end();
  }
}

export async function appliedMigrationCount(schema: string): Promise<number> {
  const sql = adminClient();
  try {
    const rows = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM ${quoteSchema(schema)}.__drizzle_migrations`,
    );
    return rows[0]?.count ?? 0;
  } finally {
    await sql.end();
  }
}
