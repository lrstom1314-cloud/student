#!/usr/bin/env node
/**
 * 账号开通脚本：用于建立第一个教务管理员，或在本机排障时补建账号。
 *
 * 日常建号请走教务管理员界面；本脚本只在系统还没有任何管理员时使用。
 * 密码同样以 Argon2id 哈希写入，绝不存明文。
 */
import { Algorithm, hash } from "@node-rs/argon2";
import postgres from "postgres";

const ROLES = ["student", "teacher", "administrator"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail(`无法识别的参数：${item}`);
    const key = item.slice(2);
    if (key === "no-force-change" || key === "disabled") {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`参数 --${key} 缺少值。`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || undefined;

if (!databaseUrl) {
  fail("缺少环境变量 DATABASE_URL。");
}

const login = (args.login ?? "").trim();
const displayName = (args.name ?? login).trim();
const role = args.role ?? "administrator";
const password = args.password ?? "";

if (!login) fail("请用 --login 指定登录名。");
if (/\s/.test(login)) fail("登录名不能包含空格。");
if (login.length > 64) fail("登录名不能超过 64 个字符。");
if (!ROLES.includes(role)) {
  fail(`角色必须是 ${ROLES.join(" / ")} 之一。`);
}
if (password.length < 8) fail("密码至少 8 位。");
if (password.length > 128) fail("密码不能超过 128 位。");

if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) {
  fail("DATABASE_SCHEMA 不是合法的 schema 名称。");
}

const passwordHash = await hash(password, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  onnotice: false,
  connection:
    schema === undefined ? undefined : { search_path: `"${schema}"` },
});

try {
  const rows = await sql`
    insert into accounts (
      login_name, display_name, password_hash, role,
      must_change_password, disabled
    )
    values (
      ${login}, ${displayName}, ${passwordHash}, ${role},
      ${!args["no-force-change"]}, ${Boolean(args.disabled)}
    )
    returning login_name, role
  `;
  const account = rows[0];
  console.log(
    `已创建账号 ${account.login_name}（${account.role}）${
      args["no-force-change"] ? "" : "，首次登录需修改密码"
    }。`,
  );
} catch (error) {
  if (error && error.code === "23505") {
    fail(`登录名 ${login} 已存在。`);
  }
  console.error("创建账号失败：", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
