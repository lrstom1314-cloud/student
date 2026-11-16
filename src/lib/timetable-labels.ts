import type { WeekParity } from "@/db/schema";

export type { WeekParity } from "@/db/schema";

/**
 * 课表词汇与展示文案：与数据库无关，客户端组件也可以安全引用。
 * 术语见 GLOSSARY.md：课表由星期、节次、周次范围与单双周构成。
 */
export const WEEKDAY_LABELS = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
] as const;

export const WEEK_PARITY_LABELS: Record<WeekParity, string> = {
  every: "每周",
  odd: "单周",
  even: "双周",
};

export const WEEK_PARITIES: readonly WeekParity[] = ["every", "odd", "even"];

export const MIN_PERIOD = 1;
export const MAX_PERIOD = 20;
export const MIN_WEEK = 1;
export const MAX_WEEK = 30;
export const MAX_CLASSROOM_LENGTH = 64;

export function isWeekParity(value: unknown): value is WeekParity {
  return value === "every" || value === "odd" || value === "even";
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - 1] ?? `星期 ${weekday}`;
}

export function parityLabel(parity: WeekParity): string {
  return WEEK_PARITY_LABELS[parity];
}

/** 「周一 第 1-2 节」这样的一行摘要。 */
export function periodLabel(startPeriod: number, endPeriod: number): string {
  return startPeriod === endPeriod
    ? `第 ${startPeriod} 节`
    : `第 ${startPeriod}-${endPeriod} 节`;
}

/** 「第 1-16 周 每周」这样的周次摘要。 */
export function weekLabel(
  startWeek: number,
  endWeek: number,
  parity: WeekParity,
): string {
  const range =
    startWeek === endWeek ? `第 ${startWeek} 周` : `第 ${startWeek}-${endWeek} 周`;
  return `${range} ${parityLabel(parity)}`;
}
