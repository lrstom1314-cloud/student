"use client";

import { useState } from "react";

type ApiResult = { error?: string };

async function postJson(route: string, body: unknown): Promise<Response> {
  return fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function failureMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as ApiResult;
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 学分与课时二选一（也可同时填写）：空的输入不提交，
 * 由服务端按「至少一项」校验。
 */
export function CreateCourseForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const credits = String(data.get("credits") ?? "").trim();
    const hours = String(data.get("hours") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();

    try {
      const response = await postJson("/api/admin/courses", {
        name: data.get("name"),
        ...(credits.length > 0 ? { credits } : {}),
        ...(hours.length > 0 ? { hours } : {}),
        ...(description.length > 0 ? { description } : {}),
      });
      if (!response.ok) {
        setError(await failureMessage(response, "创建课程失败，请稍后再试。"));
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
        <span>课程名称</span>
        <input name="name" required placeholder="如：高等数学" />
      </label>
      <label className="form-field">
        <span>学分</span>
        <input
          name="credits"
          type="number"
          min="0.1"
          max="99.9"
          step="0.1"
          placeholder="如 3"
        />
      </label>
      <label className="form-field">
        <span>课时</span>
        <input name="hours" type="number" min="1" step="1" placeholder="如 48" />
      </label>
      <label className="form-field">
        <span>说明（可选）</span>
        <input name="description" placeholder="如：微积分基础" />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建课程"}
      </button>
    </form>
  );
}
