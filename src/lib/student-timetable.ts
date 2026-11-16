import { getDb } from "@/db";
import type { WeekParity } from "@/db/schema";
import {
  scheduledInWeek,
  teachingWeekOf,
} from "@/lib/teaching-week";
import { getCurrentTerm, type TermSummary } from "@/lib/terms";

export type StudentTimetableEntry = {
  id: string;
  teachingClassId: string;
  teachingClassDisplayName: string;
  courseName: string;
  teacherDisplayName: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  startWeek: number;
  endWeek: number;
  weekParity: WeekParity;
  classroom: string;
  /**
   * 本周是否要上：true / false；null 表示无法判断
   * （学期未设置开学日期，或当前不在教学周内）。
   */
  scheduledThisWeek: boolean | null;
};

export type StudentTimetable = {
  /** 全局唯一的当前学期；未设置时为 null。 */
  currentTerm: TermSummary | null;
  /** 首屏固定的学期范围，永远等于 currentTerm。 */
  term: TermSummary | null;
  student: { id: string; studentNumber: string; name: string } | null;
  /** 教学第 1 周起始日期（YYYY-MM-DD）。 */
  startsOn: string | null;
  /** 按开学日期算出的教学周，可能为 0 或负数（尚未开学）。 */
  computedWeek: number | null;
  /** 仅当 computedWeek 落在本学期课表周次范围内时才非空。 */
  teachingWeek: number | null;
  inTeachingWeek: boolean;
  /** 本学期全部课表条目的周次范围；没有排课时为 null。 */
  weekRange: { startWeek: number; endWeek: number } | null;
  entries: StudentTimetableEntry[];
};

type StudentRow = {
  id: string;
  student_number: string;
  name: string;
};

type EntryRow = {
  id: string;
  teaching_class_id: string;
  teaching_class_display_name: string;
  course_name: string;
  teacher_display_name: string;
  weekday: number;
  start_period: number;
  end_period: number;
  start_week: number;
  end_week: number;
  week_parity: WeekParity;
  classroom: string;
};

type WeekRangeRow = {
  start_week: number | null;
  end_week: number | null;
};

function emptyTimetable(currentTerm: TermSummary | null): StudentTimetable {
  return {
    currentTerm,
    term: currentTerm,
    student: null,
    startsOn: currentTerm?.startsOn ?? null,
    computedWeek: null,
    teachingWeek: null,
    inTeachingWeek: false,
    weekRange: null,
    entries: [],
  };
}

/**
 * 学生首屏课表：只取当前学期、只取自己所在教学班的课表条目。
 *
 * 排序按星期 → 起始节次 → 结束节次，同一时段的多条记录全部保留，
 * 由展示层堆叠；不做合并，避免单双周课程互相遮蔽。
 */
export async function getStudentTimetable(
  accountId: string,
): Promise<StudentTimetable> {
  const currentTerm = await getCurrentTerm();
  if (!currentTerm) return emptyTimetable(null);

  const sql = getDb();
  const students = await sql<StudentRow[]>`
    select id, student_number, name
    from students
    where account_id = ${accountId}
    limit 1
  `;
  const studentRow = students[0];
  if (!studentRow) return emptyTimetable(currentTerm);

  const [entryRows, rangeRows] = await Promise.all([
    sql<EntryRow[]>`
      select e.id, tc.id as teaching_class_id,
        tc.display_name as teaching_class_display_name,
        c.name as course_name,
        a.display_name as teacher_display_name,
        e.weekday, e.start_period, e.end_period,
        e.start_week, e.end_week, e.week_parity, e.classroom
      from timetable_entries e
      join teaching_classes tc on tc.id = e.teaching_class_id
      join courses c on c.id = tc.course_id
      join accounts a on a.id = tc.teacher_account_id
      join teaching_class_students roster
        on roster.teaching_class_id = tc.id
        and roster.student_id = ${studentRow.id}
      where tc.term_id = ${currentTerm.id}
      order by e.weekday, e.start_period, e.end_period,
        tc.display_name, e.classroom, e.id
    `,
    sql<WeekRangeRow[]>`
      select min(e.start_week)::int as start_week,
        max(e.end_week)::int as end_week
      from timetable_entries e
      join teaching_classes tc on tc.id = e.teaching_class_id
      where tc.term_id = ${currentTerm.id}
    `,
  ]);

  const rangeRow = rangeRows[0];
  const weekRange =
    rangeRow?.start_week !== null &&
    rangeRow?.start_week !== undefined &&
    rangeRow.end_week !== null
      ? { startWeek: rangeRow.start_week, endWeek: rangeRow.end_week }
      : null;

  const computedWeek = currentTerm.startsOn
    ? teachingWeekOf(currentTerm.startsOn)
    : null;

  const inTeachingWeek =
    computedWeek !== null &&
    weekRange !== null &&
    computedWeek >= weekRange.startWeek &&
    computedWeek <= weekRange.endWeek;

  const teachingWeek = inTeachingWeek ? computedWeek : null;

  return {
    currentTerm,
    term: currentTerm,
    student: {
      id: studentRow.id,
      studentNumber: studentRow.student_number,
      name: studentRow.name,
    },
    startsOn: currentTerm.startsOn,
    computedWeek,
    teachingWeek,
    inTeachingWeek,
    weekRange,
    entries: entryRows.map((row) => ({
      id: row.id,
      teachingClassId: row.teaching_class_id,
      teachingClassDisplayName: row.teaching_class_display_name,
      courseName: row.course_name,
      teacherDisplayName: row.teacher_display_name,
      weekday: row.weekday,
      startPeriod: row.start_period,
      endPeriod: row.end_period,
      startWeek: row.start_week,
      endWeek: row.end_week,
      weekParity: row.week_parity,
      classroom: row.classroom,
      scheduledThisWeek: scheduledInWeek(
        {
          startWeek: row.start_week,
          endWeek: row.end_week,
          weekParity: row.week_parity,
        },
        teachingWeek,
      ),
    })),
  };
}
