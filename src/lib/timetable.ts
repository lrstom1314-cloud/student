import type { Sql, TransactionSql } from "postgres";

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

export type ConflictReason = "teacher" | "classroom" | "same_teaching_class";

export type TimetableConflict = {
  /** 本教学班的课表条目。 */
  entryId: string;
  /** 与之冲突的条目；同一教学班内部的重叠会指向班内的另一条记录。 */
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
  entry_id: string | null;
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
  same_teaching_class: boolean;
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
 * 冲突判定：与同一学期内会落在同一时间的其它条目比较。
 *
 * - 星期相同、节次区间相交、周次区间相交（只相接不算）、单双周兼容；
 * - 命中「同一教师」「同一教室名」任意一条即冲突；
 * - 同一教学班内部的重叠一律算冲突：同一时间排两门课必然是录入错误。
 *
 * 单周 vs 双周永远不落在同一周，因此不冲突；二者与「每周」都冲突。
 * $1 教学班，$2 要排除的条目（修改时排除自身，新增时为 null），
 * $3..$9 候选条目的星期、起止节次、起止周、单双周、教室名；
 * $10 被检查的条目 id（列表展示用，新增时为 null）。
 */
const CONFLICT_SELECT = `
  select $10::uuid as entry_id,
    e2.id as conflicting_entry_id,
    tc2.id as conflicting_tc_id,
    tc2.display_name as conflicting_tc_display_name,
    e2.weekday, e2.start_period, e2.end_period,
    e2.start_week, e2.end_week, e2.week_parity, e2.classroom,
    (tc2.id = tc1.id) as same_teaching_class,
    (tc2.teacher_account_id = tc1.teacher_account_id) as same_teacher,
    (lower(btrim(e2.classroom)) = lower(btrim($9::text))) as same_classroom
  from teaching_classes tc1
  join timetable_entries e2 on true
  join teaching_classes tc2 on tc2.id = e2.teaching_class_id
  where tc1.id = $1
    and tc2.term_id = tc1.term_id
    and ($2::uuid is null or e2.id <> $2::uuid)
    and e2.weekday = $3
    and $4 <= e2.end_period and e2.start_period <= $5
    and $6 <= e2.end_week and e2.start_week <= $7
    and (
      $8::text = 'every'
      or e2.week_parity::text = 'every'
      or e2.week_parity::text = $8::text
    )
    and (
      tc2.teacher_account_id = tc1.teacher_account_id
      or lower(btrim(e2.classroom)) = lower(btrim($9::text))
    )
  order by e2.weekday, e2.start_period, e2.end_period, e2.id
`;

function toConflict(row: ConflictRow): TimetableConflict {
  if (row.same_teaching_class) {
    return {
      entryId: row.entry_id!,
      conflictingEntryId: row.conflicting_entry_id,
      reasons: ["same_teaching_class"],
      conflictingTeachingClass: {
        id: row.conflicting_tc_id,
        displayName: row.conflicting_tc_display_name,
      },
      message:
        `与本教学班「${row.conflicting_tc_display_name}」的另一条课表冲突：` +
        `同一教学班在同一时间排了两条课表；` +
        `对方时间：${weekdayLabel(row.weekday)} ${periodLabel(row.start_period, row.end_period)}，` +
        `${weekLabel(row.start_week, row.end_week, row.week_parity)}，` +
        `教室 ${row.classroom}。`,
    };
  }

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
    entryId: row.entry_id!,
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

function inputOfRow(row: EntryRow): TimetableInput {
  return {
    weekday: row.weekday,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    startWeek: row.start_week,
    endWeek: row.end_week,
    weekParity: row.week_parity,
    classroom: row.classroom,
  };
}

/**
 * 用候选条目的值查冲突，不写库。新增时 entryId 为 null，
 * 修改时排除自身，避免自己与自己冲突。
 */
async function queryConflicts(
  client: Sql | TransactionSql,
  input: {
    teachingClassId: string;
    values: TimetableInput;
    /** 新增时为 null；修改时排除自身。 */
    entryId: string | null;
  },
): Promise<TimetableConflict[]> {
  const rows = await client.unsafe<ConflictRow[]>(CONFLICT_SELECT, [
    input.teachingClassId,
    input.entryId,
    input.values.weekday,
    input.values.startPeriod,
    input.values.endPeriod,
    input.values.startWeek,
    input.values.endWeek,
    input.values.weekParity,
    input.values.classroom,
    input.entryId,
  ]);
  return rows.map(toConflict);
}

/** 教学班的课表与当前所有冲突警告。删除条目后警告自然消失。 */
export async function getTimetable(
  teachingClassId: string,
): Promise<Timetable> {
  const sql = getDb();
  const entries = await sql.unsafe<EntryRow[]>(
    `select ${ENTRY_COLUMNS} from timetable_entries
     where teaching_class_id = $1
     order by weekday, start_period, end_period, id`,
    [teachingClassId],
  );

  const conflictsByEntry = await Promise.all(
    entries.map((row) =>
      queryConflicts(sql, {
        teachingClassId,
        values: inputOfRow(row),
        entryId: row.id,
      }),
    ),
  );

  return {
    entries: entries.map(toEntry),
    conflicts: conflictsByEntry.flat(),
  };
}

export type SaveEntryResult =
  | { ok: true; entry: TimetableEntry; conflicts: TimetableConflict[] }
  | {
      ok: false;
      status: number;
      error: string;
      /** 409 时带上冲突详情，前端据此展示「确认冲突 → 再保存」。 */
      conflicts?: TimetableConflict[];
    };

function conflictRejection(conflicts: TimetableConflict[]): SaveEntryResult {
  return {
    ok: false,
    status: 409,
    error: `发现 ${conflicts.length} 处课表时间冲突，尚未保存。请核对冲突后确认保存。`,
    conflicts,
  };
}

/**
 * 添加课表条目：先判定冲突，再决定是否落库。
 * 存在冲突且请求未显式确认时返回 409，数据库不留下任何行；
 * 带上 acknowledgeConflicts: true 才写入，并把「已确认冲突」的时间记在条目上。
 */
export async function createTimetableEntry(input: {
  teachingClassId: string;
  values: TimetableInput;
  acknowledgeConflicts: boolean;
}): Promise<SaveEntryResult> {
  const sql = getDb();
  return sql.begin<SaveEntryResult>(async (tx) => {
    const conflicts = await queryConflicts(tx, {
      teachingClassId: input.teachingClassId,
      values: input.values,
      entryId: null,
    });
    if (conflicts.length > 0 && !input.acknowledgeConflicts) {
      return conflictRejection(conflicts);
    }

    const rows = await tx<EntryRow[]>`
      insert into timetable_entries (
        teaching_class_id, weekday, start_period, end_period,
        start_week, end_week, week_parity, classroom,
        conflict_acknowledged_at
      )
      values (
        ${input.teachingClassId}, ${input.values.weekday},
        ${input.values.startPeriod}, ${input.values.endPeriod},
        ${input.values.startWeek}, ${input.values.endWeek},
        ${input.values.weekParity}, ${input.values.classroom},
        ${conflicts.length > 0 ? new Date() : null}
      )
      returning *
    `;
    return {
      ok: true,
      entry: toEntry(rows[0]!),
      conflicts,
    };
  });
}

/**
 * 修改课表条目：整条替换。与新增同样「先判定、后落库」：
 * 未确认的冲突修改返回 409，原条目保持不动。
 */
export async function updateTimetableEntry(input: {
  teachingClassId: string;
  entryId: string;
  values: TimetableInput;
  acknowledgeConflicts: boolean;
}): Promise<SaveEntryResult> {
  const sql = getDb();
  return sql.begin<SaveEntryResult>(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      select id from timetable_entries
      where id = ${input.entryId}
        and teaching_class_id = ${input.teachingClassId}
      for update
    `;
    if (existing.length === 0) {
      return { ok: false, status: 404, error: "课表条目不存在。" };
    }

    const conflicts = await queryConflicts(tx, {
      teachingClassId: input.teachingClassId,
      values: input.values,
      entryId: input.entryId,
    });
    if (conflicts.length > 0 && !input.acknowledgeConflicts) {
      return conflictRejection(conflicts);
    }

    const rows = await tx<EntryRow[]>`
      update timetable_entries
      set weekday = ${input.values.weekday},
        start_period = ${input.values.startPeriod},
        end_period = ${input.values.endPeriod},
        start_week = ${input.values.startWeek},
        end_week = ${input.values.endWeek},
        week_parity = ${input.values.weekParity},
        classroom = ${input.values.classroom},
        conflict_acknowledged_at = ${conflicts.length > 0 ? new Date() : null},
        updated_at = now()
      where id = ${input.entryId}
        and teaching_class_id = ${input.teachingClassId}
      returning *
    `;
    return {
      ok: true,
      entry: toEntry(rows[0]!),
      conflicts,
    };
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
