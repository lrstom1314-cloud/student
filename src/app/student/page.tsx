import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import {
  getStudentGradeReport,
  resolveStudentGradeTerm,
  type StudentGradeCourse,
} from "@/lib/student-grades";
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

function GradeCourseCard({ course }: { course: StudentGradeCourse }) {
  const title =
    course.teachingClass.displayName !== course.teachingClass.courseName
      ? `${course.teachingClass.courseName} · ${course.teachingClass.displayName}`
      : course.teachingClass.courseName;

  return (
    <article className="grade-course">
      <h3>{title}</h3>
      <p className="hint">
        {course.teachingClass.termLabel} · {course.teachingClass.teacherName}
      </p>

      {course.published ? (
        <>
          <div className="grade-overall">
            <span className="grade-overall-label">总评</span>
            {course.overall.finalScore === null ? (
              <span className="badge badge-muted">总评未完成</span>
            ) : (
              <span className="grade-score">
                <strong>{course.overall.finalScore}</strong>
              </span>
            )}
            {course.overall.finalSource === "override" ? (
              <span className="badge">教师调整</span>
            ) : null}
          </div>

          <details className="grade-details">
            <summary>成绩明细</summary>
            {course.overall.status === "incomplete" ? (
              <p className="hint" role="status">
                {
                  "本次发布中有些成绩项尚未录入；未录入按空白处理，不计 0 分，总评暂不计算。"
                }
              </p>
            ) : null}
            <ul className="grade-items">
              <li className="grade-item grade-item-head" aria-hidden="true">
                <span className="grade-item-name">成绩项</span>
                <span data-label="满分">满分</span>
                <span data-label="得分">得分</span>
                <span data-label="权重">权重</span>
              </li>
              {course.items.map((item) => (
                <li className="grade-item" key={item.gradeItemId}>
                  <span className="grade-item-name">{item.name}</span>
                  <span data-label="满分">{item.maxScore}</span>
                  <span data-label="得分">
                    {item.score === null ? (
                      <span className="grade-missing">未录入</span>
                    ) : (
                      item.score
                    )}
                  </span>
                  <span data-label="权重">{item.weight}%</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <div className="notice grade-pending" role="status">
          <p>暂无成绩</p>
          <p className="hint">
            任课教师尚未发布本次成绩；发布后这里会显示你的总评和成绩项明细。
          </p>
        </div>
      )}
    </article>
  );
}

export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string | string[] }>;
}) {
  const user = await requirePageUser("/student", { roles: ["student"] });
  const timetable = await getStudentTimetable(user.id);
  const { currentTerm, entries } = timetable;

  const query = await searchParams;
  const requestedTermId =
    typeof query.term === "string" && query.term.length > 0
      ? query.term
      : null;
  const resolution = await resolveStudentGradeTerm(requestedTermId);
  const report = await getStudentGradeReport(
    user.id,
    resolution.ok ? resolution.term : undefined,
  );
  const courses = report.courses;
  const viewingHistory =
    report.term !== null &&
    report.currentTerm !== null &&
    report.term.id !== report.currentTerm.id;

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>我的课表与成绩</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p className="hint">
            这里只显示你自己的教学班与已发布的成绩，看不到其他同学的数据。
          </p>
          <p>
            <Link href="/student/transcript">成绩单（可打印）</Link>
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
                        <article key={entry.id} className="timetable-entry">
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

      {requestedTermId !== null && !resolution.ok ? (
        <p className="notice" role="status">
          {`${resolution.error}已改为显示当前学期。`}
        </p>
      ) : null}

      {report.term ? (
        <section>
          <h2>我的成绩</h2>

          {report.terms.length > 1 ? (
            <nav className="term-switch" aria-label="成绩学期">
              <span className="hint">查看学期：</span>
              {report.terms.map((term) =>
                term.id === report.term?.id ? (
                  <strong key={term.id} aria-current="true">
                    {term.label}
                  </strong>
                ) : (
                  <Link key={term.id} href={`/student?term=${term.id}`}>
                    {term.label}
                  </Link>
                ),
              )}
            </nav>
          ) : null}

          {viewingHistory ? (
            <p className="notice" role="status">
              正在查看历史学期（只读）。学期切换只影响成绩；课表始终显示当前学期。
            </p>
          ) : null}

          {courses.length === 0 ? (
            <p className="notice" role="status">
              {`${report.term.label}你还没有加入任何教学班，因此没有成绩可查。请联系教务管理员确认教学班名单。`}
            </p>
          ) : (
            <div className="grade-courses">
              {courses.map((course) => (
                <GradeCourseCard
                  key={course.teachingClass.id}
                  course={course}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
