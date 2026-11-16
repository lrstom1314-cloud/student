import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const COOKIE_NAME = "student_session";

const ADMIN_LOGIN = "admin01";
const ADMIN_PASSWORD = "管理员密码123";

let app: TestApp;
let adminCookie = "";

type Json = Record<string, unknown>;

async function api(
  method: "GET" | "POST" | "PATCH",
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

function bootstrapAdmin(loginName: string, password: string): void {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/create-account.mjs"),
      "--login",
      loginName,
      "--name",
      "教务甲",
      "--role",
      "administrator",
      "--password",
      password,
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
      `创建初始教务管理员失败（exit=${result.status}）。\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

async function login(
  loginName: string,
  password: string,
): Promise<{ response: Response; body: Json; cookie: string }> {
  const response = await api("POST", "/api/auth/login", {
    loginName,
    password,
  });
  const body = (await response.json()) as Json;
  return { response, body, cookie: sessionCookie(response) };
}

async function createAccount(input: {
  loginName: string;
  displayName: string;
  role: "student" | "teacher" | "administrator";
  password: string;
}): Promise<Response> {
  return api("POST", "/api/admin/accounts", input, adminCookie);
}

/**
 * 走一遍「管理员建号 → 首登 → 强制改密」，返回改密后的可用会话。
 */
async function activateAccount(input: {
  loginName: string;
  displayName: string;
  role: "student" | "teacher" | "administrator";
  initialPassword: string;
  newPassword: string;
}): Promise<string> {
  const created = await createAccount({
    loginName: input.loginName,
    displayName: input.displayName,
    role: input.role,
    password: input.initialPassword,
  });
  expect(created.status).toBe(201);

  const firstLogin = await login(input.loginName, input.initialPassword);
  expect(firstLogin.response.status).toBe(200);

  const changed = await api(
    "POST",
    "/api/auth/password",
    {
      currentPassword: input.initialPassword,
      newPassword: input.newPassword,
    },
    firstLogin.cookie,
  );
  expect(changed.status).toBe(200);

  return sessionCookie(changed);
}

async function createAdministrativeClass(
  name: string,
): Promise<{ id: string; name: string }> {
  const response = await api(
    "POST",
    "/api/admin/administrative-classes",
    { name },
    adminCookie,
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    administrativeClass: { id: string; name: string };
  };
  return body.administrativeClass;
}

async function createStudent(input: {
  studentNumber: string;
  name: string;
  administrativeClassId: string;
  enrollmentStatus?: string;
  initialPassword?: string;
}): Promise<Response> {
  return api("POST", "/api/admin/students", input, adminCookie);
}

describe("行政班与学生", () => {
  beforeAll(async () => {
    app = await startTestApp();
    bootstrapAdmin(ADMIN_LOGIN, ADMIN_PASSWORD);

    const loginResult = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
    expect(loginResult.response.status).toBe(200);
    adminCookie = loginResult.cookie;
  }, 120_000);

  afterAll(async () => {
    await app.stop();
  });

  describe("行政班", () => {
    it("教务管理员可以创建与重命名行政班，名称可含年级", async () => {
      const created = await api(
        "POST",
        "/api/admin/administrative-classes",
        { name: "高二 3 班" },
        adminCookie,
      );
      expect(created.status).toBe(201);

      const createdBody = (await created.json()) as {
        administrativeClass: { id: string; name: string };
      };
      expect(createdBody.administrativeClass.name).toBe("高二 3 班");

      const renamed = await api(
        "PATCH",
        `/api/admin/administrative-classes/${createdBody.administrativeClass.id}`,
        { name: "高三 3 班" },
        adminCookie,
      );
      expect(renamed.status).toBe(200);
      const renamedBody = (await renamed.json()) as {
        administrativeClass: { id: string; name: string };
      };
      expect(renamedBody.administrativeClass).toEqual({
        id: createdBody.administrativeClass.id,
        name: "高三 3 班",
      });

      const rows = await queryRows<{ name: string }>(
        app.schema!,
        "select name from administrative_classes where id = $1",
        [createdBody.administrativeClass.id],
      );
      expect(rows[0]!.name).toBe("高三 3 班");
    });

    it("名称为空或重名时返回可读的中文错误", async () => {
      const empty = await api(
        "POST",
        "/api/admin/administrative-classes",
        { name: "   " },
        adminCookie,
      );
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as Json).error).toContain("行政班名称");

      await createAdministrativeClass("高一 1 班");
      const duplicate = await api(
        "POST",
        "/api/admin/administrative-classes",
        { name: "高一 1 班" },
        adminCookie,
      );
      expect(duplicate.status).toBe(409);
      const error = ((await duplicate.json()) as Json).error;
      expect(error).toContain("行政班名称");
      expect(String(error)).not.toContain("duplicate");
      expect(String(error)).not.toContain("constraint");
    });
  });
});
