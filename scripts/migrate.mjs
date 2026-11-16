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

/** 打印连接目标时去掉密码，避免把凭据写进日志。 */
function describeTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "";
    return parsed.toString();
  } catch {
    return "（DATABASE_URL 格式不合法，无法解析主机）";
  }
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  onnotice: false,
  connection:
    schema === undefined ? undefined : { search_path: `"${schema}"` },
});

let connected = false;

try {
  // 启动前置检查：数据库不可达时立即中止。容器入口用 `&&` 连接本脚本与
  // `npm start`，因此这里失败意味着应用不会带着坏配置半启动，也不会反复重试。
  try {
    await sql`select 1`;
    connected = true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "未知错误";
    console.error(
      [
        `数据库连接失败：无法连接 ${describeTarget(url)}（错误码：${code}）。`,
        "应用启动已中止：请确认 PostgreSQL 容器已启动、DATABASE_URL 的主机与端口可达、",
        "且密码与 POSTGRES_PASSWORD 一致。修正后重启容器即可；本进程不会自动重试。",
      ].join("\n"),
    );
    process.exitCode = 1;
  }

  if (connected) {
    await migrate(drizzle(sql), {
      migrationsFolder: path.join(root, "drizzle"),
      migrationsSchema: schema,
    });
    console.log(
      `数据库迁移完成${schema ? `（schema: ${schema}）` : ""}。`,
    );
  }
} catch (error) {
  console.error("数据库迁移失败。", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
