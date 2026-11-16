import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

import { databaseUrl, loadEnv, ROOT } from "./env";

/**
 * 整个测试运行只构建一次；随后每个测试文件用 `next start` 复用同一份构建。
 * 迭代时可先 `npm run build` 再 `SKIP_BUILD=1 npm test`。
 */
export default async function globalSetup(): Promise<void> {
  loadEnv();

  const url = databaseUrl();
  const probe = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    await probe`select 1`;
  } catch (error) {
    throw new Error(
      `无法连接测试数据库。请确认 PostgreSQL 已启动，且 DATABASE_URL 正确。\n${String(error)}`,
    );
  } finally {
    await probe.end();
  }

  if (process.env.SKIP_BUILD === "1") {
    console.log("SKIP_BUILD=1，跳过生产构建。");
    return;
  }

  const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`生产构建失败（exit=${result.status}）。`);
  }
}
