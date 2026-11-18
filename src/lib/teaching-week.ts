import type { WeekParity } from "@/db/schema";

/**
 * 教学周计算：把「今天」换算成学期的教学第几周。
 *
 * 校历按自然日运行，使用学校所在时区（Asia/Shanghai）判断今天，
 * 避免服务器部署在 UTC 时，晚上 8 点之后被算成第二天。
 * `starts_on` 表示第 1 周的起始日（周一）；不要求必须是周一，
 * 只要教务管理员按本校校历填写即可。
 */
export const SCHOOL_TIME_ZONE = "Asia/Shanghai";

const DAY_MS = 24 * 60 * 60 * 1000;

export type IsoDate = string;

/** YYYY-MM-DD，且必须是真实存在的日期（拒绝 2026-02-30）。 */
export function parseIsoDate(value: unknown): IsoDate | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function utcDayOf(isoDate: IsoDate): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

/** 学校时区下的今天是哪一天。 */
export function schoolToday(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * 教学第几周：floor((今天 - 第 1 周起始日) / 7) + 1。
 * 尚未开学（今天早于起始日）返回 0 或负数，调用方据此判定不在教学周内。
 */
export function teachingWeekOf(
  startsOn: IsoDate,
  today: IsoDate = schoolToday(),
): number | null {
  const start = parseIsoDate(startsOn);
  const current = parseIsoDate(today);
  if (!start || !current) return null;

  const days = Math.floor((utcDayOf(current) - utcDayOf(start)) / DAY_MS);
  return Math.floor(days / 7) + 1;
}

/**
 * 某条课表在指定教学周是否要上：
 * - 不在该条目的周次范围内：不上；
 * - 「每周」：上；
 * - 单周 / 双周：看周次奇偶。
 * week 为 null（没有开学日期或不在教学周内）时返回 null，表示「不知道」。
 */
export function scheduledInWeek(
  entry: {
    startWeek: number;
    endWeek: number;
    weekParity: WeekParity;
  },
  week: number | null,
): boolean | null {
  if (week === null) return null;
  if (week < entry.startWeek || week > entry.endWeek) return false;

  switch (entry.weekParity) {
    case "every":
      return true;
    case "odd":
      return week % 2 === 1;
    case "even":
      return week % 2 === 0;
  }
}

/**
 * 「本周」对一个学生的完整解释：是否开学、第几周、是否落在他的课表周次内。
 * 页面只渲染这个状态，不再自己拼五个重叠字段。
 */
export type TeachingWeekState =
  | { kind: "no_start_date" }
  | { kind: "before_term"; startsOn: IsoDate; computedWeek: number }
  | { kind: "no_timetable"; computedWeek: number | null }
  | {
      kind: "in_week";
      computedWeek: number;
      week: number;
      parity: "odd" | "even";
    }
  | {
      kind: "outside_range";
      computedWeek: number;
      startWeek: number;
      endWeek: number;
    };

export function teachingWeekState(input: {
  startsOn: IsoDate | null;
  today?: IsoDate;
  /** 该学生自己的课表覆盖的周次范围；没有课表时为 null。 */
  weekRange: { startWeek: number; endWeek: number } | null;
}): TeachingWeekState {
  if (input.startsOn === null) return { kind: "no_start_date" };
  const computedWeek = teachingWeekOf(input.startsOn, input.today);
  if (computedWeek === null) return { kind: "no_start_date" };

  if (input.weekRange === null) {
    return { kind: "no_timetable", computedWeek };
  }
  if (computedWeek < 1) {
    return { kind: "before_term", startsOn: input.startsOn, computedWeek };
  }
  if (
    computedWeek < input.weekRange.startWeek ||
    computedWeek > input.weekRange.endWeek
  ) {
    return {
      kind: "outside_range",
      computedWeek,
      startWeek: input.weekRange.startWeek,
      endWeek: input.weekRange.endWeek,
    };
  }
  return {
    kind: "in_week",
    computedWeek,
    week: computedWeek,
    parity: computedWeek % 2 === 1 ? "odd" : "even",
  };
}

/** 「第 3 周（单周）」这样的描述。 */
export function teachingWeekLabel(week: number): string {
  return `第 ${week} 周（${week % 2 === 1 ? "单周" : "双周"}）`;
}
