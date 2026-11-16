"use client";

import { useState } from "react";

type Option = { id: string; label: string };

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

export function CreateTeachingClassForm({
  terms,
  courses,
  teachers,
  administrativeClasses,
  defaultTermId,
}: {
  terms: Option[];
  courses: Option[];
  teachers: Option[];
  administrativeClasses: Option[];
  defaultTermId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    try {
      const response = await postJson("/api/admin/teaching-classes", {
        termId: data.get("termId"),
        courseId: data.get("courseId"),
        teacherAccountId: data.get("teacherAccountId"),
        displayName: data.get("displayName"),
        administrativeClassId: data.get("administrativeClassId") || undefined,
      });
      if (!response.ok) {
        setError(await failureMessage(response, "开设教学班失败，请稍后再试。"));
        setPending(false);
        return;
      }
      const body = (await response.json()) as {
        teachingClass: { id: string };
      };
      window.location.href = `/admin/teaching-classes/${body.teachingClass.id}`;
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <form className="form form-inline" onSubmit={onSubmit}>
      <label className="form-field">
        <span>学期</span>
        <select name="termId" required defaultValue={defaultTermId}>
          <option value="" disabled>
            请选择
          </option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>课程</span>
        <select name="courseId" required defaultValue="">
          <option value="" disabled>
            请选择
          </option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>任课教师</span>
        <select name="teacherAccountId" required defaultValue="">
          <option value="" disabled>
            请选择
          </option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>教学班显示名</span>
        <input name="displayName" required placeholder="如：高二 3 班 高等数学" />
      </label>
      <label className="form-field">
        <span>整班加入（可选）</span>
        <select name="administrativeClassId" defaultValue="">
          <option value="">不整班加入</option>
          {administrativeClasses.map((administrativeClass) => (
            <option key={administrativeClass.id} value={administrativeClass.id}>
              {administrativeClass.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "开设中…" : "开设教学班"}
      </button>
    </form>
  );
}

export function AddStudentForm({
  teachingClassId,
  students,
}: {
  teachingClassId: string;
  students: Option[];
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
        `/api/admin/teaching-classes/${teachingClassId}/students`,
        { studentId: data.get("studentId") },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "加入失败，请稍后再试。"));
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
        <span>手工添加学生</span>
        <select name="studentId" required defaultValue="">
          <option value="" disabled>
            请选择在读学生
          </option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "加入中…" : "加入名单"}
      </button>
    </form>
  );
}

export function EnrollAdministrativeClassForm({
  teachingClassId,
  administrativeClasses,
}: {
  teachingClassId: string;
  administrativeClasses: Option[];
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
        `/api/admin/teaching-classes/${teachingClassId}/enroll-administrative-class`,
        { administrativeClassId: data.get("administrativeClassId") },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "整班加入失败，请稍后再试。"));
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
        <span>整班加入</span>
        <select name="administrativeClassId" required defaultValue="">
          <option value="" disabled>
            请选择行政班
          </option>
          {administrativeClasses.map((administrativeClass) => (
            <option key={administrativeClass.id} value={administrativeClass.id}>
              {administrativeClass.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "加入中…" : "把行政班在读学生加入"}
      </button>
    </form>
  );
}

export function RemoveStudentButton({
  teachingClassId,
  studentId,
  studentName,
}: {
  teachingClassId: string;
  studentId: string;
  studentName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(
        `/api/admin/teaching-classes/${teachingClassId}/students/${studentId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await failureMessage(response, "移出失败，请稍后再试。"));
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
    <span className="actions">
      <button
        type="button"
        className="secondary"
        onClick={onClick}
        disabled={pending}
        aria-label={`把 ${studentName} 移出教学班`}
      >
        {pending ? "移出中…" : "移出"}
      </button>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
