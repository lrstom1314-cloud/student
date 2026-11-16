import { getDb } from "@/db";
import type { WeekParity } from "@/db/schema";
import {
  isWeekParity,
  MAX_CLASSROOM_LENGTH,
  MAX_PERIOD,
  MAX_WEEK,
  MIN_PERIOD,
  MIN_WEEK,
  periodLabel,
  weekdayLabel,
  weekLabel,
} from "@/lib/timetable-labels";

export type TimetableEntry = {
  id: string;
  teachingClassId: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  startWeek: number;
  endWeek: number;
  weekParity: WeekParity;
  classroom: string;
  /** 教师确认过冲突的时间；null 表示没有确认记录。 */
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConflictReason = "teacher" | "classroom";

export type TimetableConflict = {
  /** 本教学班的课表条目。 */
  entryId: string;
  /** 与之冲突的其它教学班条目。 */
  conflictingEntryId: string;
  reasons: ConflictReason[];
  conflictingTeachingClass: { id: string; displayName: string };
  /** 中文提示，直接展示给教师。 */
  message: string;
};

export type Timetable = {
  entries: TimetableEntry[];
  conflicts: TimetableConflict[];
};

export type TimetableInput = {
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  startWeek: number;
  endWeek: number;
  weekParity: WeekParity;
  classroom: string;
};

export type TimetableInputResult =
  | { ok: true; input: TimetableInput }
  | { ok: false; error: string };

type EntryRow = {
  id: string;
  teaching_class_id: string;
  weekday: number;
  start_period: number;
  end_period: number;
  start_week: number;
  end_week: number;
  week_parity: WeekParity;
  classroom: string;
  conflict_acknowledged_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ConflictRow = {
  entry_id: string;
  conflicting_entry_id: string;
  conflicting_tc_id: string;
  conflicting_tc_display_name: string;
  weekday: number;
  start_period: number;
  end_period: number;
  start_week: number;
  end_week: number;
  week_parity: WeekParity;
  classroom: string;
  same_teacher: boolean;
  same_classroom: boolean;
};

const ENTRY_COLUMNS = `
  id, teaching_class_id, weekday, start_period, end_period,
  start_week, end_week, week_parity, classroom,
  conflict_acknowledged_at, created_at, updated_at
`;

function toEntry(row: EntryRow): TimetableEntry {
  return {
    id: row.id,
    teachingClassId: row.teaching_class_id,
    weekday: row.weekday,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    startWeek: row.start_week,
    endWeek: row.end_week,
    weekParity: row.week_parity,
    classroom: row.classroom,
    acknowledgedAt: row.conflict_acknowledged_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * 冲突判定：只与**同一学期、其它教学班**的条目比较。
 * 星期相同、节次区间相交、周次区间相交、单双周兼容，且同教师或同教室名。
 * 单周 vs 双周永远不落在同一周，因此不冲突；二者与「每周」都冲突。
 */
const CONFLICT_SELECT = `
  select e1.id as entry_id,
    e2.id as conflicting_entry_id,
    tc2.id as conflicting_tc_id,
    tc2.display_name as conflicting_tc_display_name,
    e2.weekday, e2.start_period, e2.end_period,
    e2.start_week, e2.end_week, e2.week_parity, e2.classroom,
    (tc2.teacher_account_id = tc1.teacher_account_id) as same_teacher,
    (lower(btrim(e2.classroom)) = lower(btrim(e1.classroom))) as same_classroom
  from timetable_entries e1
  join teaching_classes tc1 on tc1.id = e1.teaching_class_id
  join teaching_classes tc2
    on tc2.term_id = tc1.term_id and tc2.id <> tc1.id
  join timetable_entries e2 on e2.teaching_class_id = tc2.id
  where e1.teaching_class_id = $1
    and e1.weekday = e2.weekday
    and e1.start_period <= e2.end_period
    and e2.start_period <= e1.end_period
    and e1.start_week <= e2.end_week
    and e2.start_week <= e1.end_week
    and (
      e1.week_parity = 'every'
      or e2.week_parity = 'every'
      or e1.week_parity = e2.week_parity
    )
    and (
      tc2.teacher_account_id = tc1.teacher_account_id
      or lower(btrim(e1.classroom)) = lower(btrim(e2.classroom))
    )
  order by e1.weekday, e1.start_period, e1.id,
    tc2.display_name, e2.start_period, e2.id
`;

function toConflict(row: ConflictRow): TimetableConflict {
  const reasons: ConflictReason[] = [];
  if (row.same_teacher) reasons.push("teacher");
  if (row.same_classroom) reasons.push("classroom");

  const reasonText =
    reasons.length === 2
      ? "同一教师与同一教室"
      : reasons[0] === "teacher"
        ? "同一教师"
        : "同一教室";

  const message =
    `与教学班「${row.conflicting_tc_display_name}」的课表冲突：${reasonText}；` +
    `对方时间：${weekdayLabel(row.weekday)} ${periodLabel(row.start_period, row.end_period)}，` +
    `${weekLabel(row.start_week, row.end_week, row.week_parity)}，` +
    `教室 ${row.classroom}。`;

  return {
    entryId: row.entry_id,
    conflictingEntryId: row.conflicting_entry_id,
    reasons,
    conflictingTeachingClass: {
      id: row.conflicting_tc_id,
      displayName: row.conflicting_tc_display_name,
    },
    message,
  };
}

function integerOf(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/**
 * 课表条目的参数校验。所有错误都是可直接展示的中文。
 * 这层只管格式，写入权限由路由按角色与教学班归属检查。
 */
export function parseTimetableInput(
  body: Record<string, unknown>,
): TimetableInputResult {
  const weekday = integerOf(body.weekday);
  if (weekday === null || weekday < 1 || weekday > 7) {
    return {
      ok: false,
      error: "星期必须是 1（周一）到 7（周日）之间的整数。",
    };
  }

  const startPeriod = integerOf(body.startPeriod);
  const endPeriod = integerOf(body.endPeriod);
  if (startPeriod === null || endPeriod === null) {
    return { ok: false, error: "请输入起始节次与结束节次。" };
  }
  if (
    startPeriod < MIN_PERIOD ||
    endPeriod < MIN_PERIOD ||
    startPeriod > MAX_PERIOD ||
    endPeriod > MAX_PERIOD
  ) {
    return {
      ok: false,
      error: `节次必须在第 ${MIN_PERIOD} 到第 ${MAX_PERIOD} 节之间。`,
    };
  }
  if (endPeriod < startPeriod) {
    return { ok: false, error: "结束节次不能早于起始节次。" };
  }

  const startWeek = integerOf(body.startWeek);
  const endWeek = integerOf(body.endWeek);
  if (startWeek === null || endWeek === null) {
    return { ok: false, error: "请输入起始周与结束周。" };
  }
  if (
    startWeek < MIN_WEEK ||
    endWeek < MIN_WEEK ||
    startWeek > MAX_WEEK ||
    endWeek > MAX_WEEK
  ) {
    return {
      ok: false,
      error: `周次必须在第 ${MIN_WEEK} 到第 ${MAX_WEEK} 周之间。`,
    };
  }
  if (endWeek < startWeek) {
    return { ok: false, error: "结束周不能早于起始周。" };
  }

  if (!isWeekParity(body.weekParity)) {
    return { ok: false, error: "单双周只能是每周、单周或双周。" };
  }

  const classroom =
    typeof body.classroom === "string" ? body.classroom.trim() : "";
  if (classroom.length === 0) {
    return { ok: false, error: "请输入教室名。" };
  }
  if (classroom.length > MAX_CLASSROOM_LENGTH) {
    return { ok: false, error: "教室名不能超过 64 个字符。" };
  }

  return {
    ok: true,
    input: {
      weekday,
      startPeriod,
      endPeriod,
      startWeek,
      endWeek,
      weekParity: body.weekParity,
      classroom,
    },
  };
}

export async function findTimetableEntry(
  teachingClassId: string,
  entryId: string,
): Promise<TimetableEntry | null> {
  const sql = getDb();
  const rows = await sql.unsafe<EntryRow[]>(
    `select ${ENTRY_COLUMNS} from timetable_entries
     where id = $1 and teaching_class_id = $2 limit 1`,
    [entryId, teachingClassId],
  );
  const row = rows[0];
  return row ? toEntry(row) : null;
}

/** 教学班的课表与当前所有冲突警告。删除条目后警告自然消失。 */
export async function getTimetable(
  teachingClassId: string,
): Promise<Timetable> {
  const sql = getDb();
  const [entries, conflictRows] = await Promise.all([
    sql.unsafe<EntryRow[]>(
      `select ${ENTRY_COLUMNS} from timetable_entries
       where teaching_class_id = $1
       order by weekday, start_period, end_period, id`,
      [teachingClassId],
    ),
    sql.unsafe<ConflictRow[]>(CONFLICT_SELECT, [teachingClassId]),
  ]);

  return {
    entries: entries.map(toEntry),
    conflicts: conflictRows.map(toConflict),
  };
}

export async function entryConflicts(
  teachingClassId: string,
  entryId: string,
): Promise<TimetableConflict[]> {
  const timetable = await getTimetable(teachingClassId);
  return timetable.conflicts.filter((conflict) => conflict.entryId === entryId);
}

export type SaveEntryResult =
  | { ok: true; entry: TimetableEntry; conflicts: TimetableConflict[] }
  | { ok: false; status: number; error: string };

/**
 * 保存条目的公共收尾：写入后立刻重算冲突。
 * 请求显式确认且有冲突时，记录「已确认冲突」的时间；否则清空确认痕迹。
 */
async function finalizeEntry(input: {
  teachingClassId: string;
  entryId: string;
  acknowledgeConflicts: boolean;
}): Promise<SaveEntryResult> {
  const conflicts = await entryConflicts(
    input.teachingClassId,
    input.entryId,
  );

  const sql = getDb();
  if (input.acknowledgeConflicts && conflicts.length > 0) {
    await sql`
      update timetable_entries
      set conflict_acknowledged_at = now()
      where id = ${input.entryId}
    `;
  } else if (!input.acknowledgeConflicts) {
    await sql`
      update timetable_entries
      set conflict_acknowledged_at = null
      where id = ${input.entryId}
    `;
  }

  const entry = await findTimetableEntry(
    input.teachingClassId,
    input.entryId,
  );
  if (!entry) {
    return { ok: false, status: 404, error: "课表条目不存在。" };
  }
  return { ok: true, entry, conflicts };
}

export async function createTimetableEntry(input: {
  teachingClassId: string;
  values: TimetableInput;
  acknowledgeConflicts: boolean;
}): Promise<SaveEntryResult> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    insert into timetable_entries (
      teaching_class_id, weekday, start_period, end_period,
      start_week, end_week, week_parity, classroom
    )
    values (
      ${input.teachingClassId}, ${input.values.weekday},
      ${input.values.startPeriod}, ${input.values.endPeriod},
      ${input.values.startWeek}, ${input.values.endWeek},
      ${input.values.weekParity}, ${input.values.classroom}
    )
    returning id
  `;

  return finalizeEntry({
    teachingClassId: input.teachingClassId,
    entryId: rows[0]!.id,
    acknowledgeConflicts: input.acknowledgeConflicts,
  });
}

export async function updateTimetableEntry(input: {
  teachingClassId: string;
  entryId: string;
  values: TimetableInput;
  acknowledgeConflicts: boolean;
}): Promise<SaveEntryResult> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    update timetable_entries
    set weekday = ${input.values.weekday},
      start_period = ${input.values.startPeriod},
      end_period = ${input.values.endPeriod},
      start_week = ${input.values.startWeek},
      end_week = ${input.values.endWeek},
      week_parity = ${input.values.weekParity},
      classroom = ${input.values.classroom},
      conflict_acknowledged_at = null,
      updated_at = now()
    where id = ${input.entryId}
      and teaching_class_id = ${input.teachingClassId}
    returning id
  `;
  if (rows.length === 0) {
    return { ok: false, status: 404, error: "课表条目不存在。" };
  }

  return finalizeEntry({
    teachingClassId: input.teachingClassId,
    entryId: input.entryId,
    acknowledgeConflicts: input.acknowledgeConflicts,
  });
}

export async function deleteTimetableEntry(
  teachingClassId: string,
  entryId: string,
): Promise<boolean> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    delete from timetable_entries
    where id = ${entryId} and teaching_class_id = ${teachingClassId}
    returning id
  `;
  return rows.length > 0;
}
