import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";
import { loginCookie } from "./support/login";

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

/** 登录逻辑集中在 tests/support/login.ts，这里只固定本文件的 baseUrl。 */
const login = (loginName: string, password: string): Promise<string> =>
  loginCookie(app.baseUrl, loginName, password);

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

  it("学期列表按学年分组，教师与学生都可读取", async () => {
    const created = await createTerm(await academicYearIdOf(2025), "first");
    expect(created.status).toBe(201);

    for (const cookie of [studentCookie, teacherCookie, adminCookie]) {
      const response = await api("GET", "/api/terms", undefined, cookie);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        currentTerm: unknown;
        academicYears: {
          label: string;
          terms: { label: string; half: string }[];
        }[];
      };

      expect(body.currentTerm).toBeNull();
      expect(body.academicYears.map((year) => year.label)).toEqual([
        "2026-2027",
        "2025-2026",
      ]);
      expect(body.academicYears[0]!.terms.map((term) => term.half)).toEqual([
        "first",
        "second",
      ]);
      expect(body.academicYears[0]!.terms.map((term) => term.label)).toEqual([
        "2026-2027 学年上学期",
        "2026-2027 学年下学期",
      ]);
      expect(body.academicYears[1]!.terms.map((term) => term.label)).toEqual([
        "2025-2026 学年上学期",
      ]);
    }

    const anonymous = await api("GET", "/api/terms");
    expect(anonymous.status).toBe(401);
  });

  it("尚未设置当前学期时，依赖学期的页面给出提示而不是报错", async () => {
    expect(await currentTermIdFromApi()).toBeNull();

    const pages: [string, string][] = [
      ["/student", studentCookie],
      ["/teacher", teacherCookie],
    ];

    for (const [route, cookie] of pages) {
      const response = await page(route, cookie);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain("尚未设置当前学期");
      expect(html).toContain("联系教务管理员");
      expect(html).not.toContain("服务暂时不可用");
      expect(html).not.toContain("Internal Server Error");
    }
  });

  it("切换当前学期需要确认，确认后全局只有一个当前学期", async () => {
    const first2025 = await termIdOf(2025, "first");
    const first2026 = await termIdOf(2026, "first");

    // 尚未设置当前学期时，未确认的请求也要说明将发生什么。
    const firstAttempt = await setCurrentTerm(first2025, false);
    expect(firstAttempt.status).toBe(409);
    const firstBody = (await firstAttempt.json()) as {
      error: string;
      confirmationRequired: boolean;
      currentTerm: unknown;
      targetTerm: { id: string; label: string };
    };
    expect(firstBody.confirmationRequired).toBe(true);
    expect(firstBody.currentTerm).toBeNull();
    expect(firstBody.targetTerm.id).toBe(first2025);
    expect(firstBody.error).toContain("2025-2026 学年上学期");
    expect(firstBody.error).toContain("确认");

    expect(await settingRow()).toEqual({ count: 0, currentTermId: null });
    expect(await currentTermIdFromApi()).toBeNull();

    const confirmed = await setCurrentTerm(first2025, true);
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as {
      currentTerm: { id: string; label: string };
    };
    expect(confirmedBody.currentTerm).toMatchObject({
      id: first2025,
      label: "2025-2026 学年上学期",
    });

    // 设置表永远只有一行，当前学期就是刚选中的那个。
    expect(await settingRow()).toEqual({
      count: 1,
      currentTermId: first2025,
    });

    // 切换到另一个学期时，确认提示必须同时点出旧学期与目标学期。
    const blocked = await setCurrentTerm(first2026, false);
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as {
      error: string;
      currentTerm: { id: string };
      targetTerm: { id: string };
    };
    expect(blockedBody.currentTerm.id).toBe(first2025);
    expect(blockedBody.targetTerm.id).toBe(first2026);
    expect(blockedBody.error).toContain("2025-2026 学年上学期");
    expect(blockedBody.error).toContain("2026-2027 学年上学期");

    // 未确认时原当前学期不变。
    expect(await currentTermIdFromApi()).toBe(first2025);

    const switched = await setCurrentTerm(first2026, true);
    expect(switched.status).toBe(200);
    expect(await settingRow()).toEqual({
      count: 1,
      currentTermId: first2026,
    });

    const overview = await termsFromApi();
    expect(overview.currentTerm?.id).toBe(first2026);
    const marked = overview.academicYears.flatMap((year) =>
      year.terms.filter((term) => term.isCurrent).map((term) => term.id),
    );
    expect(marked).toEqual([first2026]);

    // 重复设置同一学期是幂等的，仍然只有一条设置记录。
    const again = await setCurrentTerm(first2026, true);
    expect(again.status).toBe(200);
    expect(await settingRow()).toEqual({
      count: 1,
      currentTermId: first2026,
    });
  });

  it("不存在的学期不能设为当前学期", async () => {
    const missing = await setCurrentTerm(
      "00000000-0000-4000-8000-000000000000",
      true,
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain(
      "学期",
    );

    const malformed = await setCurrentTerm("not-a-uuid", true);
    expect(malformed.status).toBe(400);
  });

  it("教师与学生不能创建学年、创建学期或切换当前学期", async () => {
    const yearId = await academicYearIdOf(2026);
    const first2025 = await termIdOf(2025, "first");
    const before = await settingRow();

    for (const cookie of [teacherCookie, studentCookie]) {
      const year = await createAcademicYear(2099, cookie);
      expect(year.status).toBe(403);
      expect(((await year.json()) as { error: string }).error).toBe(
        "无权访问。",
      );

      const term = await createTerm(yearId, "second", cookie);
      expect(term.status).toBe(403);

      const current = await setCurrentTerm(first2025, true, cookie);
      expect(current.status).toBe(403);
    }

    const years = await queryRows<{ count: number }>(
      app.schema!,
      "select count(*)::int as count from academic_years where start_year = 2099",
    );
    expect(years[0]!.count).toBe(0);
    expect(await settingRow()).toEqual(before);
  });

  it("未登录调用学年学期写接口返回 401", async () => {
    const year = await createAcademicYear(2098, "");
    expect(year.status).toBe(401);
    expect(((await year.json()) as { error: string }).error).toBe("请先登录。");

    const term = await createTerm(await academicYearIdOf(2026), "second", "");
    expect(term.status).toBe(401);

    const current = await setCurrentTerm(
      await termIdOf(2025, "first"),
      true,
      "",
    );
    expect(current.status).toBe(401);
  });

  it("教务管理员页面按学年分组展示学期，并提供切换确认", async () => {
    const response = await page("/admin/terms", adminCookie);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("学年与学期");
    expect(html).toContain("<h3>2026-2027 学年</h3>");
    expect(html).toContain("<h3>2025-2026 学年</h3>");
    expect(html.indexOf("<h3>2026-2027 学年</h3>")).toBeLessThan(
      html.indexOf("<h3>2025-2026 学年</h3>"),
    );
    expect(html).toContain("2026-2027 学年上学期");
    expect(html).toContain("2026-2027 学年下学期");
    expect(html).toContain("2025-2026 学年上学期");
    expect(html).toContain("当前学期");

    // 当前学期是 2026-2027 上学期；切到 2025-2026 上学期前必须出现确认文案。
    expect(html).toContain(
      "确定将当前学期从「2026-2027 学年上学期」切换为「2025-2026 学年上学期」吗？",
    );
    expect(html).toContain("确认切换");

    const adminHome = await page("/admin", adminCookie);
    expect(adminHome.status).toBe(200);
    expect(await adminHome.text()).toContain('href="/admin/terms"');
  });

  it("教师不能进入学年学期管理页面", async () => {
    const response = await page("/admin/terms", teacherCookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("无权访问");
  });

  it("设置当前学期后，学生与教师页面都显示当前学期", async () => {
    for (const [route, cookie] of [
      ["/student", studentCookie],
      ["/teacher", teacherCookie],
    ] as const) {
      const response = await page(route, cookie);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain("当前学期：2026-2027 学年上学期");
      expect(html).not.toContain("尚未设置当前学期");
    }
  });
});

