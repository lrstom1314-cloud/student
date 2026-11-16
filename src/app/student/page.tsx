import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { getStudentTimetable } from "@/lib/student-timetable";
import {
  periodLabel,
  WEEKDAY_LABELS,
  weekLabel,
} from "@/lib/timetable-labels";
import { teachingWeekLabel } from "@/lib/teaching-week";

export const dynamic = "force-dynamic";

function WeekScope({
  startsOn,
  inTeachingWeek,
  teachingWeek,
  computedWeek,
  weekRange,
}: {
  startsOn: string | null;
  inTeachingWeek: boolean;
  teachingWeek: number | null;
  computedWeek: number | null;
  weekRange: { startWeek: number; endWeek: number } | null;
}) {
  if (startsOn === null) {
    return (
      <p className="hint" role="status">
        本学期尚未设置开学日期，暂时无法标出本周是否需要上课；课表本身仍可正常查看。
      </p>
    );
  }

  if (inTeachingWeek && teachingWeek !== null) {
    return (
      <p className="notice" role="status">
        {`本周是${teachingWeekLabel(teachingWeek)}，下面标出每门课本周是否要上。`}
      </p>
    );
  }

  const rangeText = weekRange
    ? `本学期课表为第 ${weekRange.startWeek}-${weekRange.endWeek} 周`
    : "本学期尚未排课";

  if (computedWeek !== null && computedWeek < 1) {
    return (
      <p className="notice" role="status">
        {`本学期尚未开学（开学日期 ${startsOn}），不在教学周内，本周无需按课表上课。`}
      </p>
    );
  }

  const weekText =
    computedWeek === null ? "当前" : `当前是第 ${computedWeek} 周`;

  return (
    <p className="notice" role="status">
      {`${weekText}，${rangeText}，不在教学周内，本周无需按课表上课。`}
    </p>
  );
}

export default async function StudentPage() {
  const user = await requirePageUser("/student", { roles: ["student"] });
  const timetable = await getStudentTimetable(user.id);
  const { currentTerm, entries } = timetable;

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>我的课表</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p className="hint">
            这里只显示你自己的教学班。成绩查询将在后续功能中加入。
          </p>
        </div>
        <LogoutButton />
      </header>

      {currentTerm ? (
        <p className="notice">{`当前学期：${currentTerm.label}`}</p>
      ) : (
        <p className="notice" role="status">
          尚未设置当前学期，暂时无法确定课表与成绩的范围。请联系教务管理员在「学年与学期」中设置当前学期。
        </p>
      )}

      {currentTerm ? (
        <section>
          <h2>本周</h2>
          {timetable.weekRange === null ? null : (
            <WeekScope
              startsOn={timetable.startsOn}
              inTeachingWeek={timetable.inTeachingWeek}
              teachingWeek={timetable.teachingWeek}
              computedWeek={timetable.computedWeek}
              weekRange={timetable.weekRange}
            />
          )}

          {timetable.weekRange === null ? (
            <p className="notice" role="status">
              当前学期尚未排课。教务管理员或任课教师排好课表后，这里会自动显示你的一周安排。
            </p>
          ) : entries.length === 0 ? (
            <p className="notice" role="status">
              当前学期还没有你的课。如果你刚转入新的行政班，请联系教务管理员确认教学班名单。
            </p>
          ) : (
            <div className="timetable-week">
              {WEEKDAY_LABELS.map((label, index) => {
                const weekday = index + 1;
                const dayEntries = entries.filter(
                  (entry) => entry.weekday === weekday,
                );
                return (
                  <section
                    key={label}
                    className="timetable-day"
                    aria-label={label}
                  >
                    <h3 className="timetable-day-title">{label}</h3>
                    {dayEntries.length === 0 ? (
                      <p className="timetable-empty">无课</p>
                    ) : (
                      dayEntries.map((entry) => (
                        <article
                          key={entry.id}
                          className="timetable-entry"
                        >
                          <p className="timetable-entry-time">
                            {periodLabel(entry.startPeriod, entry.endPeriod)}
                          </p>
                          <p className="timetable-entry-title">
                            {entry.teachingClassDisplayName}
                          </p>
                          <p className="timetable-entry-meta">
                            {`${entry.courseName} · ${entry.teacherDisplayName}`}
                          </p>
                          <p className="timetable-entry-meta">
                            {entry.classroom}
                          </p>
                          <p className="timetable-entry-meta">
                            {weekLabel(
                              entry.startWeek,
                              entry.endWeek,
                              entry.weekParity,
                            )}
                          </p>
                          {entry.scheduledThisWeek === true ? (
                            <span className="badge">本周要上</span>
                          ) : entry.scheduledThisWeek === false ? (
                            <span className="badge badge-muted">本周不上</span>
                          ) : null}
                        </article>
                      ))
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
