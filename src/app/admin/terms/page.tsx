import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { requirePageUser } from "@/lib/auth";
import { TERM_HALVES } from "@/lib/term-labels";
import { listTermsOverview } from "@/lib/terms";

import {
  CreateAcademicYearForm,
  CreateTermForm,
  SetCurrentTermControl,
} from "./term-forms";

export const dynamic = "force-dynamic";

export default async function AdminTermsPage() {
  const user = await requirePageUser("/admin/terms", {
    roles: ["administrator"],
  });
  const overview = await listTermsOverview();

  return (
    <main className="page wide">
      <header className="page-header">
        <div>
          <h1>学年与学期</h1>
          <p>{`当前学期：${
            overview.currentTerm ? overview.currentTerm.label : "尚未设置"
          }`}</p>
          <p>
            当前账号：{user.displayName}（{user.loginName}）
          </p>
          <p>
            <Link href="/admin">返回账号管理</Link>
          </p>
        </div>
        <LogoutButton />
      </header>

      {overview.currentTerm ? null : (
        <p className="notice" role="status">
          尚未设置当前学期。学生端与教师端会提示先设置当前学期。
        </p>
      )}

      <section>
        <h2>新建学年</h2>
        <p className="hint">
          学年以起始年份标识，例如 2025 表示 2025-2026 学年。每学年包含上学期与下学期。
        </p>
        <CreateAcademicYearForm />
      </section>

      <section>
        <h2>全部学年与学期</h2>
        {overview.academicYears.length === 0 ? (
          <p>还没有学年，请先新建学年。</p>
        ) : null}

        {overview.academicYears.map((year) => {
          const existing = new Set(year.terms.map((term) => term.half));
          const missingHalves = TERM_HALVES.filter(
            (half) => !existing.has(half),
          );

          return (
            <section key={year.id} className="year-group">
              <h3>{`${year.label} 学年`}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>学期</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {year.terms.length === 0 ? (
                    <tr>
                      <td colSpan={3}>尚未创建学期。</td>
                    </tr>
                  ) : null}
                  {year.terms.map((term) => (
                    <tr key={term.id}>
                      <td>{term.label}</td>
                      <td>{term.isCurrent ? "当前学期" : "未设为当前"}</td>
                      <td className="actions">
                        <SetCurrentTermControl
                          termId={term.id}
                          termLabel={term.label}
                          currentTermLabel={overview.currentTerm?.label ?? null}
                          isCurrent={term.isCurrent}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <CreateTermForm
                academicYearId={year.id}
                academicYearLabel={year.label}
                missingHalves={missingHalves}
              />
            </section>
          );
        })}
      </section>
    </main>
  );
}
