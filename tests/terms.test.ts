import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin01";
const ADMIN_PASSWORD = "管理员密码123";
const TEACHER_LOGIN = "t8001";
const STUDENT_LOGIN = "s8001";
const ACCOUNT_PASSWORD = "初始密码1234";

let app: TestApp;
let adminCookie = "";
let teacherCookie = "";
let studentCookie = "";

type Json = Record<string, unknown>;

async function api(
  method: "GET" | "POST",
  route: string,
  body?: Json,
  cookie?: string,
): Promise<Response> {
  return fetch(`${app.baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}

async function page(route: string, cookie?: string): Promise<Response> {
  return fetch(`${app.baseUrl}${route}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0] ?? "";
}

function bootstrapAccount(input: {
  loginName: string;
  displayName: string;
  role: "student" | "teacher" | "administrator";
  password: string;
}): void {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/create-account.mjs"),
      "--login",
      input.loginName,
      "--name",
      input.displayName,
      "--role",
      input.role,
      "--password",
      input.password,
      "--no-force-change",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(),
        DATABASE_SCHEMA: app.schema ?? "",
      },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `创建测试账号失败（exit=${result.status}）。\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

async function login(loginName: string, password: string): Promise<string> {
  const response = await api("POST", "/api/auth/login", {
    loginName,
    password,
  });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

async function createAcademicYear(
  startYear: unknown,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "POST",
    "/api/admin/academic-years",
    { startYear },
    cookie,
  );
}

describe("学年与学期", () => {
  beforeAll(async () => {
    app = await startTestApp();

    bootstrapAccount({
      loginName: ADMIN_LOGIN,
      displayName: "教务甲",
      role: "administrator",
      password: ADMIN_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_LOGIN,
      displayName: "教师甲",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    bootstrapAccount({
      loginName: STUDENT_LOGIN,
      displayName: "学生甲",
      role: "student",
      password: ACCOUNT_PASSWORD,
    });

    adminCookie = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
    teacherCookie = await login(TEACHER_LOGIN, ACCOUNT_PASSWORD);
    studentCookie = await login(STUDENT_LOGIN, ACCOUNT_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await app.stop();
  });

  it("教务管理员可创建学年，以起始年份标识", async () => {
    const response = await createAcademicYear(2025);
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      academicYear: { id: string; startYear: number; label: string };
    };
    expect(body.academicYear).toMatchObject({
      startYear: 2025,
      label: "2025-2026",
    });

    const rows = await queryRows<{ start_year: number }>(
      app.schema!,
      "select start_year from academic_years where id = $1",
      [body.academicYear.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.start_year).toBe(2025);
  });

  it("学年起始年份重复或非法时返回可读错误，且不产生重复记录", async () => {
    const duplicate = await createAcademicYear(2025);
    expect(duplicate.status).toBe(409);
    const duplicateBody = (await duplicate.json()) as { error: string };
    expect(duplicateBody.error).toContain("学年");
    expect(duplicateBody.error).not.toContain("constraint");
    expect(duplicateBody.error).not.toContain("duplicate");

    const invalidValues: unknown[] = ["2027", 2027.5, 0, 3000, null];
    for (const value of invalidValues) {
      const response = await createAcademicYear(value);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("学年");
    }

    const rows = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from academic_years",
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("教务管理员可在学年下创建上学期与下学期", async () => {
    const year = await createAcademicYear(2026);
    expect(year.status).toBe(201);
    const { academicYear } = (await year.json()) as {
      academicYear: { id: string };
    };

    const first = await createTerm(academicYear.id, "first");
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      term: { id: string; half: string; label: string; academicYearId: string };
    };
    expect(firstBody.term).toMatchObject({
      half: "first",
      label: "2026-2027 学年上学期",
      academicYearId: academicYear.id,
    });

    const second = await createTerm(academicYear.id, "second");
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      term: { half: string; label: string };
    };
    expect(secondBody.term).toMatchObject({
      half: "second",
      label: "2026-2027 学年下学期",
    });

    const rows = await queryRows<{ half: string }>(
      app.schema!,
      "select half from terms where academic_year_id = $1 order by half",
      [academicYear.id],
    );
    expect(rows.map((row) => row.half)).toEqual(["first", "second"]);
  });

  it("同一学年下不能出现两条同学期的记录", async () => {
    const yearId = await academicYearIdOf(2026);

    const duplicate = await createTerm(yearId, "first");
    expect(duplicate.status).toBe(409);
    const body = (await duplicate.json()) as { error: string };
    expect(body.error).toContain("学期");
    expect(body.error).not.toContain("constraint");

    const rows = await queryRows<{ count: number }>(
      app.schema!,
      `select count(*)::int as count from terms
       where academic_year_id = $1 and half = 'first'`,
      [yearId],
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("非法学期标识与不存在的学年被拒绝，且不写入学期", async () => {
    const yearId = await academicYearIdOf(2026);

    const badHalf = await createTerm(yearId, "summer");
    expect(badHalf.status).toBe(400);
    expect(((await badHalf.json()) as { error: string }).error).toContain(
      "学期",
    );

    const missingYear = await createTerm(
      "00000000-0000-4000-8000-000000000000",
      "first",
    );
    expect(missingYear.status).toBe(400);
    expect(((await missingYear.json()) as { error: string }).error).toContain(
      "学年",
    );

    const badYearId = await createTerm("not-a-uuid", "second");
    expect(badYearId.status).toBe(400);

    const rows = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from terms",
    );
    expect(rows[0]!.count).toBe(2);
  });
});

async function createTerm(
  academicYearId: unknown,
  half: unknown,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "POST",
    "/api/admin/terms",
    { academicYearId, half },
    cookie,
  );
}

async function academicYearIdOf(startYear: number): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    app.schema!,
    "select id from academic_years where start_year = $1",
    [startYear],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`找不到学年：${startYear}`);
  return id;
}
