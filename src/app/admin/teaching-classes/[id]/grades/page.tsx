import Link from "next/link";
import { notFound } from "next/navigation";

import { GradeSheetScreen } from "@/components/grade-sheet-screen";
import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { getGradeSheet } from "@/lib/grades";
import { isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function AdminGradeEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageUser(`/admin/teaching-classes/${id}/grades`, {
    roles: ["administrator"],
  });

  if (!isUuid(id)) notFound();
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
            <Link href={`/admin/teaching-classes/${sheet.teachingClass.id}`}>
              返回教学班
            </Link>
            {" · "}
            <Link href="/admin/teaching-classes">教学班管理</Link>
            {" · "}
            <Link href={`/admin/grade-logs?teachingClassId=${id}`}>
              变更日志
            </Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      <GradeSheetScreen
        teachingClassId={sheet.teachingClass.id}
        initialSheet={sheet}
        backHref={`/admin/teaching-classes/${sheet.teachingClass.id}`}
        backLabel="返回教学班"
        role="administrator"
      />
    </main>
  );
}
