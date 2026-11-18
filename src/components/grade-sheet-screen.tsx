"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { submitJson } from "@/lib/api-client";
import type { GradeLock, GradeSheet, GradeSheetStudent } from "@/lib/grades";

function cellKey(studentId: string, gradeItemId: string): string {
  return `${studentId}:${gradeItemId}`;
}

function OverallControls({
  teachingClassId,
  student,
  onSheet,
}: {
  teachingClassId: string;
  student: GradeSheetStudent;
  onSheet: (sheet: GradeSheet) => void;
}) {
  const [value, setValue] = useState(
    student.overall.overrideScore === null
      ? ""
      : String(student.overall.overrideScore),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveOverride() {
    setPending(true);
    setError(null);
    const result = await submitJson<{ sheet: GradeSheet }>(
      `/api/teaching-classes/${teachingClassId}/overalls/${student.id}`,
      {
        method: "PUT",
        body: { score: value },
        fallback: "覆盖总评失败，请稍后再试。",
      },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    onSheet(result.data.sheet);
    setPending(false);
  }

  async function cancelOverride() {
    setPending(true);
    setError(null);
    const result = await submitJson<{ sheet: GradeSheet }>(
      `/api/teaching-classes/${teachingClassId}/overalls/${student.id}`,
      { method: "DELETE", fallback: "取消覆盖失败，请稍后再试。" },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    onSheet(result.data.sheet);
    setValue("");
    setPending(false);
  }

  return (
    <div className="overall-controls">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${student.name} 的总评覆盖值`}
        placeholder="覆盖值"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={pending}
      />
      <button
        type="button"
        className="secondary"
        onClick={saveOverride}
        disabled={pending || value.trim().length === 0}
      >
        {student.overall.overrideScore === null ? "覆盖总评" : "更新覆盖"}
      </button>
      {student.overall.overrideScore === null ? null : (
        <button
          type="button"
          className="secondary"
          onClick={cancelOverride}
          disabled={pending}
        >
          取消覆盖
        </button>
      )}
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function OverallCell({
  teachingClassId,
  student,
  onSheet,
}: {
  teachingClassId: string;
  student: GradeSheetStudent;
  onSheet: (sheet: GradeSheet) => void;
}) {
  const { overall } = student;
  return (
    <td>
      {overall.status === "incomplete" ? (
        <span className="badge">未完成</span>
      ) : null}
      <div>
        {overall.finalScore === null ? "—" : overall.finalScore}
        {overall.finalSource === "override" ? "（已覆盖）" : ""}
      </div>
      {overall.missingGradeItemIds.length > 0 ? (
        <div className="hint">缺 {overall.missingGradeItemIds.length} 项</div>
      ) : null}
      <OverallControls
        teachingClassId={teachingClassId}
        student={student}
        onSheet={onSheet}
      />
    </td>
  );
}

function OverallReadOnlyCell({ student }: { student: GradeSheetStudent }) {
  const { overall } = student;
  return (
    <td>
      {overall.status === "incomplete" ? (
        <span className="badge">未完成</span>
      ) : null}
      <div>
        {overall.finalScore === null ? "—" : overall.finalScore}
        {overall.finalSource === "override" ? "（已覆盖）" : ""}
      </div>
      {overall.missingGradeItemIds.length > 0 ? (
        <div className="hint">缺 {overall.missingGradeItemIds.length} 项</div>
      ) : null}
    </td>
  );
}

function LockStatus({ lock }: { lock: GradeLock }) {
  if (lock.state === "published") {
    return (
      <p className="notice" role="status">
        成绩已发布并锁定。学生当前看到的是本次发布的快照；如需修改，必须先由教务管理员解锁。
      </p>
    );
  }
  if (lock.latestPublication) {
    return (
      <p className="notice" role="status">
        已解锁，可以继续修改。学生当前仍看到第{" "}
        {lock.latestPublication.version} 次发布的成绩，重新发布后才会更新。
      </p>
    );
  }
  return <p className="hint">当前为草稿，学生看不到任何成绩数据。</p>;
}

function PublishPanel({
  teachingClassId,
  onSheet,
}: {
  teachingClassId: string;
  onSheet: (sheet: GradeSheet) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setPending(true);
    setError(null);
    const result = await submitJson<{ sheet: GradeSheet }>(
      `/api/teaching-classes/${teachingClassId}/publish`,
      {
        body: { confirmed: true },
        fallback: "发布失败，请稍后再试。",
      },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    onSheet(result.data.sheet);
    setPending(false);
  }

  return (
    <details className="confirm">
      <summary>发布成绩</summary>
      <p>
        发布后全体学生将立即看到本次成绩，并锁定教学班；此后教师与教务管理员都无法直接修改，需教务管理员解锁后才能再次修改。
      </p>
      <p>发布前请核对全部成绩项与分数，确认无误后再提交。</p>
      <button type="button" onClick={publish} disabled={pending}>
        {pending ? "发布中…" : "确认发布"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}

function UnlockPanel({
  teachingClassId,
  onSheet,
}: {
  teachingClassId: string;
  onSheet: (sheet: GradeSheet) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await submitJson<{ sheet: GradeSheet }>(
      `/api/teaching-classes/${teachingClassId}/unlock`,
      { body: { reason }, fallback: "解锁失败，请稍后再试。" },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    onSheet(result.data.sheet);
    setReason("");
    setPending(false);
  }

  return (
    <form className="form" onSubmit={unlock}>
      <p className="hint">
        解锁后教师可以继续修改成绩；学生仍看到上一次发布的成绩，直到重新发布。解锁理由会写入成绩变更日志。
      </p>
      <label className="form-field">
        <span>解锁理由（必填）</span>
        <input
          name="reason"
          required
          maxLength={500}
          placeholder="如：总评录入错误，需更正"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="form-inline">
        <button type="submit" disabled={pending || reason.trim().length === 0}>
          {pending ? "解锁中…" : "确认解锁"}
        </button>
        {error ? (
          <span className="form-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function GradeSheetScreen({
  teachingClassId,
  initialSheet,
  backHref,
  backLabel,
  role,
}: {
  teachingClassId: string;
  initialSheet: GradeSheet;
  backHref: string;
  backLabel: string;
  role: "teacher" | "administrator";
}) {
  const [sheet, setSheet] = useState(initialSheet);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemPending, setItemPending] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const { gradeItems, students, lock } = sheet;
  const locked = lock.state === "published";

  function valueOf(student: GradeSheetStudent, gradeItemId: string): string {
    const key = cellKey(student.id, gradeItemId);
    if (key in draft) return draft[key]!;
    const score = student.grades[gradeItemId];
    return score === null || score === undefined ? "" : String(score);
  }

  function updateCell(studentId: string, gradeItemId: string, value: string) {
    setDraft((previous) => ({
      ...previous,
      [cellKey(studentId, gradeItemId)]: value,
    }));
    setSavedMessage(null);
  }

  function focusCell(row: number, column: number) {
    const root = gridRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLInputElement>(
      `input[data-cell-row="${row}"][data-cell-col="${column}"]`,
    );
    if (target) {
      target.focus();
      target.select();
    }
  }

  /** Enter / ↓ 下移一行，↑ 上移一行；Tab 保持浏览器原生横向移动。 */
  function onCellKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    row: number,
    column: number,
  ) {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(row + 1, column);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCell(row - 1, column);
    }
  }

  async function saveScores() {
    const entries = Object.entries(draft);
    if (entries.length === 0) return;

    const scores = entries.map(([key, value]) => {
      const [studentId, gradeItemId] = key.split(":");
      return {
        studentId,
        gradeItemId,
        score: value.trim() === "" ? null : value.trim(),
      };
    });

    setSaving(true);
    setGridError(null);
    setSavedMessage(null);
    const result = await submitJson<{
      sheet: GradeSheet;
      updatedCount: number;
    }>(`/api/teaching-classes/${teachingClassId}/grades`, {
      method: "PUT",
      body: { scores },
      fallback: "保存成绩失败，请稍后再试。",
    });
    if (!result.ok) {
      setGridError(result.message);
      setSaving(false);
      return;
    }
    setSheet(result.data.sheet);
    setDraft({});
    setSavedMessage(`已保存 ${result.data.updatedCount} 处成绩。`);
    setSaving(false);
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setItemPending(true);
    setItemError(null);
    const result = await submitJson<{ sheet: GradeSheet }>(
      `/api/teaching-classes/${teachingClassId}/grade-items`,
      {
        body: {
          name: data.get("name"),
          maxScore: data.get("maxScore"),
          weight: data.get("weight"),
        },
        fallback: "添加成绩项失败，请稍后再试。",
      },
    );
    if (!result.ok) {
      setItemError(result.message);
      setItemPending(false);
      return;
    }
    setSheet(result.data.sheet);
    form.reset();
    setItemPending(false);
  }

  return (
    <>
      <section>
        <h2>发布与锁定</h2>
        <LockStatus lock={lock} />
        {locked ? (
          role === "administrator" ? (
            <UnlockPanel teachingClassId={teachingClassId} onSheet={setSheet} />
          ) : (
            <p className="hint">
              需要修改请联系教务管理员解锁。解锁后学生仍看到上一次发布的成绩，重新发布后才会更新。
            </p>
          )
        ) : (
          <PublishPanel
            teachingClassId={teachingClassId}
            onSheet={(next) => {
              setDraft({});
              setSheet(next);
            }}
          />
        )}
      </section>

      <section>
        <h2>导出成绩表</h2>
        <p className="hint">
          {lock.state === "draft" && lock.latestPublication
            ? "导出的是上一次发布的成绩快照；文件名与首行会标注「解锁中·内容为上次发布」，解锁期间的修改不会出现在文件中。文件为 UTF-8 带 BOM 的 CSV，Excel 可直接打开。"
            : lock.latestPublication
              ? "导出的是最后一次发布的成绩快照。文件为 UTF-8 带 BOM 的 CSV，Excel 可直接打开。"
              : "本教学班尚未发布，导出文件仅供内部核对，会在文件名与首行标注「未发布」，不代表正式成绩。"}
        </p>
        <p>
          <a href={`/api/teaching-classes/${teachingClassId}/grades/export`}>
            导出成绩表（CSV）
          </a>
        </p>
      </section>

      <section>
        <h2>成绩项</h2>
        {sheet.weightWarning === null ? (
          <p className="hint">
            权重合计 {sheet.weightTotal}%，成绩项配置完整。
          </p>
        ) : (
          <p className="notice" role="status">
            {sheet.weightWarning}
          </p>
        )}
        <p className="hint">
          总评 = Σ(得分 ÷ 满分 × 权重)，保留两位小数。得分留空表示缺考或未录入，
          不按 0 分参与计算；任一成绩项缺失时总评显示为「未完成」。
        </p>

        {gradeItems.length === 0 ? (
          <p>还没有成绩项，请先在下方添加。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>成绩项</th>
                <th>满分</th>
                <th>权重</th>
              </tr>
            </thead>
            <tbody>
              {gradeItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.maxScore}</td>
                  <td>{item.weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {locked ? null : (
          <form className="form form-inline" onSubmit={createItem}>
            <label className="form-field">
              <span>名称</span>
              <input name="name" required placeholder="如：平时" />
            </label>
            <label className="form-field">
              <span>满分</span>
              <input
                name="maxScore"
                required
                inputMode="decimal"
                placeholder="如：100"
              />
            </label>
            <label className="form-field">
              <span>权重（%）</span>
              <input
                name="weight"
                required
                inputMode="decimal"
                placeholder="如：30"
              />
            </label>
            <button type="submit" disabled={itemPending}>
              {itemPending ? "添加中…" : "添加成绩项"}
            </button>
            {itemError ? (
              <p className="form-error" role="alert">
                {itemError}
              </p>
            ) : null}
          </form>
        )}
      </section>

      <section>
        <h2>成绩录入</h2>
        {locked ? (
          <p className="hint">
            已发布并锁定，以下为本次发布时的成绩快照，仅可查看。
          </p>
        ) : (
          <p className="hint">
            键盘：Tab 横向移动到下一格，Enter 或 ↑ ↓ 纵向移动。
          </p>
        )}

        {students.length === 0 ? (
          <p>该教学班还没有学生，无法录入成绩。</p>
        ) : gradeItems.length === 0 ? (
          <p>添加成绩项后即可录入。</p>
        ) : (
          <>
            <div ref={gridRef}>
              <table className="table grade-grid">
                <thead>
                  <tr>
                    <th>学号</th>
                    <th>姓名</th>
                    {gradeItems.map((item) => (
                      <th key={item.id}>
                        {item.name}
                        <br />
                        <span className="hint">
                          满分 {item.maxScore} · 权重 {item.weight}%
                        </span>
                      </th>
                    ))}
                    <th>总评</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, row) => (
                    <tr key={student.id}>
                      <td>{student.studentNumber}</td>
                      <td>{student.name}</td>
                      {gradeItems.map((item, column) =>
                        locked ? (
                          <td key={item.id}>
                            {valueOf(student, item.id) === ""
                              ? "缺考"
                              : valueOf(student, item.id)}
                          </td>
                        ) : (
                          <td key={item.id}>
                            <input
                              type="text"
                              inputMode="decimal"
                              data-student-id={student.id}
                              data-grade-item-id={item.id}
                              data-cell-row={row}
                              data-cell-col={column}
                              aria-label={`${student.name} 的 ${item.name} 得分`}
                              value={valueOf(student, item.id)}
                              onChange={(event) =>
                                updateCell(
                                  student.id,
                                  item.id,
                                  event.target.value,
                                )
                              }
                              onKeyDown={(event) =>
                                onCellKeyDown(event, row, column)
                              }
                            />
                          </td>
                        ),
                      )}
                      {locked ? (
                        <OverallReadOnlyCell student={student} />
                      ) : (
                        <OverallCell
                          teachingClassId={teachingClassId}
                          student={student}
                          onSheet={setSheet}
                        />
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {locked ? null : (
              <div className="form form-inline">
                <button
                  type="button"
                  onClick={saveScores}
                  disabled={saving || Object.keys(draft).length === 0}
                >
                  {saving ? "保存中…" : "保存成绩"}
                </button>
                <span className="hint">
                  未保存修改 {Object.keys(draft).length} 处
                </span>
                {savedMessage ? (
                  <span className="form-notice" role="status">
                    {savedMessage}
                  </span>
                ) : null}
                {gridError ? (
                  <span className="form-error" role="alert">
                    {gridError}
                  </span>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>

      <p>
        <Link href={backHref}>{backLabel}</Link>
      </p>
    </>
  );
}