type TermsOverviewJson = {
  currentTerm: { id: string; label: string } | null;
  academicYears: {
    terms: { id: string; isCurrent: boolean }[];
  }[];
};

async function setCurrentTerm(
  termId: unknown,
  confirmed: boolean,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "POST",
    "/api/admin/current-term",
    { termId, confirmed },
    cookie,
  );
}

async function termsFromApi(): Promise<TermsOverviewJson> {
  const response = await api("GET", "/api/terms", undefined, adminCookie);
  expect(response.status).toBe(200);
  return (await response.json()) as TermsOverviewJson;
}

async function currentTermIdFromApi(): Promise<string | null> {
  return (await termsFromApi()).currentTerm?.id ?? null;
}

async function settingRow(): Promise<{
  count: number;
  currentTermId: string | null;
}> {
  const rows = await queryRows<{ count: number; current_term_id: string | null }>(
    app.schema!,
    "select count(*)::int as count, max(current_term_id::text) as current_term_id from term_settings",
  );
  return {
    count: rows[0]!.count,
    currentTermId: rows[0]!.current_term_id,
  };
}

async function termIdOf(startYear: number, half: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    app.schema!,
    `select t.id from terms t
     join academic_years y on y.id = t.academic_year_id
     where y.start_year = $1 and t.half = $2`,
    [startYear, half],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`找不到学期：${startYear} ${half}`);
  return id;
}

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
