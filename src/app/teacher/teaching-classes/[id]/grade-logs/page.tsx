import Link from "next/link";
import { forbidden, notFound } from "next/navigation";

import { GradeLogTable } from "@/components/grade-log-table";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { listGradeChangeLogsByTeachingClass } from "@/lib/grade-logs";
import { isUuid } from "@/lib/http";
import { authorizeTeachingClass } from "@/lib/teaching-class-access";

export const dynamic = "force-dynamic";

/** 教师只能查看自己任教教学班的变更日志，越权由服务端渲染 403。 */
export default async function TeacherGradeLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(
    `/teacher/teaching-classes/${id}/grade-logs`,
    { roles: ["teacher"] },
  );

  if (!isUuid(id)) notFound();
  const access = await authorizeTeachingClass(id, user, "teach");
  if (!access.ok) forbidden();

  const teachingClass = access.teachingClass;

  const logs = await listGradeChangeLogsByTeachingClass(id);

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>成绩变更日志 · {teachingClass.displayName}</h1>
          <p>
            <Link href={`/teacher/teaching-classes/${id}`}>返回教学班</Link>
            {" · "}
            <Link href={`/teacher/teaching-classes/${id}/grades`}>
              录入成绩
            </Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <section>
        <p className="hint">
          记录谁在何时改动了哪个学生的哪一项，包括发布与教务管理员解锁。
        </p>
        <GradeLogTable entries={logs} />
      </section>
    </main>
  );
}
