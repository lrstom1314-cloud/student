import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATE = path.join(ROOT, "scripts/migrate.mjs");

function runMigrate(env) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [MIGRATE], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, ...env },
  });
  return { ...result, elapsedMs: Date.now() - startedAt };
}

describe("启动期数据库不可达", () => {
  it("立即以非零退出并给出可操作的中文错误，不无限重试、不泄露密码", () => {
    const { status, stdout, stderr, elapsedMs, signal } = runMigrate({
      DATABASE_URL: "postgres://student:super-secret-password@127.0.0.1:1/student",
    });

    assert.equal(signal, null, "不应被超时杀死（说明没有无限重试）");
    assert.equal(status, 1);
    assert.ok(elapsedMs < 15_000, `退出耗时过长：${elapsedMs}ms`);

    const output = `${stdout}${stderr}`;
    assert.match(output, /数据库连接失败/);
    assert.match(output, /已中止/);
    assert.match(output, /不会自动重试/);
    assert.match(output, /127\.0\.0\.1:1/);
    assert.doesNotMatch(output, /super-secret-password/);
  });

  it("缺少 DATABASE_URL 时同样立即失败并说明原因", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, [MIGRATE], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10_000,
      env,
    });

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /缺少环境变量 DATABASE_URL/);
  });
});
