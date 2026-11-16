import { LogoutButton } from "@/components/logout-button";
import { listAdministrativeClasses } from "@/lib/administrative-classes";
import { requirePageUser } from "@/lib/auth";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/enrollment-status";
import { isUuid } from "@/lib/http";
import { listStudents } from "@/lib/students";

import {
  CreateAdministrativeClassForm,
  CreateStudentForm,
  RenameAdministrativeClassForm,
  StudentAdjustForm,
} from "./student-forms";

export const dynamic = "force-dynamic";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ administrativeClassId?: string }>;
}) {
  const user = await requirePageUser("/admin/students", {
    roles: ["administrator"],
  });

  const params = await searchParams;
  const requestedClassId = params.administrativeClassId;
  const selectedClassId =
    typeof requestedClassId === "string" && isUuid(requestedClassId)
      ? requestedClassId
      : undefined;

  const administrativeClasses = await listAdministrativeClasses();
  const students = await listStudents(selectedClassId);
  const selectedClass = administrativeClasses.find(
    (administrativeClass) => administrativeClass.id === selectedClassId,
  );

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>学籍管理</h1>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
        </div>
        <div className="header-actions">
          <a href="/admin">账号管理</a>
          <LogoutButton />
        </div>
      </header>

      <section>
        <h2>行政班</h2>
        <p className="hint">
          名称直接含年级（如「高二 3 班」），年级调整时重命名即可，名单不变。
        </p>
        <CreateAdministrativeClassForm />

        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>名单</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {administrativeClasses.map((administrativeClass) => (
              <tr key={administrativeClass.id}>
                <td>
                  <a
                    href={`/admin/students?administrativeClassId=${administrativeClass.id}`}
                  >
                    {administrativeClass.name}
                  </a>
                </td>
                <td>
                  <a
                    href={`/admin/students?administrativeClassId=${administrativeClass.id}`}
                  >
                    查看名单
                  </a>
                </td>
                <td>
                  <RenameAdministrativeClassForm
                    administrativeClass={administrativeClass}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>新建学生</h2>
        <p className="hint">
          学号即登录名。该学号还没有账号时必须设置初始密码；已有学生账号时只建立关联，不会改动其密码。
          系统只记录学号、姓名、行政班与学籍状态。
        </p>
        <CreateStudentForm administrativeClasses={administrativeClasses} />
      </section>

      <section>
        <h2>
          学生名单
          {selectedClass ? `：${selectedClass.name}` : "（全部）"}
        </h2>
        <p className="hint">
          {selectedClassId ? (
            <a href="/admin/students">查看全部学生</a>
          ) : (
            "点击上方行政班名称可按行政班查看名单。"
          )}
        </p>

        {students.length === 0 ? (
          <p>暂无学生。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>行政班</th>
                <th>学籍状态</th>
                <th>转班与状态</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>{student.studentNumber}</td>
                  <td>{student.name}</td>
                  <td>{student.administrativeClass.name}</td>
                  <td>{ENROLLMENT_STATUS_LABELS[student.enrollmentStatus]}</td>
                  <td>
                    <StudentAdjustForm
                      studentId={student.id}
                      administrativeClassId={student.administrativeClass.id}
                      enrollmentStatus={student.enrollmentStatus}
                      administrativeClasses={administrativeClasses}
                    />
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
