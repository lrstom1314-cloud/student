import type { TermHalf } from "@/db/schema";

export type { TermHalf } from "@/db/schema";

/**
 * 与数据库无关的学期词汇与展示文案，客户端组件也可以安全引用。
 * 术语见 GLOSSARY.md：学年以起始年份标识，学期在学年内分上 / 下。
 */
export const TERM_HALF_LABELS: Record<TermHalf, string> = {
  first: "上学期",
  second: "下学期",
};

export const TERM_HALVES: readonly TermHalf[] = ["first", "second"];

export function isTermHalf(value: unknown): value is TermHalf {
  return value === "first" || value === "second";
}

export function academicYearLabel(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

export function termLabel(startYear: number, half: TermHalf): string {
  return `${academicYearLabel(startYear)} 学年${TERM_HALF_LABELS[half]}`;
}
