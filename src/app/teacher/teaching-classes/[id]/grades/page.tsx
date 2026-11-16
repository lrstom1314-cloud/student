import Link from "next/link";
import { forbidden, notFound } from "next/navigation";

import { GradeSheetScreen } from "@/components/grade-sheet-screen";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { getGradeSheet } from "@/lib/grades";
import { isUuid } from "@/lib/http";
import { isTeachingClassTeacher } from "@/lib/teaching-classes";

export const dynamic = "force-dynamic";

export default async function TeacherGradeEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/teacher/teaching-classes/${id}/grades`, {
    roles: ["teacher"],
  });

  if (!isUuid(id)) notFound();
  if (!(await isTeachingClassTeacher(id, user.id))) forbidden();

  const sheet = await getGradeSheet(id);
  if (!sheet) notFound();

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>成绩录入 · {sheet.teachingClass.displayName}</h1>
          <p>
            {sheet.teachingClass.term.label} · {sheet.teachingClass.course.name}{" "}
            · {sheet.teachingClass.teacher.displayName}
          </p>
          <p>
            <Link
              href={`/teacher/teaching-classes/${sheet.teachingClass.id}`}
            >
              返回教学班
            </Link>
            {" · "}
            <Link href="/teacher/teaching-classes">我的教学班</Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <GradeSheetScreen
        teachingClassId={sheet.teachingClass.id}
        initialSheet={sheet}
        backHref={`/teacher/teaching-classes/${sheet.teachingClass.id}`}
        backLabel="返回教学班"
      />
    </main>
  );
}
