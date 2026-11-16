import { randomInt } from "node:crypto";

import type { Options } from "@node-rs/argon2";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id 参数取 OWASP 推荐的 19 MiB / 2 次迭代 / 1 路并行。
 * 这些参数写在代码里而不是环境变量里，避免不同实例用不同口径。
 *
 * 2 是 @node-rs/argon2 的 Algorithm.Argon2id。该枚举是 const enum，
 * 在 isolatedModules 下不能直接引用成员，因此用 Options 类型收窄数值。
 */
const ARGON2ID = 2 as Options["algorithm"];

const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * 登录名不存在时也做一次同等代价的校验，避免通过响应耗时判断账号是否存在。
 * 该哈希对应的明文是随机的测试串，不对应任何账号。
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$yg5vpez6VRP3KtUn+ya4jg$Epl2mriPpKLeLPcchxcb2nHgzWOi5OGA3/8moRB8FNw";

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 批量导入时由系统生成的初始密码长度。 */
export const GENERATED_PASSWORD_LENGTH = 12;

const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

function randomCharacter(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * 生成一次性初始密码：12 位，保证同时含大写、小写与数字。
 * 使用 node:crypto 的 randomInt，不依赖 Math.random 的可预测序列。
 */
export function generateInitialPassword(): string {
  const alphabet = UPPERCASE + LOWERCASE + DIGITS;
  const characters = [
    randomCharacter(UPPERCASE),
    randomCharacter(LOWERCASE),
    randomCharacter(DIGITS),
  ];

  while (characters.length < GENERATED_PASSWORD_LENGTH) {
    characters.push(randomCharacter(alphabet));
  }

  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j]!, characters[i]!];
  }

  return characters.join("");
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "请输入密码。";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密码至少 ${PASSWORD_MIN_LENGTH} 位。`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`;
  }
  return null;
}

export function loginNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入登录名。";
  }
  const loginName = value.trim();
  if (loginName.length > 64) {
    return "登录名不能超过 64 个字符。";
  }
  if (/\s/.test(loginName)) {
    return "登录名不能包含空格。";
  }
  return null;
}

export function displayNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入姓名。";
  }
  if (value.trim().length > 64) {
    return "姓名不能超过 64 个字符。";
  }
  return null;
}
