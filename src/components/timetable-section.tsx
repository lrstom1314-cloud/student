"use client";

import { useState } from "react";

import type { TimetableConflict, TimetableEntry } from "@/lib/timetable";
import {
  MAX_PERIOD,
  MAX_WEEK,
  MIN_PERIOD,
  MIN_WEEK,
  periodLabel,
  WEEKDAY_LABELS,
  WEEK_PARITIES,
  WEEK_PARITY_LABELS,
  weekdayLabel,
  weekLabel,
} from "@/lib/timetable-labels";

type SaveResponse = {
  entry: TimetableEntry;
  conflicts: TimetableConflict[];
};

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

function EntryFields({ entry }: { entry?: TimetableEntry }) {
  return (
    <>
      <label className="form-field">
        <span>星期</span>
        <select name="weekday" required defaultValue={entry?.weekday ?? 1}>
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>起始节次</span>
        <input
          name="startPeriod"
          type="number"
          required
          min={MIN_PERIOD}
          max={MAX_PERIOD}
          defaultValue={entry?.startPeriod ?? 1}
        />
      </label>
      <label className="form-field">
        <span>结束节次</span>
        <input
          name="endPeriod"
          type="number"
          required
          min={MIN_PERIOD}
          max={MAX_PERIOD}
          defaultValue={entry?.endPeriod ?? 2}
        />
      </label>
      <label className="form-field">
        <span>起始周</span>
        <input
          name="startWeek"
          type="number"
          required
          min={MIN_WEEK}
          max={MAX_WEEK}
          defaultValue={entry?.startWeek ?? 1}
        />
      </label>
      <label className="form-field">
        <span>结束周</span>
        <input
          name="endWeek"
          type="number"
          required
          min={MIN_WEEK}
          max={MAX_WEEK}
          defaultValue={entry?.endWeek ?? 16}
        />
      </label>
      <label className="form-field">
        <span>单双周</span>
        <select name="weekParity" required defaultValue={entry?.weekParity ?? "every"}>
          {WEEK_PARITIES.map((parity) => (
            <option key={parity} value={parity}>
              {WEEK_PARITY_LABELS[parity]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>教室名</span>
        <input
          name="classroom"
          required
          maxLength={64}
          placeholder="如：教学楼 A101"
          defaultValue={entry?.classroom ?? ""}
        />
      </label>
    </>
  );
}

function valuesOf(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  return {
    weekday: Number(data.get("weekday")),
    startPeriod: Number(data.get("startPeriod")),
    endPeriod: Number(data.get("endPeriod")),
    startWeek: Number(data.get("startWeek")),
    endWeek: Number(data.get("endWeek")),
    weekParity: data.get("weekParity"),
    classroom: data.get("classroom"),
  };
}

/**
 * 课表编辑区：录入、修改、删除与冲突确认。
 * 冲突只告警不阻塞：保存成功后若发现冲突，提示教师确认或删除；
 * 未确认的条目仍会保留，并在列表里显示「存在冲突（未确认）」。
 */
export function TimetableSection({
  teachingClassId,
  entries,
  conflicts,
}: {
  teachingClassId: string;
  entries: TimetableEntry[];
  conflicts: TimetableConflict[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResponse | null>(null);

  const conflictsOf = (entryId: string) =>
    conflicts.filter((conflict) => conflict.entryId === entryId);

  function reload() {
    window.location.reload();
  }

  async function handleSave(
    event: React.FormEvent<HTMLFormElement>,
    entryId: string | null,
  ) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const body = valuesOf(event.currentTarget);
    const route = entryId
      ? `/api/teaching-classes/${teachingClassId}/timetable/${entryId}`
      : `/api/teaching-classes/${teachingClassId}/timetable`;

    try {
      const response = await fetch(route, {
        method: entryId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await failureMessage(response, "保存课表失败，请稍后再试。"));
        setBusy(false);
        return;
      }

      const result = (await response.json()) as SaveResponse;
      setBusy(false);
      setEditingId(null);
      setShowAdd(false);

      if (result.conflicts.length > 0) {
        setSaved(result);
        return;
      }
      reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setBusy(false);
    }
  }

  async function acknowledge(entry: TimetableEntry) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/timetable/${entry.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            weekday: entry.weekday,
            startPeriod: entry.startPeriod,
            endPeriod: entry.endPeriod,
            startWeek: entry.startWeek,
            endWeek: entry.endWeek,
            weekParity: entry.weekParity,
            classroom: entry.classroom,
            acknowledgeConflicts: true,
          }),
        },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "确认冲突失败，请稍后再试。"));
        setBusy(false);
        return;
      }
      reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setBusy(false);
    }
  }

  async function remove(entryId: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/teaching-classes/${teachingClassId}/timetable/${entryId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "删除课表失败，请稍后再试。"));
        setBusy(false);
        return;
      }
      reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setBusy(false);
    }
  }

  const editing = entries.find((entry) => entry.id === editingId) ?? null;

  return (
    <div>
      {entries.length === 0 ? (
        <p>该教学班还没有课表。请添加第一条上课安排。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>星期</th>
              <th>节次</th>
              <th>周次</th>
              <th>教室</th>
              <th>冲突状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const entryConflicts = conflictsOf(entry.id);
              return (
                <tr key={entry.id}>
                  <td>{weekdayLabel(entry.weekday)}</td>
                  <td>{periodLabel(entry.startPeriod, entry.endPeriod)}</td>
                  <td>{weekLabel(entry.startWeek, entry.endWeek, entry.weekParity)}</td>
                  <td>{entry.classroom}</td>
                  <td>
                    {entry.acknowledgedAt !== null ? (
                      <span className="badge">已确认冲突</span>
                    ) : entryConflicts.length > 0 ? (
                      <span className="form-error">
                        存在冲突（未确认）
                      </span>
                    ) : (
                      "无冲突"
                    )}
                  </td>
                  <td>
                    <span className="actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setSaved(null);
                          setEditingId(entry.id);
                        }}
                        disabled={busy}
                      >
                        修改
                      </button>
                      {entryConflicts.length > 0 &&
                      entry.acknowledgedAt === null ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => acknowledge(entry)}
                          disabled={busy}
                        >
                          确认冲突
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => remove(entry.id)}
                        disabled={busy}
                        aria-label={`删除 ${weekdayLabel(entry.weekday)} ${periodLabel(entry.startPeriod, entry.endPeriod)} 的课表`}
                      >
                        删除
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {conflicts.length > 0 ? (
        <div className="notice" role="status">
          <p>当前有 {conflicts.length} 处课表时间冲突：</p>
          <ul>
            {conflicts.map((conflict) => (
              <li key={`${conflict.entryId}-${conflict.conflictingEntryId}`}>
                {conflict.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {saved !== null && saved.conflicts.length > 0 ? (
        <div className="notice" role="alert">
          <p>
            已保存，但发现 {saved.conflicts.length} 处时间冲突（警告不阻止保存）。
            请确认是否保留这条课表：
          </p>
          <ul>
            {saved.conflicts.map((conflict) => (
              <li key={`${conflict.entryId}-${conflict.conflictingEntryId}`}>
                {conflict.message}
              </li>
            ))}
          </ul>
          <span className="actions">
            <button
              type="button"
              onClick={() => acknowledge(saved.entry)}
              disabled={busy}
            >
              确认冲突并保留
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => remove(saved.entry.id)}
              disabled={busy}
            >
              删除这条课表
            </button>
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {editing !== null ? (
        <form
          className="form form-inline"
          onSubmit={(event) => handleSave(event, editing.id)}
        >
          <p className="hint">修改课表条目（保存后重新计算冲突）</p>
          <EntryFields entry={editing} />
          <button type="submit" disabled={busy}>
            {busy ? "保存中…" : "保存修改"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setEditingId(null)}
            disabled={busy}
          >
            取消
          </button>
        </form>
      ) : null}

      {editing === null && !showAdd ? (
        <button type="button" onClick={() => setShowAdd(true)}>
          添加课表条目
        </button>
      ) : null}

      {editing === null && showAdd ? (
        <form
          className="form form-inline"
          onSubmit={(event) => handleSave(event, null)}
        >
          <EntryFields />
          <button type="submit" disabled={busy}>
            {busy ? "保存中…" : "保存课表"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setShowAdd(false)}
            disabled={busy}
          >
            取消
          </button>
        </form>
      ) : null}

      <p className="hint">
        单双周说明：单周与双周的课不会落在同一周，因此互不冲突；
        二者与「每周」的课时间重叠时会收到警告。
      </p>
    </div>
  );
}
