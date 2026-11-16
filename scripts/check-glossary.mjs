#!/usr/bin/env node
/**
 * 作废术语守门人。
 *
 * `GLOSSARY.md` 每个词条都有一行 `_Avoid_`，列出本项目禁止使用的同义词。
 * 这类违规只在审查时被人眼抓到过一次（分项 / 期末成绩 / 裸「管理员」），
 * 而它是纯粹的字符串模式问题 —— 该由确定性检查负责，不该浪费 review 的注意力。
 *
 * 扫描范围只限 `src/` 下的 .ts/.tsx：界面文案、贴纸文本与标识符。
 * 测试文件**故意**不扫描：测试需要写出作废词才能断言「界面上不出现它」。
 * 注释行也会被剥离：注释里允许说明历史沿革。
 *
 * 用法：node scripts/check-glossary.mjs （可用 CHECK_ROOT 指向其它目录，便于自测）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.env.CHECK_ROOT ? path.resolve(process.env.CHECK_ROOT) : process.cwd();
const sourceDir = path.join(root, "src");

/**
 * 只收「中文、且在界面/标识符里有实际杀伤力」的作废词。
 * 英文（class / term / subject / id）与过短词（课 / 状态 / 账号）不收：
 * 它们在代码里会大量误报，收益远小于噪音。
 * @type {Array<{ term: string, use: string, allowPrefix?: string }>}
 */
const BANNED = [
  { term: "分项", use: "成绩项" },
  { term: "分数项", use: "成绩项" },
  { term: "小分", use: "成绩项" },
  { term: "总分", use: "总评" },
  { term: "最终成绩", use: "总评" },
  { term: "期末成绩", use: "总评" },
  { term: "班级", use: "行政班" },
  { term: "开课", use: "教学班" },
  { term: "教学任务", use: "教学班" },
  { term: "课程实例", use: "教学班" },
  { term: "课程表", use: "课表" },
  { term: "时间表", use: "课表" },
  { term: "科目", use: "课程" },
  { term: "半学年", use: "学期" },
  { term: "学年度", use: "学年" },
  { term: "当前周", use: "教学周" },
  { term: "活跃学期", use: "当前学期" },
  { term: "默认学期", use: "当前学期" },
  { term: "起始日", use: "开学日期" },
  { term: "学期开始时间", use: "开学日期" },
  { term: "学员", use: "学生" },
  { term: "老师", use: "教师" },
  { term: "授课人", use: "教师" },
  { term: "超管", use: "教务管理员" },
  { term: "学籍号", use: "学号" },
  { term: "教工号", use: "工号" },
  { term: "学生状态", use: "学籍状态" },
  { term: "管理员", use: "教务管理员", allowPrefix: "教务" },
];

/** @type {Array<{ file: string, line: number, hunk: string, entry: typeof BANNED[number] }>} */
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    scan(full);
  }
}

function scan(file) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((raw, index) => {
    const line = stripComment(raw);
    if (line.trim() === "") return;

    for (const entry of BANNED) {
      const hits = countHits(line, entry);
      if (hits > 0) {
        findings.push({
          file: path.relative(root, file),
          line: index + 1,
          hunk: raw.trim(),
          entry,
        });
      }
    }
  });
}

/** 去掉行尾 `//` 注释与整行块注释，注释里允许出现作废词。 */
function stripComment(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return "";
  const slash = line.indexOf("//");
  // 避免把 https:// 这类协议当成注释
  if (slash >= 0 && !/https?:\/\//.test(line.slice(Math.max(0, slash - 6), slash + 3))) {
    return line.slice(0, slash);
  }
  return line;
}

function countHits(line, entry) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = line.indexOf(entry.term, from);
    if (at < 0) break;
    from = at + entry.term.length;
    if (entry.allowPrefix) {
      const prefix = line.slice(Math.max(0, at - entry.allowPrefix.length), at);
      if (prefix === entry.allowPrefix) continue;
    }
    count += 1;
  }
  return count;
}

if (!statSync(sourceDir, { throwIfNoEntry: false })) {
  console.error(`找不到 ${path.relative(root, sourceDir)} 目录`);
  process.exit(1);
}

walk(sourceDir);

if (findings.length > 0) {
  console.error(`发现 ${findings.length} 处作废术语（以 GLOSSARY.md 的 _Avoid_ 为准）：\n`);
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line}  「${finding.entry.term}」→ 请改用「${finding.entry.use}」`,
    );
    console.error(`      ${finding.hunk}`);
  }
  console.error("\n若出现在注释里，请把该行改成块注释或行首注释；界面与标识符必须改用术语表词汇。");
  process.exit(1);
}

console.log(`术语检查通过：src/ 下未发现 ${BANNED.length} 类作废词。`);
