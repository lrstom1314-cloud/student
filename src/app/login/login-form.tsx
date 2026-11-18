"use client";

import { useState } from "react";

import { submitJson } from "@/lib/api-client";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await submitJson<{ redirectTo?: string }>(
      "/api/auth/login",
      {
        body: {
          loginName: data.get("loginName"),
          password: data.get("password"),
          next,
        },
        fallback: "登录失败，请稍后再试。",
      },
    );

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    if (!result.data.redirectTo) {
      setError("登录失败，请稍后再试。");
      setPending(false);
      return;
    }

    window.location.assign(result.data.redirectTo);
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="form-field">
        <span>登录名</span>
        <input
          name="loginName"
          autoComplete="username"
          required
          autoFocus
          placeholder="学号或工号"
        />
      </label>
      <label className="form-field">
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
