import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || undefined;

if (!url) {
  console.error("缺少环境变量 DATABASE_URL，无法执行数据库迁移。");
  process.exit(1);
}

if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error("DATABASE_SCHEMA 不是合法的 schema 名称。");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  onnotice: false,
  connection:
    schema === undefined ? undefined : { search_path: `"${schema}"` },
});

try {
  await migrate(drizzle(sql), {
    migrationsFolder: path.join(root, "drizzle"),
    migrationsSchema: schema,
  });
  console.log(`数据库迁移完成${schema ? `（schema: ${schema}）` : ""}。`);
} catch (error) {
  console.error("数据库迁移失败。", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
