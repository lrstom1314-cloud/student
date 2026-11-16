"use client";

import { useState } from "react";

import { TERM_HALF_LABELS, type TermHalf } from "@/lib/term-labels";

type ApiResult = { error?: string };

async function postJson(route: string, body: unknown): Promise<Response> {
  return fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function CreateAcademicYearForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await postJson("/api/admin/academic-years", {
        startYear: Number(data.get("startYear")),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiResult;
        setError(body.error ?? "创建失败，请稍后再试。");
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <form className="form form-inline" onSubmit={onSubmit}>
      <label className="form-field">
        <span>起始年份</span>
        <input
          name="startYear"
          type="number"
          min={1900}
          max={2200}
          step={1}
          required
          placeholder="例如 2025"
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建学年"}
      </button>
    </form>
  );
}

export function CreateTermForm({
  academicYearId,
  academicYearLabel,
  missingHalves,
}: {
  academicYearId: string;
  academicYearLabel: string;
  missingHalves: TermHalf[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (missingHalves.length === 0) {
    return <p className="hint">本学年的上学期与下学期都已创建。</p>;
  }

  const defaultValue =
    missingHalves.find((half) => half === "first") ?? missingHalves[0];

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);

    try {
      const response = await postJson("/api/admin/terms", {
        academicYearId,
        half: data.get("half"),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiResult;
        setError(body.error ?? "创建失败，请稍后再试。");
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <form className="form form-compact term-create" onSubmit={onSubmit}>
      <label className="form-field">
        <span>在 {academicYearLabel} 学年新建</span>
        <select name="half" defaultValue={defaultValue}>
          {missingHalves.map((half) => (
            <option key={half} value={half}>
              {TERM_HALF_LABELS[half]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建学期"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 设置教学第 1 周的起始日期。刻意只提供一个日期输入，不做复杂校历；
 * 学生端用它把「今天」换算成当前教学周，从而标出单双周课程本周是否要上。
 */
export function SetStartDateForm({
  termId,
  termLabel,
  startsOn,
}: {
  termId: string;
  termLabel: string;
  startsOn: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const value = data.get("startsOn");
    const startsOnValue =
      typeof value === "string" && value.length > 0 ? value : null;

    try {
      const response = await fetch(`/api/admin/terms/${termId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startsOn: startsOnValue }),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiResult;
        setError(body.error ?? "保存失败，请稍后再试。");
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <form className="form form-compact term-starts-on" onSubmit={onSubmit}>
      <label className="form-field">
        <span>{`${termLabel} 的开学日期`}</span>
        <input
          type="date"
          name="startsOn"
          defaultValue={startsOn ?? ""}
          aria-label={`${termLabel} 的教学第 1 周起始日期`}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存开学日期"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 切换当前学期前先展开确认区，明确写出「从哪个学期切到哪个学期」。
 * 确认后再提交 confirmed=true；接口本身也会拒绝未确认的请求。
 */
export function SetCurrentTermControl({
  termId,
  termLabel,
  currentTermLabel,
  isCurrent,
}: {
  termId: string;
  termLabel: string;
  currentTermLabel: string | null;
  isCurrent: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (isCurrent) {
    return <span className="badge">当前学期</span>;
  }

  const confirmation = currentTermLabel
    ? `确定将当前学期从「${currentTermLabel}」切换为「${termLabel}」吗？所有人的默认视图都会随之改变。`
    : `确定将「${termLabel}」设为当前学期吗？所有人的默认视图都会随之改变。`;

  async function switchTerm() {
    setError(null);
    setPending(true);

    try {
      const response = await postJson("/api/admin/current-term", {
        termId,
        confirmed: true,
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiResult;
        setError(body.error ?? "切换失败，请稍后再试。");
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <details className="confirm">
      <summary>设为当前学期</summary>
      <p>{confirmation}</p>
      <button type="button" onClick={switchTerm} disabled={pending}>
        {pending ? "切换中…" : "确认切换"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
