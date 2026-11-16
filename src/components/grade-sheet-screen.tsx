"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { GradeSheet, GradeSheetStudent } from "@/lib/grades";

type ApiError = { error?: string };

async function failureMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as ApiError;
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

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
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/overalls/${student.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ score: value }),
        },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "覆盖总评失败，请稍后再试。"));
        setPending(false);
        return;
      }
      const body = (await response.json()) as { sheet: GradeSheet };
      onSheet(body.sheet);
      setPending(false);
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  async function cancelOverride() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/overalls/${student.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "取消覆盖失败，请稍后再试。"));
        setPending(false);
        return;
      }
      const body = (await response.json()) as { sheet: GradeSheet };
      onSheet(body.sheet);
      setValue("");
      setPending(false);
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
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
      {overall.status === "incomplete" ? (
        <div className="hint">
          缺 {overall.missingGradeItemIds.length} 项
        </div>
      ) : null}
      <OverallControls
        teachingClassId={teachingClassId}
        student={student}
        onSheet={onSheet}
      />
    </td>
  );
}

export function GradeSheetScreen({
  teachingClassId,
  initialSheet,
  backHref,
  backLabel,
}: {
  teachingClassId: string;
  initialSheet: GradeSheet;
  backHref: string;
  backLabel: string;
}) {
  const [sheet, setSheet] = useState(initialSheet);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemPending, setItemPending] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const { gradeItems, students } = sheet;

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
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/grades`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scores }),
        },
      );
      if (!response.ok) {
        setGridError(await failureMessage(response, "保存成绩失败，请稍后再试。"));
        setSaving(false);
        return;
      }
      const body = (await response.json()) as {
        sheet: GradeSheet;
        updatedCount: number;
      };
      setSheet(body.sheet);
      setDraft({});
      setSavedMessage(`已保存 ${body.updatedCount} 处成绩。`);
      setSaving(false);
    } catch {
      setGridError("网络异常，请稍后再试。");
      setSaving(false);
    }
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setItemPending(true);
    setItemError(null);
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/grade-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            maxScore: data.get("maxScore"),
            weight: data.get("weight"),
          }),
        },
      );
      if (!response.ok) {
        setItemError(await failureMessage(response, "添加成绩项失败，请稍后再试。"));
        setItemPending(false);
        return;
      }
      const body = (await response.json()) as { sheet: GradeSheet };
      setSheet(body.sheet);
      form.reset();
      setItemPending(false);
    } catch {
      setItemError("网络异常，请稍后再试。");
      setItemPending(false);
    }
  }

  return (
    <>
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
          不按 0 分参与计算；任一分项缺失时总评显示为「未完成」。
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
      </section>

      <section>
        <h2>成绩录入</h2>
        <p className="hint">
          键盘：Tab 横向移动到下一格，Enter 或 ↑ ↓ 纵向移动。
        </p>

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
                      {gradeItems.map((item, column) => (
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
                      ))}
                      <OverallCell
                        teachingClassId={teachingClassId}
                        student={student}
                        onSheet={setSheet}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
          </>
        )}
      </section>

      <p>
        <Link href={backHref}>{backLabel}</Link>
      </p>
    </>
  );
}
