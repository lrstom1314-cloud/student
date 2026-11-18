/**
 * 成绩数值的统一表示：数据库 numeric 以「放大 100 倍的整数」在内存中运算，
 * 避免浮点误差。这里只放与数据库无关的解析、格式化与加权计算，
 * 供成绩表装配、录入校验与发布快照共用。
 */

export const SCALE = 100;
export const MAX_SCORE = 999_999; // 9999.99
export const MAX_WEIGHT = 10_000; // 100.00

export type ParsedDecimal =
  | { ok: true; scaled: number }
  | { ok: false; error: string };

export function scaledToText(scaled: number): string {
  const whole = Math.trunc(scaled / SCALE);
  const fraction = Math.abs(scaled % SCALE)
    .toString()
    .padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function scaledToNumber(scaled: number): number {
  return Number(scaledToText(scaled));
}

/** 读取数据库 numeric 文本为放大 100 倍的整数。 */
export function parseStoredDecimal(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0").slice(0, 2);
  return whole * SCALE + (whole < 0 ? -1 : 1) * Number(fraction);
}

/** 解析用户输入的成绩/权重文本：最多两位小数、非负、不超上限。 */
export function parseDecimal(value: unknown, field: string): ParsedDecimal {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, error: `${field}需为有效数字。` };
    }
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return { ok: false, error: `${field}需为有效数字。` };
  }

  if (text.length === 0) {
    return { ok: false, error: `${field}不能为空。` };
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    return { ok: false, error: `${field}最多保留两位小数。` };
  }

  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const scaled = whole * SCALE + Number(fraction);
  if (scaled > MAX_SCORE) {
    return { ok: false, error: `${field}不能超过 9999.99。` };
  }
  return { ok: true, scaled };
}

export type GradeCalcItem = {
  id: string;
  maxScaled: number;
  weightScaled: number;
};

/**
 * 按 Σ(得分 ÷ 满分 × 权重) 计算总评，保留两位小数（正数四舍五入）。
 * 任一成绩项缺失时返回 null 与缺失项 ID，不把缺考折算成 0 分。
 */
export function computeOverallHundredths(
  items: GradeCalcItem[],
  scores: Map<string, number>,
): { scaled: number | null; missing: string[] } {
  const missing = items
    .filter((item) => !scores.has(item.id))
    .map((item) => item.id);
  if (items.length === 0 || missing.length > 0) {
    return { scaled: null, missing };
  }

  const product = items.reduce(
    (accumulator, item) => accumulator * BigInt(item.maxScaled),
    1n,
  );
  let numerator = 0n;
  for (const item of items) {
    const score = scores.get(item.id)!;
    numerator +=
      BigInt(score) *
      BigInt(item.weightScaled) *
      (product / BigInt(item.maxScaled));
  }

  // 正数四舍五入到整数：floor((2n + d) / 2d)。
  const rounded = (BigInt(2) * numerator + product) / (BigInt(2) * product);
  return { scaled: Number(rounded), missing };
}
