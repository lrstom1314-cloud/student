#!/usr/bin/env node
/**
 * 迁移编号守门人。
 *
 * 这个仓库的迁移由 drizzle-kit 生成，多个工单并行时极容易撞号（历史上撞过 4 次）。
 * 撞号的症状很隐蔽：本地能跑，合并后快照链断裂，`db:generate` 开始产出错误的 diff。
 * 因此把「编号连续且唯一、文件名与 journal 一致」变成确定性检查，而不是靠人肉发现。
 *
 * 用法：node scripts/check-migrations.mjs （可用 CHECK_ROOT 指向其它目录，便于自测）
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.env.CHECK_ROOT ? path.resolve(process.env.CHECK_ROOT) : process.cwd();
const drizzleDir = path.join(root, "drizzle");
const journalPath = path.join(drizzleDir, "meta", "_journal.json");

/** NNNN_小写蛇形，例如 0003_administrative_classes_and_students */
const TAG_PATTERN = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** @type {string[]} */
const problems = [];

function fail() {
  console.error("迁移检查未通过：\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\n修法：删除自己那份迁移与快照，然后重新 `npm run db:generate` 顺延编号。");
  console.error("不要把别人的迁移改名，也不要手工编辑 _journal.json。");
  process.exit(1);
}

if (!existsSync(journalPath)) {
  problems.push(`找不到 ${path.relative(root, journalPath)}`);
  fail();
}

/** @type {{ entries?: Array<{ idx: number, tag: string }> }} */
let journal;
try {
  journal = JSON.parse(readFileSync(journalPath, "utf8"));
} catch (error) {
  problems.push(`无法解析 _journal.json：${String(error)}`);
  fail();
}

const entries = journal.entries ?? [];
if (entries.length === 0) {
  problems.push("_journal.json 里没有任何迁移条目");
  fail();
}

const seenTags = new Set();
entries.forEach((entry, position) => {
  const where = `journal 第 ${position} 项（tag=${entry.tag}）`;

  if (entry.idx !== position) {
    problems.push(`${where} 的 idx 是 ${entry.idx}，应为 ${position}：编号出现空洞或重复`);
  }

  const match = TAG_PATTERN.exec(entry.tag);
  if (!match) {
    problems.push(`${where} 不符合 NNNN_小写蛇形 命名（例如 0003_administrative_classes_and_students）`);
  } else if (Number(match[1]) !== position) {
    problems.push(`${where} 的前缀编号与顺序不符（应为 ${String(position).padStart(4, "0")}）`);
  }

  if (seenTags.has(entry.tag)) {
    problems.push(`${where} 的 tag 重复出现`);
  }
  seenTags.add(entry.tag);

  const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
  if (!existsSync(sqlPath)) {
    problems.push(`${where} 缺少对应的 SQL 文件 drizzle/${entry.tag}.sql`);
  }
});

const onDisk = readdirSync(drizzleDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.slice(0, -".sql".length));

for (const tag of onDisk) {
  if (!seenTags.has(tag)) {
    problems.push(`drizzle/${tag}.sql 没有登记在 _journal.json 里`);
  }
}

if (problems.length > 0) fail();

console.log(`迁移检查通过：${entries.length} 个迁移，编号 0000–${String(entries.length - 1).padStart(4, "0")}。`);
