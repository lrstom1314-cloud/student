import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";
import { loginRequest } from "./support/login";

const ADMIN_LOGIN = "import-admin";
const ADMIN_PASSWORD = "管理员密码123";

let app: TestApp;
let adminCookie = "";

type Json = Record<string, unknown>;

type ImportRow = {
  line: number;
  studentNumber: string;
  name: string;
  status: "created" | "updated" | "error";
  message?: string;
  initialPassword?: string;
};

type ImportBody = {
  created: number;
  updated: number;
  failed: number;
  rows: ImportRow[];
};

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
const login = (loginName: string, password: string) =>
  loginRequest(app.baseUrl, { loginName, password });

async function activateAccount(input: {
  loginName: string;
  displayName: string;
  role: "student" | "teacher";
  initialPassword: string;
  newPassword: string;
}): Promise<string> {
  const created = await api(
    "POST",
    "/api/admin/accounts",
    {
      loginName: input.loginName,
      displayName: input.displayName,
      role: input.role,
      password: input.initialPassword,
    },
    adminCookie,
  );
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

/** 以浏览器上传表单的方式提交一份 CSV。 */
async function importCsv(
  csv: string,
  cookie: string = adminCookie,
  filename = "students.csv",
): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([csv], filename, { type: "text/csv" }));
  return fetch(`${app.baseUrl}/api/admin/students/import`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: form,
    redirect: "manual",
  });
}

async function importBody(response: Response): Promise<ImportBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as ImportBody;
}

function rowFor(body: ImportBody, studentNumber: string): ImportRow {
  const row = body.rows.find((item) => item.studentNumber === studentNumber);
  if (!row) {
    throw new Error(`导入结果中没有学号 ${studentNumber}`);
  }
  return row;
}

