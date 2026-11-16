import { CurrentTermScope } from "@/components/current-term-scope";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { listStudentPublishedGrades } from "@/lib/student-grades";
import { getCurrentTerm } from "@/lib/terms";

export const dynamic = "force-dynamic";

export default async function StudentPage() {
  const user = await requirePageUser("/student", { roles: ["student"] });
  const currentTerm = await getCurrentTerm();
  const courses = currentTerm
    ? await listStudentPublishedGrades(user.id, currentTerm.id)
    : [];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>学生首页</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
        </div>
        <LogoutButton />
      </header>
      <CurrentTermScope />

      <section>
        <h2>我的成绩</h2>
        {currentTerm === null ? (
          <p>尚未设置当前学期，暂时没有成绩。</p>
        ) : courses.length === 0 ? (
          <p>本学期还没有加入任何教学班。</p>
        ) : (
          courses.map((course) => (
            <article key={course.teachingClass.id} className="year-group">
              <h3>
                {course.teachingClass.courseName}
                {course.teachingClass.displayName !==
                course.teachingClass.courseName
                  ? ` · ${course.teachingClass.displayName}`
                  : ""}
              </h3>
              <p className="hint">
                {course.teachingClass.termLabel} ·{" "}
                {course.teachingClass.teacherName}
              </p>
              {course.published ? (
                <>
                  <p>
                    总评：
                    {course.overall.status === "incomplete" ? (
                      <span className="badge">未完成</span>
                    ) : (
                      <strong>{course.overall.finalScore ?? "—"}</strong>
                    )}
                  </p>
                  <details>
                    <summary>成绩明细</summary>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>成绩项</th>
                          <th>满分</th>
                          <th>权重</th>
                          <th>得分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {course.items.map((item) => (
                          <tr key={item.gradeItemId}>
                            <td>{item.name}</td>
                            <td>{item.maxScore}</td>
                            <td>{item.weight}%</td>
                            <td>{item.score === null ? "缺考" : item.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              ) : (
                <p>暂无成绩</p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
