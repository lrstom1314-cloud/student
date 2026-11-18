"use client";

import { useState } from "react";

import { submitJson } from "@/lib/api-client";

type Option = { id: string; label: string };

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
    const result = await submitJson<{
      teachingClass: { id: string };
    }>("/api/admin/teaching-classes", {
      body: {
        termId: data.get("termId"),
        courseId: data.get("courseId"),
        teacherAccountId: data.get("teacherAccountId"),
        displayName: data.get("displayName"),
        administrativeClassId: data.get("administrativeClassId") || undefined,
      },
      fallback: "开设教学班失败，请稍后再试。",
    });
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    window.location.href = `/admin/teaching-classes/${result.data.teachingClass.id}`;
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
    const result = await submitJson<unknown>(
      `/api/admin/teaching-classes/${teachingClassId}/students`,
      {
        body: { studentId: data.get("studentId") },
        fallback: "加入失败，请稍后再试。",
      },
    );
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
    const result = await submitJson<unknown>(
      `/api/admin/teaching-classes/${teachingClassId}/enroll-administrative-class`,
      {
        body: { administrativeClassId: data.get("administrativeClassId") },
        fallback: "整班加入失败，请稍后再试。",
      },
    );
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
    const result = await submitJson<unknown>(
      `/api/admin/teaching-classes/${teachingClassId}/students/${studentId}`,
      { method: "DELETE", fallback: "移出失败，请稍后再试。" },
    );
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    window.location.reload();
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
