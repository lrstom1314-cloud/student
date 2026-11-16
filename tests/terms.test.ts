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
});
