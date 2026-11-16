import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";
import { loginRequest } from "./support/login";

const COOKIE_NAME = "student_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

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

function sessionToken(response: Response): string {
  const pair = sessionCookie(response);
  return pair.startsWith(`${COOKIE_NAME}=`)
    ? pair.slice(COOKIE_NAME.length + 1)
    : "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

/** 登录逻辑集中在 tests/support/login.ts，这里只固定本文件的 baseUrl。 */
const login = (loginName: string, password: string, next?: string) =>
  loginRequest(app.baseUrl, { loginName, password, next });

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
 * 这是新账号进入正常可用状态的唯一公开路径。
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
  expect(String(firstLogin.body.redirectTo)).toContain("/change-password");

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

describe("账号与会话", () => {
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

  describe("账号创建与密码存储", () => {
    it("教务管理员创建账号后，密码以 Argon2id 哈希存储，响应不返回哈希", async () => {
      const response = await createAccount({
        loginName: "t9001",
        displayName: "教师张",
        role: "teacher",
        password: "初始密码1234",
      });

      expect(response.status).toBe(201);
      const raw = await response.text();
      expect(raw).not.toContain("$argon2");
      expect(raw).not.toContain("passwordHash");
      expect(raw).not.toContain("初始密码1234");

      const body = JSON.parse(raw) as {
        account: {
          loginName: string;
          displayName: string;
          role: string;
          mustChangePassword: boolean;
          disabled: boolean;
        };
      };
      expect(body.account).toMatchObject({
        loginName: "t9001",
        displayName: "教师张",
        role: "teacher",
        mustChangePassword: true,
        disabled: false,
      });
      expect(body.account).not.toHaveProperty("passwordHash");

      const rows = await queryRows<{ password_hash: string; role: string }>(
        app.schema!,
        "select password_hash, role from accounts where login_name = $1",
        ["t9001"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(rows[0]!.password_hash).not.toBe("初始密码1234");
      expect(rows[0]!.role).toBe("teacher");
    });

    it("登录名重复时返回可读的中文错误", async () => {
      const first = await createAccount({
        loginName: "t9002",
        displayName: "教师李",
        role: "teacher",
        password: "初始密码1234",
      });
      expect(first.status).toBe(201);

      const duplicate = await createAccount({
        loginName: "t9002",
        displayName: "教师李（重复）",
        role: "teacher",
        password: "另一组密码123",
      });

      expect(duplicate.status).toBe(409);
      const body = (await duplicate.json()) as { error: string };
      expect(body.error).toContain("登录名");
      expect(body.error).not.toContain("duplicate");
      expect(body.error).not.toContain("constraint");
    });

    it("非法角色与过短密码被拒绝，且不写入账号", async () => {
      const badRole = await api(
        "POST",
        "/api/admin/accounts",
        {
          loginName: "x9001",
          displayName: "未知角色",
          role: "principal",
          password: "初始密码1234",
        },
        adminCookie,
      );
      expect(badRole.status).toBe(400);

      const shortPassword = await createAccount({
        loginName: "x9002",
        displayName: "短密码",
        role: "student",
        password: "123",
      });
      expect(shortPassword.status).toBe(400);

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from accounts where login_name in ('x9001', 'x9002')",
      );
      expect(rows[0]!.count).toBe(0);
    });
  });

  describe("登录", () => {
    it("登录成功写入 HttpOnly、SameSite=Lax、生产环境 Secure 的会话 cookie", async () => {
      const result = await login(ADMIN_LOGIN, ADMIN_PASSWORD);

      expect(result.response.status).toBe(200);
      expect(result.body.redirectTo).toBe("/admin");

      const raw = result.response.headers.get("set-cookie") ?? "";
      expect(raw).toContain(`${COOKIE_NAME}=`);
      expect(raw).toContain("HttpOnly");
      expect(raw.toLowerCase()).toContain("samesite=lax");
      expect(raw).toContain("Secure");
      expect(raw).toContain("Path=/");
      expect(raw).toContain(`Max-Age=${SESSION_MAX_AGE}`);

      const token = sessionToken(result.response);
      expect(token.length).toBeGreaterThanOrEqual(32);

      // 会话数据不只在前端：数据库里有对应记录，且只存 token 的哈希。
      const rows = await queryRows<{ token_hash: string }>(
        app.schema!,
        "select token_hash from sessions where account_id = $1",
        [await accountIdOf(ADMIN_LOGIN)],
      );
      expect(rows.some((row) => row.token_hash === sha256(token))).toBe(true);
      expect(rows.some((row) => row.token_hash === token)).toBe(false);
      expect(sha256(token)).toHaveLength(64);
    });

    it("空密码、错误密码、不存在账号与已停用账号返回同一条失败提示", async () => {
      await createAccount({
        loginName: "s9101",
        displayName: "学生停用",
        role: "student",
        password: "初始密码1234",
      });
      const disable = await api(
        "PATCH",
        `/api/admin/accounts/${await accountIdOf("s9101")}`,
        { disabled: true },
        adminCookie,
      );
      expect(disable.status).toBe(200);

      const attempts = await Promise.all([
        login(ADMIN_LOGIN, ""),
        login(ADMIN_LOGIN, "错误密码123"),
        login("no_such_account", "随便什么密码"),
        login("s9101", "初始密码1234"),
      ]);

      for (const attempt of attempts) {
        expect(attempt.response.status).toBe(401);
        expect(attempt.body).toEqual({ error: "登录名或密码错误。" });
        expect(attempt.cookie).toBe("");
      }

      // 提示里不能出现「不存在」「停用」等能区分账号状态的词。
      const serialized = JSON.stringify(attempts.map((item) => item.body));
      expect(serialized).not.toContain("停用");
      expect(serialized).not.toContain("不存在");
    });

    it("三种角色登录后分别进入各自首页，账号管理页不回显密码哈希", async () => {
      await activateAccount({
        loginName: "t9115",
        displayName: "教师角色",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });
      await activateAccount({
        loginName: "s9116",
        displayName: "学生角色",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const teacher = await login("t9115", "新密码45678");
      expect(teacher.response.status).toBe(200);
      expect(teacher.body.redirectTo).toBe("/teacher");

      const student = await login("s9116", "新密码45678");
      expect(student.response.status).toBe(200);
      expect(student.body.redirectTo).toBe("/student");

      const admin = await page("/admin", adminCookie);
      expect(admin.status).toBe(200);
      const html = await admin.text();
      expect(html).toContain("账号管理");
      expect(html).not.toContain("$argon2");
      expect(html).not.toContain("password_hash");
    });

    it("登录后回到原目标页，非法 next 不会变成站外跳转", async () => {
      const targeted = await login(ADMIN_LOGIN, ADMIN_PASSWORD, "/admin?tab=accounts");
      expect(targeted.response.status).toBe(200);
      expect(targeted.body.redirectTo).toBe("/admin?tab=accounts");

      const external = await login(ADMIN_LOGIN, ADMIN_PASSWORD, "https://evil.example/x");
      expect(external.response.status).toBe(200);
      expect(external.body.redirectTo).toBe("/admin");
    });
  });

  describe("会话与受保护页面", () => {
    it("未登录访问受保护页面被带回登录页并记住原目标", async () => {
      const response = await page("/admin");
      expect([303, 307, 308]).toContain(response.status);
      expect(response.headers.get("location")).toBe("/login?next=%2Fadmin");

      const forged = await page("/admin", `${COOKIE_NAME}=forged-session-token`);
      expect([303, 307, 308]).toContain(forged.status);
      expect(forged.headers.get("location")).toBe("/login?next=%2Fadmin");
    });

    it("会话过期后访问受保护页面被带回登录页", async () => {
      const cookie = await activateAccount({
        loginName: "s9102",
        displayName: "学生乙",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      await queryRows(
        app.schema!,
        `update sessions set expires_at = now() - interval '1 second'
         where account_id = $1`,
        [await accountIdOf("s9102")],
      );

      const response = await page("/student", cookie);
      expect([303, 307, 308]).toContain(response.status);
      expect(response.headers.get("location")).toBe("/login?next=%2Fstudent");
    });

    it("退出登录后旧会话立即失效", async () => {
      const cookie = await activateAccount({
        loginName: "s9103",
        displayName: "学生丙",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const logout = await api("POST", "/api/auth/logout", undefined, cookie);
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

      const after = await page("/student", cookie);
      expect([303, 307, 308]).toContain(after.status);
      expect(after.headers.get("location")).toBe("/login?next=%2Fstudent");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from sessions where account_id = $1",
        [await accountIdOf("s9103")],
      );
      expect(rows[0]!.count).toBe(0);
    });
  });

  describe("强制改密", () => {
    it("新建账号登录后被引导到改密页，改密前除改密接口外一律不可访问", async () => {
      const created = await createAccount({
        loginName: "t9104",
        displayName: "教师丁",
        role: "teacher",
        password: "初始密码1234",
      });
      expect(created.status).toBe(201);

      const firstLogin = await login(
        "t9104",
        "初始密码1234",
        "/teacher?tab=courses",
      );
      expect(firstLogin.response.status).toBe(200);
      expect(firstLogin.body.redirectTo).toBe(
        "/change-password?next=%2Fteacher%3Ftab%3Dcourses",
      );

      const blockedPage = await page("/teacher", firstLogin.cookie);
      expect([303, 307, 308]).toContain(blockedPage.status);
      expect(blockedPage.headers.get("location")).toBe(
        "/change-password?next=%2Fteacher",
      );

      const blockedAdminPage = await page("/admin", firstLogin.cookie);
      expect([303, 307, 308]).toContain(blockedAdminPage.status);
      expect(blockedAdminPage.headers.get("location")).toBe(
        "/change-password?next=%2Fadmin",
      );

      const blockedApi = await api(
        "POST",
        "/api/admin/accounts",
        {
          loginName: "x9105",
          displayName: "不应创建",
          role: "student",
          password: "初始密码1234",
        },
        firstLogin.cookie,
      );
      expect(blockedApi.status).toBe(403);
      expect((await blockedApi.json()) as Json).toMatchObject({
        error: "请先修改初始密码。",
      });

      const wrongCurrent = await api(
        "POST",
        "/api/auth/password",
        { currentPassword: "不对的密码", newPassword: "新密码45678" },
        firstLogin.cookie,
      );
      expect(wrongCurrent.status).toBe(400);

      const stillBlocked = await page("/teacher", firstLogin.cookie);
      expect([303, 307, 308]).toContain(stillBlocked.status);

      const changed = await api(
        "POST",
        "/api/auth/password",
        {
          currentPassword: "初始密码1234",
          newPassword: "新密码45678",
          next: "/teacher?tab=courses",
        },
        firstLogin.cookie,
      );
      expect(changed.status).toBe(200);
      const changedBody = (await changed.json()) as { redirectTo: string };
      expect(changedBody.redirectTo).toBe("/teacher?tab=courses");

      const newCookie = sessionCookie(changed);
      expect(newCookie).not.toBe(firstLogin.cookie);

      // 改密会轮换会话：旧 cookie 立即失效。
      const oldCookie = await page("/teacher", firstLogin.cookie);
      expect([303, 307, 308]).toContain(oldCookie.status);

      const allowed = await page("/teacher", newCookie);
      expect(allowed.status).toBe(200);

      const oldPassword = await login("t9104", "初始密码1234");
      expect(oldPassword.response.status).toBe(401);

      const newPassword = await login("t9104", "新密码45678");
      expect(newPassword.response.status).toBe(200);
      expect(newPassword.body.redirectTo).toBe("/teacher");

      const raw = await (await page("/admin", newCookie)).text();
      expect(raw).not.toContain("$argon2");
    });

    it("新密码过短时拒绝改密，账号仍处于强制改密状态", async () => {
      const created = await createAccount({
        loginName: "s9106",
        displayName: "学生己",
        role: "student",
        password: "初始密码1234",
      });
      expect(created.status).toBe(201);

      const firstLogin = await login("s9106", "初始密码1234");
      expect(firstLogin.response.status).toBe(200);

      const short = await api(
        "POST",
        "/api/auth/password",
        { currentPassword: "初始密码1234", newPassword: "123" },
        firstLogin.cookie,
      );
      expect(short.status).toBe(400);
      expect(((await short.json()) as Json).error).toContain("密码");

      const response = await page("/student", firstLogin.cookie);
      expect([303, 307, 308]).toContain(response.status);
      expect(response.headers.get("location")).toBe(
        "/change-password?next=%2Fstudent",
      );
    });
  });

  describe("教务管理员重置密码", () => {
    it("重置后旧会话失效、旧密码不可用、该账号再次被要求改密", async () => {
      const oldCookie = await activateAccount({
        loginName: "t9107",
        displayName: "教师庚",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "旧密码45678",
      });

      const id = await accountIdOf("t9107");
      const reset = await api(
        "POST",
        `/api/admin/accounts/${id}/reset-password`,
        { newPassword: "重置密码7890" },
        adminCookie,
      );
      expect(reset.status).toBe(200);
      const raw = await reset.text();
      expect(raw).not.toContain("$argon2");
      expect(raw).not.toContain("重置密码7890");

      const kicked = await page("/teacher", oldCookie);
      expect([303, 307, 308]).toContain(kicked.status);
      expect(kicked.headers.get("location")).toBe("/login?next=%2Fteacher");

      const oldPassword = await login("t9107", "旧密码45678");
      expect(oldPassword.response.status).toBe(401);

      const resetLogin = await login("t9107", "重置密码7890");
      expect(resetLogin.response.status).toBe(200);
      expect(resetLogin.body.redirectTo).toBe("/change-password?next=%2Fteacher");

      const rows = await queryRows<{ must_change_password: boolean }>(
        app.schema!,
        "select must_change_password from accounts where id = $1",
        [id],
      );
      expect(rows[0]!.must_change_password).toBe(true);
    });

    it("非教务管理员不能重置密码", async () => {
      const teacherCookie = await activateAccount({
        loginName: "t9108",
        displayName: "教师辛",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const targetId = await accountIdOf("t9108");
      const response = await api(
        "POST",
        `/api/admin/accounts/${targetId}/reset-password`,
        { newPassword: "越权重置123" },
        teacherCookie,
      );

      expect(response.status).toBe(403);
      expect(((await response.json()) as Json).error).toBe("无权访问。");

      const stillWorks = await login("t9108", "新密码45678");
      expect(stillWorks.response.status).toBe(200);
    });

    it("重置不存在的账号返回 404", async () => {
      const response = await api(
        "POST",
        "/api/admin/accounts/00000000-0000-4000-8000-000000000000/reset-password",
        { newPassword: "重置密码7890" },
        adminCookie,
      );
      expect(response.status).toBe(404);
    });
  });

  describe("权限边界", () => {
    it("教师访问教务管理员页面返回 403，而不是仅前端隐藏", async () => {
      const teacherCookie = await activateAccount({
        loginName: "t9109",
        displayName: "教师子",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const response = await page("/admin", teacherCookie);
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("无权访问");
    });

    it("教师调用教务管理员接口返回 403", async () => {
      const teacherCookie = await activateAccount({
        loginName: "t9110",
        displayName: "教师丑",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const response = await api(
        "POST",
        "/api/admin/accounts",
        {
          loginName: "x9111",
          displayName: "不应创建",
          role: "student",
          password: "初始密码1234",
        },
        teacherCookie,
      );
      expect(response.status).toBe(403);

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from accounts where login_name = 'x9111'",
      );
      expect(rows[0]!.count).toBe(0);
    });

    it("学生不能访问教师页面，未登录调用接口返回 401", async () => {
      const studentCookie = await activateAccount({
        loginName: "s9112",
        displayName: "学生寅",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const response = await page("/teacher", studentCookie);
      expect(response.status).toBe(403);

      const anonymous = await api("POST", "/api/admin/accounts", {
        loginName: "x9113",
        displayName: "不应创建",
        role: "student",
        password: "初始密码1234",
      });
      expect(anonymous.status).toBe(401);
      expect(((await anonymous.json()) as Json).error).toBe("请先登录。");
    });
  });

  describe("停用账号", () => {
    it("停用后现有会话失效、无法登录；重新启用后可以登录", async () => {
      const cookie = await activateAccount({
        loginName: "s9114",
        displayName: "学生卯",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });
      const id = await accountIdOf("s9114");

      const disabled = await api(
        "PATCH",
        `/api/admin/accounts/${id}`,
        { disabled: true },
        adminCookie,
      );
      expect(disabled.status).toBe(200);
      expect(((await disabled.json()) as { account: Json }).account).toMatchObject({
        disabled: true,
      });

      const kicked = await page("/student", cookie);
      expect([303, 307, 308]).toContain(kicked.status);

      const blocked = await login("s9114", "新密码45678");
      expect(blocked.response.status).toBe(401);
      expect(blocked.body).toEqual({ error: "登录名或密码错误。" });

      const enabled = await api(
        "PATCH",
        `/api/admin/accounts/${id}`,
        { disabled: false },
        adminCookie,
      );
      expect(enabled.status).toBe(200);

      const allowed = await login("s9114", "新密码45678");
      expect(allowed.response.status).toBe(200);
    });
  });
});

async function accountIdOf(loginName: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    app.schema!,
    "select id from accounts where login_name = $1",
    [loginName],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`找不到账号：${loginName}`);
  return id;
}
