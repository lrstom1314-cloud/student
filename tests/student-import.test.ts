import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

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
});
