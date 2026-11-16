import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { PrintButton } from "@/components/print-button";
import { requirePageUser } from "@/lib/auth";
import { getStudentGradeReport } from "@/lib/student-grades";

export const dynamic = "force-dynamic";

/**
 * 学生成绩单：普通 HTML 页面，用 CSS 打印规则得到分页与页眉，
 * 不引入 PDF 模板引擎，也不生成服务端文件。
 *
 * 数据仍来自 getStudentGradeReport 的已发布快照，因此与「我的成绩」一致：
 * 教师解锁期间的草稿修改不会出现在打印结果里。
 */
export default async function StudentTranscriptPage() {
  const user = await requirePageUser("/student/transcript", {
    roles: ["student"],
  });
  const report = await getStudentGradeReport(user.id);

  return (
    <main className="page transcript">
      <div className="no-print transcript-toolbar">
        <Link href="/student">返回我的课表与成绩</Link>
        <PrintButton />
        <LogoutButton />
      </div>

      <header className="transcript-header">
        <h1>学生成绩单</h1>
        {report.student ? (
          <p className="transcript-identity">
            {report.student.name} · 学号 {report.student.studentNumber}
          </p>
        ) : (
          <p className="notice" role="status">
            当前账号没有关联的学籍信息，暂时无法生成成绩单。请联系教务管理员核对账号。
          </p>
        )}
        {report.term ? (
          <p>{report.term.label}</p>
        ) : (
          <p className="notice" role="status">
            尚未设置当前学期，暂时无法确定成绩单的范围。请联系教务管理员在「学年与学期」中设置当前学期。
          </p>
        )}
        <p className="hint no-print">
          打印时请使用浏览器的「打印」功能，可另存为 PDF。导航、按钮与这段提示都不会出现在打印结果中。
        </p>
      </header>

      {/* 打印专用页眉：固定在每页顶部，屏幕阅读器与屏幕显示都忽略它。 */}
      <div className="transcript-print-header" aria-hidden="true">
        {`学生成绩单 · ${report.student?.name ?? user.displayName}（学号 ${
          report.student?.studentNumber ?? user.loginName
        }）${report.term ? ` · ${report.term.label}` : ""}`}
      </div>

      {report.term === null ? null : report.courses.length === 0 ? (
        <p className="notice" role="status">
          本学期你还没有加入任何教学班，因此成绩单暂无可列出的课程。请联系教务管理员确认教学班名单。
        </p>
      ) : (
        report.courses.map((course) => (
          <section
            className="transcript-course"
            key={course.teachingClass.id}
          >
            <h2>{course.teachingClass.courseName}</h2>
            <p className="hint">
              {course.teachingClass.displayName} ·{" "}
              {course.teachingClass.teacherName} ·{" "}
              {course.teachingClass.termLabel}
            </p>

            {course.published ? (
              <>
                <table className="transcript-items">
                  <thead>
                    <tr>
                      <th>成绩项</th>
                      <th>满分</th>
                      <th>得分</th>
                      <th>权重</th>
                    </tr>
                  </thead>
                  <tbody>
                    {course.items.map((item) => (
                      <tr key={item.gradeItemId}>
                        <td>{item.name}</td>
                        <td>{item.maxScore}</td>
                        <td>
                          {item.score === null ? (
                            <span className="grade-missing">未录入</span>
                          ) : (
                            item.score
                          )}
                        </td>
                        <td>{item.weight}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="transcript-overall">
                  <span className="grade-overall-label">总评</span>{" "}
                  {course.overall.finalScore === null ? (
                    <strong className="grade-missing">未录入</strong>
                  ) : (
                    <strong>{course.overall.finalScore}</strong>
                  )}
                  {course.overall.finalSource === "override" ? (
                    <span className="badge">教师调整</span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="notice grade-pending" role="status">
                暂无成绩：任课教师尚未发布本次成绩，发布后成绩单会自动更新。
              </p>
            )}
          </section>
        ))
      )}
    </main>
  );
}
