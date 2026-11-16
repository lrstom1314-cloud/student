import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { listAdministrativeClasses } from "@/lib/administrative-classes";
import { listTeacherAccounts } from "@/lib/accounts";
import { requirePageUser } from "@/lib/auth";
import { listCourses, type CourseSummary } from "@/lib/courses";
import { isUuid } from "@/lib/http";
import {
  listTeachingClassesByTerm,
  resolveTermScope,
  type TermScope,
} from "@/lib/teaching-classes";
import { listTermsOverview } from "@/lib/terms";

import { CreateTeachingClassForm } from "./teaching-class-forms";

export const dynamic = "force-dynamic";

function courseLabel(course: CourseSummary): string {
  const measure =
    course.credits !== null
      ? `${course.credits} 学分`
      : course.hours !== null
        ? `${course.hours} 课时`
        : "";
  return measure ? `${course.name}（${measure}）` : course.name;
}

export default async function AdminTeachingClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string }>;
}) {
  const user = await requirePageUser("/admin/teaching-classes", {
    roles: ["administrator"],
  });

  const params = await searchParams;
  const requestedTermId =
    typeof params.termId === "string" && isUuid(params.termId)
      ? params.termId
      : null;

  const [overview, courses, teachers, administrativeClasses] =
    await Promise.all([
      listTermsOverview(),
      listCourses(),
      listTeacherAccounts(),
      listAdministrativeClasses(),
    ]);

  const resolved = await resolveTermScope(requestedTermId);
  const scope: TermScope = resolved.ok
    ? resolved.scope
    : { currentTerm: overview.currentTerm, term: null };
  const scopeError = resolved.ok ? null : resolved.error;

  const teachingClasses = scope.term
    ? await listTeachingClassesByTerm(scope.term.id)
    : [];

  const terms = overview.academicYears.flatMap((year) => year.terms);

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>教学班管理</h1>
          <p>
            {`当前学期：${
              overview.currentTerm ? overview.currentTerm.label : "尚未设置"
            }`}
          </p>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p>
            <Link href="/admin">返回账号管理</Link>
            {" · "}
            <Link href="/admin/courses">课程管理</Link>
            {" · "}
            <Link href="/admin/students">学籍管理</Link>
          </p>
        </div>
        <div className="header-actions">
          <a href="/admin/courses">课程</a>
          <LogoutButton />
        </div>
      </header>

      {overview.currentTerm === null ? (
        <p className="notice" role="status">
          尚未设置当前学期，默认列表暂时为空。请联系教务管理员在「学年与学期」中设置当前学期，或先在上方选择要查看的学期。
        </p>
      ) : null}

      {scopeError ? (
        <p className="notice" role="status">
          {scopeError}
        </p>
      ) : null}

      <section>
        <h2>按学期查看</h2>
        <form className="form form-inline" method="get">
          <label className="form-field">
            <span>学期</span>
            <select name="termId" defaultValue={scope.term?.id ?? ""}>
              <option value="">按当前学期</option>
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            查看
          </button>
        </form>
      </section>

      <section>
        <h2>开设教学班</h2>
        <p className="hint">
          教学班归属「学期 + 课程 + 一位任课教师」，同一学期同一课程可以开多个教学班。
          选择一个行政班可把该班当前在读学生整班加入；名单是组建时的快照。
        </p>
        {terms.length === 0 ? (
          <p>还没有学期，请先在「学年与学期」中创建学期。</p>
        ) : courses.length === 0 ? (
          <p>还没有课程，请先在「课程管理」中创建课程。</p>
        ) : teachers.length === 0 ? (
          <p>还没有教师账号，请先在「账号管理」中创建教师账号。</p>
        ) : (
          <CreateTeachingClassForm
            terms={terms.map((term) => ({ id: term.id, label: term.label }))}
            courses={courses.map((course) => ({
              id: course.id,
              label: courseLabel(course),
            }))}
            teachers={teachers.map((teacher) => ({
              id: teacher.id,
              label: `${teacher.displayName}（${teacher.loginName}）`,
            }))}
            administrativeClasses={administrativeClasses.map(
              (administrativeClass) => ({
                id: administrativeClass.id,
                label: administrativeClass.name,
              }),
            )}
            defaultTermId={scope.term?.id ?? ""}
          />
        )}
      </section>

      <section>
        <h2>
          教学班
          {scope.term ? `：${scope.term.label}` : "（未选择学期）"}
        </h2>
        {teachingClasses.length === 0 ? (
          <p>该学期还没有教学班。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>教学班</th>
                <th>课程</th>
                <th>任课教师</th>
                <th>学生人数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {teachingClasses.map((teachingClass) => (
                <tr key={teachingClass.id}>
                  <td>{teachingClass.displayName}</td>
                  <td>
                    {teachingClass.course.name}（
                    {teachingClass.term.label}）
                  </td>
                  <td>{teachingClass.teacher.displayName}</td>
                  <td>{teachingClass.studentCount}</td>
                  <td>
                    <a
                      href={`/admin/teaching-classes/${teachingClass.id}`}
                    >
                      查看名单
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
