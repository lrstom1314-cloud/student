import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_CHECK = path.join(ROOT, "scripts/check-migrations.mjs");
const GLOSSARY_CHECK = path.join(ROOT, "scripts/check-glossary.mjs");

const tempDirs = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "student-check-test-"));
  tempDirs.push(dir);
  return dir;
}

function runCheck(script, root) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHECK_ROOT: root },
  });
}

/** 构造一个最小迁移目录；tags 决定 journal 与 SQL 文件名。 */
function migrationsFixture(tags) {
  const dir = tempDir();
  mkdirSync(path.join(dir, "drizzle", "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "drizzle", "meta", "_journal.json"),
    JSON.stringify({ entries: tags.map((tag, idx) => ({ idx, tag })) }),
  );
  for (const tag of tags) {
    writeFileSync(path.join(dir, "drizzle", `${tag}.sql`), "");
  }
  return dir;
}

/** 构造一个最小 src 目录，写入一个文件。 */
function sourceFixture(relativePath, contents) {
  const dir = tempDir();
  const target = path.join(dir, "src", relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("迁移检查", () => {
  it("当前仓库的迁移通过", () => {
    const result = runCheck(MIGRATIONS_CHECK, ROOT);
    assert.equal(result.status, 0, result.stderr);
  });

  it("编号连续且唯一的迁移通过", () => {
    const dir = migrationsFixture(["0000_baseline", "0001_add_students"]);
    const result = runCheck(MIGRATIONS_CHECK, dir);
    assert.equal(result.status, 0, result.stderr);
  });

  it("两个工单撞同一个编号时报错", () => {
    const dir = migrationsFixture(["0000_baseline", "0001_terms", "0001_grades"]);
    const result = runCheck(MIGRATIONS_CHECK, dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /前缀编号与顺序不符/);
  });

  it("编号出现空洞时报错", () => {
    const dir = migrationsFixture(["0000_baseline", "0002_gap"]);
    const result = runCheck(MIGRATIONS_CHECK, dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /前缀编号与顺序不符/);
  });

  it("drizzle-kit 自动生成的怪名字报错", () => {
    const dir = migrationsFixture(["0000_baseline", "0001_WoozyHunter"]);
    const result = runCheck(MIGRATIONS_CHECK, dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NNNN_小写蛇形/);
  });

  it("SQL 文件没登记在 journal 里时报错", () => {
    const dir = migrationsFixture(["0000_baseline"]);
    writeFileSync(path.join(dir, "drizzle", "0001_forgotten.sql"), "");
    const result = runCheck(MIGRATIONS_CHECK, dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /没有登记/);
  });
});

describe("术语检查", () => {
  it("当前仓库的 src 通过", () => {
    const result = runCheck(GLOSSARY_CHECK, ROOT);
    assert.equal(result.status, 0, result.stderr);
  });

  it("界面里出现作废词时报错", () => {
    const dir = sourceFixture("app/page.tsx", "export default () => <p>任一分项缺失</p>;\n");
    const result = runCheck(GLOSSARY_CHECK, dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /分项/);
  });

  it("注释里的作废词不报错", () => {
    const dir = sourceFixture("lib/note.ts", "/**\n * 历史上这里叫分项。\n */\nexport const a = 1;\n");
    const result = runCheck(GLOSSARY_CHECK, dir);
    assert.equal(result.status, 0, result.stderr);
  });

  it("教务管理员不算违规，裸「管理员」才算", () => {
    const ok = sourceFixture("app/page.tsx", "export const label = \"教务管理员\";\n");
    assert.equal(runCheck(GLOSSARY_CHECK, ok).status, 0);

    const bad = sourceFixture("app/page.tsx", "export const label = \"管理员\";\n");
    const result = runCheck(GLOSSARY_CHECK, bad);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /管理员/);
  });

  it("测试目录不在扫描范围内（测试需要写作废词来断言其不存在）", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    writeFileSync(path.join(dir, "tests", "x.test.ts"), "// 界面不应出现 班级 平均分\n");
    const result = runCheck(GLOSSARY_CHECK, dir);
    assert.equal(result.status, 0, result.stderr);
  });
});