describe("CSV 批量导入学生", () => {
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

  it("上传含 BOM、CRLF、引号内逗号与额外列的 CSV 后建立学生，名单在学籍页面立即可见", async () => {
    await createAdministrativeClass("高二 1 班");

    const csv =
      "\uFEFF姓名,学号,行政班名称,学籍状态,备注\r\n" +
      '"张三,甲",s2026001,高二 1 班,在读,"由教育局转入"\r\n' +
      "李四,s2026002,高二 1 班,休学,\r\n";

    const response = await importCsv(csv);
    const body = await importBody(response);

    expect(body).toMatchObject({ created: 2, updated: 0, failed: 0 });
    expect(body.rows).toHaveLength(2);

    const zhang = rowFor(body, "s2026001");
    expect(zhang).toMatchObject({
      line: 2,
      name: "张三,甲",
      status: "created",
    });
    expect(zhang.initialPassword).toMatch(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12}$/,
    );

    const li = rowFor(body, "s2026002");
    expect(li).toMatchObject({ line: 3, name: "李四", status: "created" });
    expect(li.initialPassword).toMatch(/^.{12}$/);
    expect(li.initialPassword).not.toBe(zhang.initialPassword);

    const students = await queryRows<{
      student_number: string;
      name: string;
      enrollment_status: string;
      class_name: string;
    }>(
      app.schema!,
      `select s.student_number, s.name, s.enrollment_status, c.name as class_name
       from students s join administrative_classes c on c.id = s.administrative_class_id
       where s.student_number in ('s2026001', 's2026002')
       order by s.student_number`,
    );
    expect(students).toEqual([
      {
        student_number: "s2026001",
        name: "张三,甲",
        enrollment_status: "enrolled",
        class_name: "高二 1 班",
      },
      {
        student_number: "s2026002",
        name: "李四",
        enrollment_status: "suspended",
        class_name: "高二 1 班",
      },
    ]);

    // 返回的初始密码就是真实可用的密码，且首登强制改密。
    const zhangLogin = await login("s2026001", zhang.initialPassword!);
    expect(zhangLogin.response.status).toBe(200);
    expect(String(zhangLogin.body.redirectTo)).toContain("/change-password");

    const pageResponse = await page("/admin/students", adminCookie);
    expect(pageResponse.status).toBe(200);
    const html = await pageResponse.text();
    expect(html).toContain("张三,甲");
    expect(html).toContain("李四");
    expect(html).toContain("高二 1 班");
    expect(html).toContain("休学");
    expect(html).not.toContain("$argon2");
    expect(html).not.toContain(zhang.initialPassword!);
  });

  it("重复上传同一份名单时以学号为键更新，不新建学生也不改动密码", async () => {
    const classA = await createAdministrativeClass("高二 2 班");
    const classB = await createAdministrativeClass("高二 3 班");

    const first = await importBody(
      await importCsv(
        "学号,姓名,行政班,学籍状态\r\ns2026010,原名生,高二 2 班,在读\r\n",
      ),
    );
    const createdRow = rowFor(first, "s2026010");
    expect(createdRow.status).toBe("created");
    const originalPassword = createdRow.initialPassword!;
    expect(originalPassword).toBeTruthy();

    const firstLogin = await login("s2026010", originalPassword);
    expect(firstLogin.response.status).toBe(200);
    expect(String(firstLogin.body.redirectTo)).toContain("/change-password");

    const before = await queryRows<{
      student_id: string;
      password_hash: string;
      must_change_password: boolean;
    }>(
      app.schema!,
      `select s.id as student_id, a.password_hash, a.must_change_password
       from students s join accounts a on a.id = s.account_id
       where s.student_number = 's2026010'`,
    );

    const second = await importBody(
      await importCsv(
        "学号,姓名,行政班,学籍状态\r\ns2026010,改名生,高二 3 班,休学\r\n",
      ),
    );
    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const updatedRow = rowFor(second, "s2026010");
    expect(updatedRow.status).toBe("updated");
    expect(updatedRow.initialPassword).toBeUndefined();

    const after = await queryRows<{
      student_id: string;
      name: string;
      enrollment_status: string;
      class_id: string;
      class_name: string;
      password_hash: string;
      must_change_password: boolean;
    }>(
      app.schema!,
      `select s.id as student_id, s.name, s.enrollment_status,
              s.administrative_class_id as class_id, c.name as class_name,
              a.password_hash, a.must_change_password
       from students s
       join administrative_classes c on c.id = s.administrative_class_id
       join accounts a on a.id = s.account_id
       where s.student_number = 's2026010'`,
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      student_id: before[0]!.student_id,
      name: "改名生",
      enrollment_status: "suspended",
      class_id: classB.id,
      class_name: "高二 3 班",
      password_hash: before[0]!.password_hash,
      must_change_password: before[0]!.must_change_password,
    });
    expect(after[0]!.class_id).not.toBe(classA.id);

    // 休学后按学籍状态规则不能登录：说明状态更新确实生效了。
    const blockedLogin = await login("s2026010", originalPassword);
    expect(blockedLogin.response.status).toBe(401);

    const pageResponse = await page("/admin/students", adminCookie);
    const html = await pageResponse.text();
    expect(html).toContain("改名生");
    expect(html).toContain("高二 3 班");
    expect(html).toContain("休学");
    expect(html).not.toContain("原名生");
  });

  it("逐行处理：单行失败不影响其它行，错误含行号，行政班不存在时绝不自动创建", async () => {
    await createAdministrativeClass("高二 5 班");

    const csv = [
      "学号,姓名,行政班,学籍状态",
      "s2026101,王五,高二 5 班,在读",
      "s2026102,赵六,不存在的班,在读",
      "s2026103,钱七,高二 5 班,退学",
      "s2026105,空行前生,高二 5 班,在读",
      ",吴十,高二 5 班,在读",
      "s2026104,孙八,高二 5 班,在读",
      "",
      "s2026104,周九,高二 5 班,在读",
    ].join("\r\n");

    const body = await importBody(await importCsv(csv));
    expect(body).toMatchObject({ created: 2, updated: 0, failed: 5 });

    expect(rowFor(body, "s2026101")).toMatchObject({
      line: 2,
      status: "created",
    });
    expect(rowFor(body, "s2026105")).toMatchObject({
      line: 5,
      status: "created",
    });

    const missingClass = rowFor(body, "s2026102");
    expect(missingClass).toMatchObject({ line: 3, status: "error" });
    expect(missingClass.message).toContain("第 3 行");
    expect(missingClass.message).toContain("行政班「不存在的班」不存在");

    const badStatus = rowFor(body, "s2026103");
    expect(badStatus).toMatchObject({ line: 4, status: "error" });
    expect(badStatus.message).toContain("第 4 行");
    expect(badStatus.message).toContain("学籍状态");
    expect(badStatus.message).toContain("休学");
    expect(badStatus.message).toContain("毕业");

    const blankNumber = body.rows.find((row) => row.line === 6)!;
    expect(blankNumber.status).toBe("error");
    expect(blankNumber.message).toContain("第 6 行");
    expect(blankNumber.message).toContain("学号");

    // 同一文件内重复学号：两行都判错，且该学号完全没有落库（不产生半截数据）。
    const duplicateFirst = body.rows.find((row) => row.line === 7)!;
    const duplicateSecond = body.rows.find((row) => row.line === 9)!;
    expect(duplicateFirst.status).toBe("error");
    expect(duplicateSecond.status).toBe("error");
    expect(duplicateFirst.message).toContain("第 7 行");
    expect(duplicateFirst.message).toContain("重复出现");
    expect(duplicateFirst.message).toContain("第 7、9 行");
    expect(duplicateSecond.message).toContain("第 9 行");

    const created = await queryRows<{ student_number: string }>(
      app.schema!,
      `select student_number from students
       where student_number in ('s2026101', 's2026102', 's2026103', 's2026104', 's2026105')
       order by student_number`,
    );
    expect(created.map((row) => row.student_number)).toEqual([
      "s2026101",
      "s2026105",
    ]);

    const classes = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from administrative_classes where name = '不存在的班'",
    );
    expect(classes[0]!.count).toBe(0);

    const html = await (await page("/admin/students", adminCookie)).text();
    expect(html).toContain("王五");
    expect(html).toContain("空行前生");
    for (const absent of ["赵六", "钱七", "孙八", "周九", "吴十"]) {
      expect(html).not.toContain(absent);
    }
  });

  it("表头缺失或列名不匹配时整体拒绝，并说明期望的列且不写入任何数据", async () => {
    await createAdministrativeClass("高二 7 班");

    const wrongName = await importCsv(
      "学号,姓名,班级,学籍状态\r\ns2026201,表头生,高二 7 班,在读\r\n",
    );
    expect(wrongName.status).toBe(400);
    const wrongNameBody = (await wrongName.json()) as Json;
    expect(wrongNameBody.error).toContain("表头不匹配");
    expect(wrongNameBody.error).toContain("行政班");
    expect(wrongNameBody.expectedColumns).toEqual([
      "学号",
      "姓名",
      "行政班",
      "学籍状态",
    ]);

    const missingColumn = await importCsv(
      "学号,姓名,行政班\r\ns2026202,缺列生,高二 7 班\r\n",
    );
    expect(missingColumn.status).toBe(400);
    const missingBody = (await missingColumn.json()) as Json;
    expect(missingBody.error).toContain("学籍状态");
    for (const column of ["学号", "姓名", "行政班", "学籍状态"]) {
      expect(String(missingBody.error)).toContain(column);
    }

    const empty = await importCsv("\uFEFF");
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Json).error).toContain("文件为空");

    const duplicated = await importCsv(
      "学号,学号,姓名,行政班,学籍状态\r\ns2026203,s2026204,重复表头,高二 7 班,在读\r\n",
    );
    expect(duplicated.status).toBe(400);
    expect(((await duplicated.json()) as Json).error).toContain("出现了多次");

    const written = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from students where student_number like 's20262%'",
    );
    expect(written[0]!.count).toBe(0);
  });

  it("教师与学生上传 CSV 返回 403，未登录返回 401，且不写入数据", async () => {
    await createAdministrativeClass("高二 8 班");

    const teacherCookie = await activateAccount({
      loginName: "import-teacher",
      displayName: "导入教师",
      role: "teacher",
      initialPassword: "初始密码1234",
      newPassword: "新密码45678",
    });
    const studentCookie = await activateAccount({
      loginName: "import-student",
      displayName: "导入学生",
      role: "student",
      initialPassword: "初始密码1234",
      newPassword: "新密码45678",
    });

    const csv =
      "学号,姓名,行政班,学籍状态\r\ns2026301,越权生,高二 8 班,在读\r\n";

    for (const cookie of [teacherCookie, studentCookie]) {
      const response = await importCsv(csv, cookie);
      expect(response.status).toBe(403);
      expect(((await response.json()) as Json).error).toBe("无权访问。");
    }

    const anonymous = await importCsv(csv, "");
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as Json).error).toBe("请先登录。");

    const written = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from students where student_number = 's2026301'",
    );
    expect(written[0]!.count).toBe(0);
  });

  it("学号已有学生账号时只建立学籍，不返回也不改动其现有密码", async () => {
    const originalCookie = await activateAccount({
      loginName: "s2026401",
      displayName: "先有账号",
      role: "student",
      initialPassword: "初始密码1234",
      newPassword: "已改密码45678",
    });
    expect(originalCookie).not.toBe("");

    const before = await queryRows<{
      password_hash: string;
      must_change_password: boolean;
    }>(
      app.schema!,
      "select password_hash, must_change_password from accounts where login_name = 's2026401'",
    );

    await createAdministrativeClass("高二 9 班");
    const body = await importBody(
      await importCsv(
        "学号,姓名,行政班,学籍状态\r\ns2026401,先有账号,高二 9 班,在读\r\n",
      ),
    );
    const row = rowFor(body, "s2026401");
    expect(row.status).toBe("created");
    expect(row.initialPassword).toBeUndefined();

    const after = await queryRows<{
      password_hash: string;
      must_change_password: boolean;
      student_number: string;
      class_name: string;
    }>(
      app.schema!,
      `select a.password_hash, a.must_change_password,
              s.student_number, c.name as class_name
       from students s
       join accounts a on a.id = s.account_id
       join administrative_classes c on c.id = s.administrative_class_id
       where s.student_number = 's2026401'`,
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      password_hash: before[0]!.password_hash,
      must_change_password: before[0]!.must_change_password,
      class_name: "高二 9 班",
    });

    const stillWorks = await login("s2026401", "已改密码45678");
    expect(stillWorks.response.status).toBe(200);
    expect(stillWorks.body.redirectTo).toBe("/student");
  });

  it("学籍管理页面提供批量导入入口", async () => {
    const response = await page("/admin/students", adminCookie);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("批量导入学生");
    expect(html).toContain("CSV");
    expect(html).toContain("上传并导入");
    expect(html).toContain("行政班必须事先创建");
    expect(html).toContain('accept=".csv,text/csv"');
  });

  it("CSV 不接受密码列：新学生仍使用系统生成的初始密码并强制改密", async () => {
    await createAdministrativeClass("高二 6 班");

    const body = await importBody(
      await importCsv(
        "学号,姓名,行政班,学籍状态,密码\r\n" +
          "s2026110,密码列生,高二 6 班,在读,CSV里的密码123\r\n",
      ),
    );
    const row = rowFor(body, "s2026110");
    expect(row.status).toBe("created");
    expect(row.initialPassword).toBeTruthy();
    expect(row.initialPassword).not.toBe("CSV里的密码123");

    const providedPassword = await login("s2026110", "CSV里的密码123");
    expect(providedPassword.response.status).toBe(401);

    const generatedPassword = await login("s2026110", row.initialPassword!);
    expect(generatedPassword.response.status).toBe(200);
    expect(String(generatedPassword.body.redirectTo)).toContain("/change-password");

    // 响应与数据库都不应出现明文密码。
    const raw = JSON.stringify(body);
    expect(raw).toContain(row.initialPassword!);
    const hashes = await queryRows<{ password_hash: string }>(
      app.schema!,
      "select password_hash from accounts where login_name = 's2026110'",
    );
    expect(hashes[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(hashes[0]!.password_hash).not.toContain(row.initialPassword!);
    expect(hashes[0]!.password_hash).not.toContain("CSV里的密码123");
  });
});
