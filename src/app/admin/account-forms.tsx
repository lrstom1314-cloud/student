"use client";

import { useState } from "react";

import { submitJson } from "@/lib/api-client";

export function CreateAccountForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = event.currentTarget;
    const data = new FormData(form);

    const result = await submitJson<unknown>("/api/admin/accounts", {
      body: {
        loginName: data.get("loginName"),
        displayName: data.get("displayName"),
        role: data.get("role"),
        password: data.get("password"),
      },
      fallback: "创建失败，请稍后再试。",
    });
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    window.location.reload();
  }

  return (
    <form className="form form-inline" onSubmit={onSubmit}>
      <label className="form-field">
        <span>登录名</span>
        <input name="loginName" required placeholder="学号或工号" />
      </label>
      <label className="form-field">
        <span>姓名</span>
        <input name="displayName" required />
      </label>
      <label className="form-field">
        <span>角色</span>
        <select name="role" defaultValue="student">
          <option value="student">学生</option>
          <option value="teacher">教师</option>
          <option value="administrator">教务管理员</option>
        </select>
      </label>
      <label className="form-field">
        <span>初始密码</span>
        <input
          name="password"
          type="password"
          minLength={8}
          required
          autoComplete="new-password"
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建账号"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({
  accountId,
  loginName,
}: {
  accountId: string;
  loginName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    const form = event.currentTarget;
    const data = new FormData(form);

    const result = await submitJson<unknown>(
      `/api/admin/accounts/${accountId}/reset-password`,
      {
        body: { newPassword: data.get("newPassword") },
        fallback: "重置失败，请稍后再试。",
      },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }

    form.reset();
    setNotice(`${loginName} 的密码已重置，对方下次登录需修改密码。`);
    setPending(false);
  }

  return (
    <form className="form form-compact" onSubmit={onSubmit}>
      <input
        name="newPassword"
        type="password"
        minLength={8}
        required
        placeholder="新的初始密码"
        autoComplete="new-password"
      />
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "重置中…" : "重置密码"}
      </button>
      {notice ? <p className="form-notice">{notice}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function DisabledToggle({
  accountId,
  disabled,
}: {
  accountId: string;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const result = await submitJson<unknown>(
      `/api/admin/accounts/${accountId}`,
      {
        method: "PATCH",
        body: { disabled: !disabled },
        fallback: "操作失败，请稍后再试。",
      },
    );
    if (!result.ok) {
      window.alert(result.message);
      setPending(false);
      return;
    }
    window.location.reload();
  }

  return (
    <button
      type="button"
      className="secondary"
      onClick={toggle}
      disabled={pending}
    >
      {disabled ? "启用" : "停用"}
    </button>
  );
}
