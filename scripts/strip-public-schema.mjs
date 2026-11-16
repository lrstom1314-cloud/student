/**
 * drizzle-kit 会把默认 schema 写成 "public"."表名"。测试在每个测试文件独占的
 * schema 里执行同一份迁移，靠连接级 search_path 决定落点；写死 public 会击穿隔离。
 * 生成迁移后统一去掉 public 限定，让迁移在任意 schema 中都能执行。
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "drizzle");

const files = (await readdir(migrationsDir)).filter((file) =>
  file.endsWith(".sql"),
);

let changed = 0;
for (const file of files) {
  const fullPath = path.join(migrationsDir, file);
  const original = await readFile(fullPath, "utf8");
  const stripped = original.replaceAll('"public".', "");
  if (stripped !== original) {
    await writeFile(fullPath, stripped, "utf8");
    changed += 1;
  }
}

console.log(`已检查 ${files.length} 个迁移文件，移除 public 限定的有 ${changed} 个。`);
