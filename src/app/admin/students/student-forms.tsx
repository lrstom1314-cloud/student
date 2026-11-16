"use client";

import { useState } from "react";

import type { AdministrativeClassSummary } from "@/lib/administrative-classes";
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_LABELS,
  type EnrollmentStatus,
} from "@/lib/enrollment-status";

type ApiResult = { error?: string };

async function postJson(
  method: "POST" | "PATCH",
  route: string,
  body: unknown,
): Promise<Response> {
  return fetch(route, {
    method,
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

export function CreateAdministrativeClassForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await postJson(
        "POST",
        "/api/admin/administrative-classes",
        { name: data.get("name") },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "创建失败，请稍后再试。"));
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
        <span>行政班名称</span>
        <input name="name" required placeholder="如：高二 3 班" />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建行政班"}
      </button>
    </form>
  );
}

export function RenameAdministrativeClassForm({
  administrativeClass,
}: {
  administrativeClass: AdministrativeClassSummary;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await postJson(
        "PATCH",
        `/api/admin/administrative-classes/${administrativeClass.id}`,
        { name: data.get("name") },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "重命名失败，请稍后再试。"));
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
    <form className="form form-compact" onSubmit={onSubmit}>
      <input
        name="name"
        required
        defaultValue={administrativeClass.name}
        aria-label={`重命名 ${administrativeClass.name}`}
      />
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "保存中…" : "重命名"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function CreateStudentForm({
  administrativeClasses,
}: {
  administrativeClasses: AdministrativeClassSummary[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await postJson("POST", "/api/admin/students", {
        studentNumber: data.get("studentNumber"),
        name: data.get("name"),
        administrativeClassId: data.get("administrativeClassId"),
        enrollmentStatus: data.get("enrollmentStatus"),
        initialPassword: data.get("initialPassword"),
      });
      if (!response.ok) {
        setError(await failureMessage(response, "新建学生失败，请稍后再试。"));
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
        <span>学号</span>
        <input name="studentNumber" required placeholder="学生登录名" />
      </label>
      <label className="form-field">
        <span>姓名</span>
        <input name="name" required />
      </label>
      <label className="form-field">
        <span>行政班</span>
        <select name="administrativeClassId" required defaultValue="">
          <option value="" disabled>
            请选择
          </option>
          {administrativeClasses.map((administrativeClass) => (
            <option key={administrativeClass.id} value={administrativeClass.id}>
              {administrativeClass.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>学籍状态</span>
        <select name="enrollmentStatus" defaultValue="enrolled">
          {ENROLLMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ENROLLMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>初始密码</span>
        <input
          name="initialPassword"
          type="password"
          minLength={8}
          autoComplete="new-password"
          placeholder="学号已有账号时可留空"
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "新建中…" : "新建学生"}
      </button>
    </form>
  );
}

export function StudentAdjustForm({
  studentId,
  administrativeClassId,
  enrollmentStatus,
  administrativeClasses,
}: {
  studentId: string;
  administrativeClassId: string;
  enrollmentStatus: EnrollmentStatus;
  administrativeClasses: AdministrativeClassSummary[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await postJson(
        "PATCH",
        `/api/admin/students/${studentId}`,
        {
          administrativeClassId: data.get("administrativeClassId"),
          enrollmentStatus: data.get("enrollmentStatus"),
        },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "保存失败，请稍后再试。"));
        setPending(false);
        return;
      }
      setNotice("已保存");
      setPending(false);
      window.location.reload();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <form className="form form-compact" onSubmit={onSubmit}>
      <select
        name="administrativeClassId"
        defaultValue={administrativeClassId}
        aria-label="行政班"
      >
        {administrativeClasses.map((administrativeClass) => (
          <option key={administrativeClass.id} value={administrativeClass.id}>
            {administrativeClass.name}
          </option>
        ))}
      </select>
      <select
        name="enrollmentStatus"
        defaultValue={enrollmentStatus}
        aria-label="学籍状态"
      >
        {ENROLLMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {ENROLLMENT_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "保存中…" : "保存"}
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
