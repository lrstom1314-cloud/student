import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

import {
  createSchema,
  dropSchema,
  newSchemaName,
  runMigrations,
} from "./db";
import { databaseUrl, loadEnv, ROOT } from "./env";

export type TestApp = {
  baseUrl: string;
  /** 本测试文件独占的 schema；使用外部数据库时为 null。 */
  schema: string | null;
  stop: () => Promise<void>;
};

type StartOptions = {
  /** 覆盖应用连接串，例如指向不可用的数据库来验证失败路径。 */
  databaseUrl?: string;
  /** 传入 null 表示不创建 schema，也不执行迁移。 */
  schema?: string | null;
  /** 默认 true；schema 为 null 时自动跳过。 */
  migrate?: boolean;
};

const NEXT_BIN = path.join(ROOT, "node_modules/next/dist/bin/next");
const READY_TIMEOUT_MS = 30_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("无法分配测试端口。"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl: string, child: ChildProcess, logs: () => string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`应用进程提前退出（code=${child.exitCode}）。\n${logs()}`);
    }

    try {
      await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(1_000),
        cache: "no-store",
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new Error(`应用在 ${READY_TIMEOUT_MS}ms 内未就绪。\n${logs()}`);
}

/**
 * 为一个测试文件启动真实的应用进程：
 * 1. 新建独占 schema 并执行迁移；
 * 2. 用 `next start` 启动生产构建，DATABASE_SCHEMA 指向该 schema；
 * 3. 测试结束后杀掉进程并 DROP SCHEMA CASCADE。
 */
export async function startTestApp(options: StartOptions = {}): Promise<TestApp> {
  loadEnv();

  const schema =
    options.schema === undefined ? newSchemaName() : options.schema;
  const shouldMigrate = options.migrate ?? schema !== null;
  const url = options.databaseUrl ?? databaseUrl();

  if (schema !== null) {
    await createSchema(schema);
    if (shouldMigrate) {
      await runMigrations(schema);
    }
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: url,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  };

  if (schema === null) {
    delete env.DATABASE_SCHEMA;
  } else {
    env.DATABASE_SCHEMA = schema;
  }

  const child = spawn(
    process.execPath,
    [NEXT_BIN, "start", "--port", String(port), "--hostname", "127.0.0.1"],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );

  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }

    if (schema !== null) {
      await dropSchema(schema);
    }
  };

  try {
    await waitForServer(baseUrl, child, () => output);
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseUrl, schema, stop };
}
