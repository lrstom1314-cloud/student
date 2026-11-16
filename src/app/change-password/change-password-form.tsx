"use client";

import { useState } from "react";

export function ChangePasswordForm({
  next,
  forced,
}: {
  next: string;
  forced: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword,
          next,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok || !body.redirectTo) {
        setError(body.error ?? "修改失败，请稍后再试。");
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
      {forced ? (
        <p className="notice">首次登录，请先修改初始密码后再使用系统。</p>
      ) : null}
      <label className="form-field">
        <span>当前密码</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </label>
      <label className="form-field">
        <span>新密码</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <label className="form-field">
        <span>再次输入新密码</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "提交中…" : "修改密码"}
      </button>
    </form>
  );
}
