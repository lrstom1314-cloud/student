"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginName: data.get("loginName"),
          password: data.get("password"),
          next,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok || !body.redirectTo) {
        setError(body.error ?? "登录失败，请稍后再试。");
        setPending(false);
        return;
      }

      window.location.assign(body.redirectTo);
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
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
