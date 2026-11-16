import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");

let loaded = false;

/**
 * 测试与本地命令共用 .env。已存在的环境变量优先，便于 CI 注入。
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  if (process.env.DATABASE_URL) return;

  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(ROOT, file));
    } catch {
      // 文件不存在时静默跳过。
    }
    if (process.env.DATABASE_URL) return;
  }
}

export function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "缺少环境变量 DATABASE_URL。请先启动 PostgreSQL（docker compose up -d db），并在 .env 中填写连接串。",
    );
  }
  return url;
}
