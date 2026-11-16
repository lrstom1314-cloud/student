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

async function createStudent(input: Record<string, unknown>): Promise<Response> {
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

  describe("新建学生", () => {
    it("建学生时同步建账号：登录名即学号、角色为学生、首登强制改密", async () => {
      const administrativeClass = await createAdministrativeClass("高一 2 班");

      const response = await createStudent({
        studentNumber: "s2025001",
        name: "张三",
        administrativeClassId: administrativeClass.id,
        enrollmentStatus: "enrolled",
        initialPassword: "初始密码1234",
      });

      expect(response.status).toBe(201);
      const raw = await response.text();
      expect(raw).not.toContain("$argon2");
      expect(raw).not.toContain("初始密码1234");

      const body = JSON.parse(raw) as {
        student: {
          id: string;
          studentNumber: string;
          name: string;
          enrollmentStatus: string;
          administrativeClass: { id: string; name: string };
        };
      };
      expect(body.student).toMatchObject({
        studentNumber: "s2025001",
        name: "张三",
        enrollmentStatus: "enrolled",
        administrativeClass: { id: administrativeClass.id, name: "高一 2 班" },
      });

      const rows = await queryRows<{
        role: string;
        must_change_password: boolean;
        password_hash: string;
        account_id: string;
        student_account_id: string;
      }>(
        app.schema!,
        `select a.role, a.must_change_password, a.password_hash, a.id as account_id,
                s.account_id as student_account_id
         from students s join accounts a on a.id = s.account_id
         where s.student_number = $1`,
        ["s2025001"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.role).toBe("student");
      expect(rows[0]!.must_change_password).toBe(true);
      expect(rows[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(rows[0]!.student_account_id).toBe(rows[0]!.account_id);

      const firstLogin = await login("s2025001", "初始密码1234");
      expect(firstLogin.response.status).toBe(200);
      expect(String(firstLogin.body.redirectTo)).toContain("/change-password");
    });

    it("学号重复时返回可读错误，且不产生第二个学生或账号", async () => {
      const administrativeClass = await createAdministrativeClass("高一 4 班");
      const first = await createStudent({
        studentNumber: "s2025010",
        name: "重复甲",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      expect(first.status).toBe(201);

      const duplicate = await createStudent({
        studentNumber: "s2025010",
        name: "重复乙",
        administrativeClassId: administrativeClass.id,
        initialPassword: "另一组密码123",
      });

      expect(duplicate.status).toBe(409);
      const error = ((await duplicate.json()) as Json).error;
      expect(error).toContain("学号");
      expect(String(error)).not.toContain("duplicate");
      expect(String(error)).not.toContain("constraint");

      const students = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from students where student_number = $1",
        ["s2025010"],
      );
      expect(students[0]!.count).toBe(1);

      const accounts = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from accounts where login_name = $1",
        ["s2025010"],
      );
      expect(accounts[0]!.count).toBe(1);

      const nameRows = await queryRows<{ name: string }>(
        app.schema!,
        "select name from students where student_number = $1",
        ["s2025010"],
      );
      expect(nameRows[0]!.name).toBe("重复甲");
    });

    it("学号已有学生账号时只建立关联，不改动其密码", async () => {
      // 先用 #3 的账号接口预建同名账号，并走完首登改密。
      const activatedCookie = await activateAccount({
        loginName: "s2025020",
        displayName: "李四",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "已改密码45678",
      });
      expect(activatedCookie).not.toBe("");

      const administrativeClass = await createAdministrativeClass("高一 5 班");

      const response = await createStudent({
        studentNumber: "s2025020",
        name: "李四",
        administrativeClassId: administrativeClass.id,
        initialPassword: "不该生效的密码123",
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        student: { studentNumber: string; enrollmentStatus: string };
      };
      expect(body.student).toMatchObject({
        studentNumber: "s2025020",
        enrollmentStatus: "enrolled",
      });

      const accounts = await queryRows<{ count: number; must_change_password: boolean }>(
        app.schema!,
        `select count(*)::int as count,
                bool_and(must_change_password) as must_change_password
         from accounts where login_name = $1`,
        ["s2025020"],
      );
      expect(accounts[0]!.count).toBe(1);
      expect(accounts[0]!.must_change_password).toBe(false);

      const oldPassword = await login("s2025020", "已改密码45678");
      expect(oldPassword.response.status).toBe(200);
      expect(oldPassword.body.redirectTo).toBe("/student");

      const ignoredPassword = await login("s2025020", "不该生效的密码");
      expect(ignoredPassword.response.status).toBe(401);
    });

    it("账号不存在时未设置初始密码、行政班不存在、学籍状态非法均返回可读错误", async () => {
      const administrativeClass = await createAdministrativeClass("高一 6 班");

      const missingPassword = await createStudent({
        studentNumber: "s2025030",
        name: "缺密码",
        administrativeClassId: administrativeClass.id,
      });
      expect(missingPassword.status).toBe(400);
      expect(((await missingPassword.json()) as Json).error).toContain("初始密码");

      const missingClass = await createStudent({
        studentNumber: "s2025031",
        name: "缺行政班",
        administrativeClassId: "00000000-0000-4000-8000-000000000000",
        initialPassword: "初始密码1234",
      });
      expect(missingClass.status).toBe(400);
      expect(((await missingClass.json()) as Json).error).toContain("行政班");

      const badStatus = await createStudent({
        studentNumber: "s2025032",
        name: "状态非法",
        administrativeClassId: administrativeClass.id,
        enrollmentStatus: "退学",
        initialPassword: "初始密码1234",
      });
      expect(badStatus.status).toBe(400);
      expect(((await badStatus.json()) as Json).error).toContain("学籍状态");

      // 同名登录名已是教师账号：不能把教师账号当成学生关联。
      await createAccount({
        loginName: "t2025033",
        displayName: "教师占号",
        role: "teacher",
        password: "初始密码1234",
      });
      const roleConflict = await createStudent({
        studentNumber: "t2025033",
        name: "冒名学生",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      expect(roleConflict.status).toBe(409);
      expect(((await roleConflict.json()) as Json).error).toContain("账号");

      const students = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from students where student_number in ('s2025030', 's2025031', 's2025032', 't2025033')",
      );
      expect(students[0]!.count).toBe(0);
    });

    it("不收集身份证号、手机号、生日等敏感字段", async () => {
      const administrativeClass = await createAdministrativeClass("高一 7 班");

      const response = await createStudent({
        studentNumber: "s2025040",
        name: "王五",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
        idCard: "110101200001011234",
        phone: "13800000000",
        birthday: "2000-01-01",
      });
      expect(response.status).toBe(201);

      const raw = await response.text();
      expect(raw).not.toContain("110101200001011234");
      expect(raw).not.toContain("13800000000");
      expect(raw).not.toContain("2000-01-01");

      const columns = await queryRows<{ column_name: string }>(
        app.schema!,
        `select column_name from information_schema.columns
         where table_schema = $1 and table_name = 'students'
         order by column_name`,
        [app.schema!],
      );
      const names = columns.map((column) => column.column_name);
      expect(names).toEqual([
        "account_id",
        "administrative_class_id",
        "created_at",
        "enrollment_status",
        "id",
        "name",
        "student_number",
        "updated_at",
      ]);
    });
  });

  describe("转班、学籍状态与名单", () => {
    it("按行政班浏览学生名单，能看到每人当前学籍状态", async () => {
      const classA = await createAdministrativeClass("高二 1 班");
      const classB = await createAdministrativeClass("高二 2 班");

      await createStudent({
        studentNumber: "s2025101",
        name: "名单甲",
        administrativeClassId: classA.id,
        enrollmentStatus: "enrolled",
        initialPassword: "初始密码1234",
      });
      await createStudent({
        studentNumber: "s2025102",
        name: "名单乙",
        administrativeClassId: classA.id,
        enrollmentStatus: "suspended",
        initialPassword: "初始密码1234",
      });
      await createStudent({
        studentNumber: "s2025103",
        name: "名单丙",
        administrativeClassId: classB.id,
        enrollmentStatus: "graduated",
        initialPassword: "初始密码1234",
      });

      const response = await api(
        "GET",
        `/api/admin/students?administrativeClassId=${classA.id}`,
        undefined,
        adminCookie,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        students: Array<{
          studentNumber: string;
          name: string;
          enrollmentStatus: string;
          administrativeClass: { id: string; name: string };
        }>;
      };

      expect(body.students.map((student) => student.studentNumber)).toEqual([
        "s2025101",
        "s2025102",
      ]);
      expect(body.students[0]).toMatchObject({
        name: "名单甲",
        enrollmentStatus: "enrolled",
        administrativeClass: { id: classA.id, name: "高二 1 班" },
      });
      expect(body.students[1]!.enrollmentStatus).toBe("suspended");

      const all = await api("GET", "/api/admin/students", undefined, adminCookie);
      expect(all.status).toBe(200);
      const allBody = (await all.json()) as {
        students: Array<{ studentNumber: string }>;
      };
      expect(allBody.students.map((student) => student.studentNumber)).toEqual(
        expect.arrayContaining(["s2025101", "s2025102", "s2025103"]),
      );
    });

    it("把学生转到另一行政班后，归属立即更新", async () => {
      const classA = await createAdministrativeClass("高二 3 班");
      const classB = await createAdministrativeClass("高二 4 班");
      const created = await createStudent({
        studentNumber: "s2025111",
        name: "转班生",
        administrativeClassId: classA.id,
        initialPassword: "初始密码1234",
      });
      expect(created.status).toBe(201);
      const studentId = ((await created.json()) as { student: { id: string } })
        .student.id;

      const moved = await api(
        "PATCH",
        `/api/admin/students/${studentId}`,
        { administrativeClassId: classB.id },
        adminCookie,
      );
      expect(moved.status).toBe(200);
      expect(
        ((await moved.json()) as {
          student: { administrativeClass: { id: string; name: string } };
        }).student.administrativeClass,
      ).toEqual({ id: classB.id, name: "高二 4 班" });

      const source = await api(
        "GET",
        `/api/admin/students?administrativeClassId=${classA.id}`,
        undefined,
        adminCookie,
      );
      const sourceBody = (await source.json()) as {
        students: Array<{ studentNumber: string }>;
      };
      expect(
        sourceBody.students.some(
          (student) => student.studentNumber === "s2025111",
        ),
      ).toBe(false);

      const target = await api(
        "GET",
        `/api/admin/students?administrativeClassId=${classB.id}`,
        undefined,
        adminCookie,
      );
      const targetBody = (await target.json()) as {
        students: Array<{
          studentNumber: string;
          administrativeClass: { id: string };
        }>;
      };
      expect(targetBody.students).toEqual([
        expect.objectContaining({
          studentNumber: "s2025111",
          administrativeClass: expect.objectContaining({ id: classB.id }),
        }),
      ]);
    });

    it("学籍状态可在在读、休学、转出、毕业之间调整", async () => {
      const administrativeClass = await createAdministrativeClass("高二 5 班");
      const created = await createStudent({
        studentNumber: "s2025121",
        name: "状态生",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      const studentId = ((await created.json()) as { student: { id: string } })
        .student.id;

      for (const status of ["suspended", "transferred", "graduated", "enrolled"]) {
        const response = await api(
          "PATCH",
          `/api/admin/students/${studentId}`,
          { enrollmentStatus: status },
          adminCookie,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          student: { enrollmentStatus: string };
        };
        expect(body.student.enrollmentStatus).toBe(status);

        const rows = await queryRows<{ enrollment_status: string }>(
          app.schema!,
          "select enrollment_status from students where id = $1",
          [studentId],
        );
        expect(rows[0]!.enrollment_status).toBe(status);
      }

      const invalid = await api(
        "PATCH",
        `/api/admin/students/${studentId}`,
        { enrollmentStatus: "退学" },
        adminCookie,
      );
      expect(invalid.status).toBe(400);
      expect(((await invalid.json()) as Json).error).toContain("学籍状态");
    });

    it("转到不存在的行政班、修改不存在的学生返回可读错误", async () => {
      const administrativeClass = await createAdministrativeClass("高二 6 班");
      const created = await createStudent({
        studentNumber: "s2025131",
        name: "边界生",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      const studentId = ((await created.json()) as { student: { id: string } })
        .student.id;

      const missingClass = await api(
        "PATCH",
        `/api/admin/students/${studentId}`,
        { administrativeClassId: "00000000-0000-4000-8000-000000000000" },
        adminCookie,
      );
      expect(missingClass.status).toBe(400);
      expect(((await missingClass.json()) as Json).error).toContain("行政班");

      const missingStudent = await api(
        "PATCH",
        "/api/admin/students/00000000-0000-4000-8000-000000000000",
        { enrollmentStatus: "suspended" },
        adminCookie,
      );
      expect(missingStudent.status).toBe(404);
      expect(((await missingStudent.json()) as Json).error).toContain("学生");
    });
  });

  describe("学籍状态与登录", () => {
    it("非在读学生登录被拒绝，提示不泄露具体学籍状态", async () => {
      const administrativeClass = await createAdministrativeClass("高三 1 班");
      const cases = [
        { studentNumber: "s2025201", name: "休学生", status: "suspended", word: "休学" },
        { studentNumber: "s2025202", name: "转出生", status: "transferred", word: "转出" },
        { studentNumber: "s2025203", name: "毕业生", status: "graduated", word: "毕业" },
      ];

      for (const item of cases) {
        const created = await createStudent({
          studentNumber: item.studentNumber,
          name: item.name,
          administrativeClassId: administrativeClass.id,
          enrollmentStatus: item.status,
          initialPassword: "初始密码1234",
        });
        expect(created.status).toBe(201);
      }

      for (const item of cases) {
        const attempt = await login(item.studentNumber, "初始密码1234");
        expect(attempt.response.status).toBe(401);
        expect(attempt.body).toEqual({ error: "登录名或密码错误。" });
        expect(attempt.cookie).toBe("");
        expect(JSON.stringify(attempt.body)).not.toContain(item.word);
      }

      // 提示不能区分原因：与密码错误、账号不存在完全一致。
      const wrongPassword = await login("s2025201", "错误密码123");
      expect(wrongPassword.body).toEqual({ error: "登录名或密码错误。" });
      const missing = await login("s2025299", "初始密码1234");
      expect(missing.body).toEqual({ error: "登录名或密码错误。" });
    });

    it("在读学生可以登录", async () => {
      const administrativeClass = await createAdministrativeClass("高三 2 班");
      const created = await createStudent({
        studentNumber: "s2025210",
        name: "在读生",
        administrativeClassId: administrativeClass.id,
        enrollmentStatus: "enrolled",
        initialPassword: "初始密码1234",
      });
      expect(created.status).toBe(201);

      const attempt = await login("s2025210", "初始密码1234");
      expect(attempt.response.status).toBe(200);
      expect(attempt.body.redirectTo).toBe(
        "/change-password?next=%2Fstudent",
      );
    });

    it("学籍状态改为非在读后，已登录的会话立即失效", async () => {
      const administrativeClass = await createAdministrativeClass("高三 6 班");
      const created = await createStudent({
        studentNumber: "s2025220",
        name: "会话生",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      const studentId = ((await created.json()) as { student: { id: string } })
        .student.id;
      expect(created.status).toBe(201);

      const firstLogin = await login("s2025220", "初始密码1234");
      const changed = await api(
        "POST",
        "/api/auth/password",
        { currentPassword: "初始密码1234", newPassword: "新密码45678" },
        firstLogin.cookie,
      );
      expect(changed.status).toBe(200);
      const cookie = sessionCookie(changed);

      const allowed = await page("/student", cookie);
      expect(allowed.status).toBe(200);

      const suspended = await api(
        "PATCH",
        `/api/admin/students/${studentId}`,
        { enrollmentStatus: "suspended" },
        adminCookie,
      );
      expect(suspended.status).toBe(200);

      const blockedPage = await page("/student", cookie);
      expect([303, 307, 308]).toContain(blockedPage.status);
      expect(blockedPage.headers.get("location")).toBe("/login?next=%2Fstudent");

      const blockedLogin = await login("s2025220", "新密码45678");
      expect(blockedLogin.response.status).toBe(401);
      expect(blockedLogin.body).toEqual({ error: "登录名或密码错误。" });

      // 恢复在读后可以重新登录。
      const restored = await api(
        "PATCH",
        `/api/admin/students/${studentId}`,
        { enrollmentStatus: "enrolled" },
        adminCookie,
      );
      expect(restored.status).toBe(200);
      const allowedAgain = await login("s2025220", "新密码45678");
      expect(allowedAgain.response.status).toBe(200);
    });

    it("尚未建立学籍的学生账号仍可登录（保持 #3 行为）", async () => {
      const cookie = await activateAccount({
        loginName: "s2025230",
        displayName: "无学籍学生",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });
      expect(cookie).not.toBe("");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from students where student_number = 's2025230'",
      );
      expect(rows[0]!.count).toBe(0);

      const attempt = await login("s2025230", "新密码45678");
      expect(attempt.response.status).toBe(200);
      expect(attempt.body.redirectTo).toBe("/student");
    });
  });

  describe("权限边界", () => {
    it("教师与学生访问学籍相关接口一律返回 403，且数据不被改动", async () => {
      const teacherCookie = await activateAccount({
        loginName: "t9301",
        displayName: "教师权限",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });
      const studentCookie = await activateAccount({
        loginName: "s9302",
        displayName: "学生权限",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      const administrativeClass = await createAdministrativeClass("高三 7 班");
      const created = await createStudent({
        studentNumber: "s9303",
        name: "受保护学生",
        administrativeClassId: administrativeClass.id,
        initialPassword: "初始密码1234",
      });
      const studentId = ((await created.json()) as { student: { id: string } })
        .student.id;

      for (const cookie of [teacherCookie, studentCookie]) {
        const attempts: Array<[string, string, Json | undefined]> = [
          ["GET", "/api/admin/students", undefined],
          [
            "POST",
            "/api/admin/students",
            {
              studentNumber: "s9304",
              name: "越权建学生",
              administrativeClassId: administrativeClass.id,
              initialPassword: "初始密码1234",
            },
          ],
          [
            "PATCH",
            `/api/admin/students/${studentId}`,
            { enrollmentStatus: "graduated" },
          ],
          ["GET", "/api/admin/administrative-classes", undefined],
          [
            "POST",
            "/api/admin/administrative-classes",
            { name: "越权行政班" },
          ],
          [
            "PATCH",
            `/api/admin/administrative-classes/${administrativeClass.id}`,
            { name: "越权改名" },
          ],
        ];

        for (const [method, route, body] of attempts) {
          const response = await api(method as "GET", route, body, cookie);
          expect(response.status).toBe(403);
          expect(((await response.json()) as Json).error).toBe("无权访问。");
        }
      }

      // 越权请求必须在服务端被拒绝，数据保持原样。
      const students = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from students where student_number = 's9304'",
      );
      expect(students[0]!.count).toBe(0);

      const status = await queryRows<{ enrollment_status: string }>(
        app.schema!,
        "select enrollment_status from students where id = $1",
        [studentId],
      );
      expect(status[0]!.enrollment_status).toBe("enrolled");

      const classes = await queryRows<{ name: string }>(
        app.schema!,
        "select name from administrative_classes where id = $1",
        [administrativeClass.id],
      );
      expect(classes[0]!.name).toBe("高三 7 班");
    });

    it("未登录访问学籍接口返回 401", async () => {
      const response = await api("GET", "/api/admin/students");
      expect(response.status).toBe(401);
      expect(((await response.json()) as Json).error).toBe("请先登录。");
    });
  });

  describe("学籍管理页面", () => {
    it("教务管理员可按行政班浏览名单，并看到每人的学籍状态", async () => {
      const administrativeClass = await createAdministrativeClass("高三 8 班");
      const created = await createStudent({
        studentNumber: "s9401",
        name: "页面生",
        administrativeClassId: administrativeClass.id,
        enrollmentStatus: "suspended",
        initialPassword: "初始密码1234",
      });
      expect(created.status).toBe(201);

      const response = await page("/admin/students", adminCookie);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("学籍管理");
      expect(html).toContain("行政班");
      expect(html).toContain("学号");
      expect(html).toContain("学籍状态");
      expect(html).toContain("高三 8 班");
      expect(html).toContain("页面生");
      expect(html).toContain("休学");
      expect(html).not.toContain("$argon2");

      const filtered = await page(
        `/admin/students?administrativeClassId=${administrativeClass.id}`,
        adminCookie,
      );
      expect(filtered.status).toBe(200);
      const filteredHtml = await filtered.text();
      expect(filteredHtml).toContain("页面生");
      expect(filteredHtml).toContain("休学");
    });

    it("教师与学生访问学籍管理页面返回 403", async () => {
      const teacherCookie = await activateAccount({
        loginName: "t9411",
        displayName: "教师页面",
        role: "teacher",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });
      const studentCookie = await activateAccount({
        loginName: "s9412",
        displayName: "学生页面",
        role: "student",
        initialPassword: "初始密码1234",
        newPassword: "新密码45678",
      });

      for (const cookie of [teacherCookie, studentCookie]) {
        const response = await page("/admin/students", cookie);
        expect(response.status).toBe(403);
        expect(await response.text()).toContain("无权访问");
      }

      const anonymous = await page("/admin/students");
      expect([303, 307, 308]).toContain(anonymous.status);
      expect(anonymous.headers.get("location")).toBe(
        "/login?next=%2Fadmin%2Fstudents",
      );
    });
  });
});
