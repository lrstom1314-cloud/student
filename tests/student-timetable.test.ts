import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin01";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t9001";
const TEACHER_B_LOGIN = "t9002";
const STUDENT_A_LOGIN = "s9001";
const STUDENT_B_LOGIN = "s9002";
const STUDENT_EMPTY_LOGIN = "s9003";

let app: TestApp;
let adminCookie = "";
let teacherCookie = "";
let studentACookie = "";
let studentBCookie = "";
let studentEmptyCookie = "";

type Json = Record<string, unknown>;

type TermJson = {
  id: string;
  label: string;
  startsOn: string | null;
};

type EntryJson = {
  id: string;
  teachingClassId: string;
  teachingClassDisplayName: string;
  courseName: string;
  teacherDisplayName: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  startWeek: number;
  endWeek: number;
  weekParity: "every" | "odd" | "even";
  classroom: string;
  scheduledThisWeek: boolean | null;
};

type StudentTimetableJson = {
  currentTerm: TermJson | null;
  term: TermJson | null;
  student: { id: string; studentNumber: string; name: string } | null;
  startsOn: string | null;
  computedWeek: number | null;
  teachingWeek: number | null;
  inTeachingWeek: boolean;
  weekRange: { startWeek: number; endWeek: number } | null;
  entries: EntryJson[];
};

const ids = {
  termFirst: "",
  termSecond: "",
  termEmpty: "",
  classOne: "",
  classTwo: "",
  classThree: "",
  courseMath: "",
  courseEnglish: "",
  courseHistory: "",
  teachingClassMath: "",
  teachingClassEnglish: "",
  teachingClassHistory: "",
  teachingClassEmpty: "",
  studentA: "",
  studentB: "",
};

async function api(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: unknown };
  return typeof body.error === "string" ? body.error : "";
}

function todayInSchool(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** 相对今天（按学校时区）偏移若干天的 ISO 日期。 */
function schoolDate(daysFromToday: number): string {
  const [year, month, day] = todayInSchool().split("-").map(Number);
  const target = new Date(
    Date.UTC(year!, month! - 1, day!) + daysFromToday * 86_400_000,
  );
  return target.toISOString().slice(0, 10);
}

async function setStartsOn(
  termId: string,
  startsOn: unknown,
  cookie: string = adminCookie,
): Promise<Response> {
  return api("PATCH", `/api/admin/terms/${termId}`, { startsOn }, cookie);
}

async function setStartsOnOk(termId: string, startsOn: string): Promise<void> {
  const response = await setStartsOn(termId, startsOn);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { term: TermJson };
  expect(body.term.startsOn).toBe(startsOn);
}

async function setCurrentTerm(termId: string): Promise<void> {
  const response = await api(
    "POST",
    "/api/admin/current-term",
    { termId, confirmed: true },
    adminCookie,
  );
  expect(response.status).toBe(200);
}

async function studentTimetable(
  cookie: string = studentACookie,
  query = "",
): Promise<StudentTimetableJson> {
  const response = await api(
    "GET",
    `/api/student/timetable${query}`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StudentTimetableJson;
}

function entryOf(
  timetable: StudentTimetableJson,
  classroom: string,
): EntryJson {
  const entry = timetable.entries.find((item) => item.classroom === classroom);
  if (!entry) throw new Error(`课表中找不到教室 ${classroom}`);
  return entry;
}

async function createStudent(input: {
  studentNumber: string;
  name: string;
  administrativeClassId: string;
  initialPassword?: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/students",
    {
      studentNumber: input.studentNumber,
      name: input.name,
      administrativeClassId: input.administrativeClassId,
      enrollmentStatus: "enrolled",
      ...(input.initialPassword
        ? { initialPassword: input.initialPassword }
        : {}),
    },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { student: { id: string } }).student.id;
}

async function createAdministrativeClass(name: string): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/administrative-classes",
    { name },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return (
    (await response.json()) as { administrativeClass: { id: string } }
  ).administrativeClass.id;
}

async function createCourse(name: string): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/courses",
    { name, credits: 2 },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { course: { id: string } }).course.id;
}

async function accountIdOf(loginName: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    app.schema!,
    "select id from accounts where login_name = $1",
    [loginName],
  );
  return rows[0]!.id;
}

async function createTeachingClass(input: {
  termId: string;
  courseId: string;
  teacherAccountId: string;
  displayName: string;
  administrativeClassId?: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/teaching-classes",
    input,
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { teachingClass: { id: string } })
    .teachingClass.id;
}

async function addStudent(
  teachingClassId: string,
  studentId: string,
): Promise<void> {
  const response = await api(
    "POST",
    `/api/admin/teaching-classes/${teachingClassId}/students`,
    { studentId },
    adminCookie,
  );
  expect(response.status).toBe(200);
}

async function createEntry(
  teachingClassId: string,
  body: Json,
): Promise<EntryJson> {
  const response = await api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/timetable`,
    {
      startWeek: 1,
      endWeek: 16,
      weekParity: "every",
      ...body,
    },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { entry: EntryJson }).entry;
}

describe("学生端首屏：我的课表", () => {
  beforeAll(async () => {
    app = await startTestApp();

    bootstrapAccount({
      loginName: ADMIN_LOGIN,
      displayName: "教务甲",
      role: "administrator",
      password: ADMIN_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_A_LOGIN,
      displayName: "教师甲",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_B_LOGIN,
      displayName: "教师乙",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    for (const [loginName, displayName] of [
      [STUDENT_A_LOGIN, "张三"],
      [STUDENT_B_LOGIN, "李四"],
      [STUDENT_EMPTY_LOGIN, "赵六"],
    ] as const) {
      bootstrapAccount({
        loginName,
        displayName,
        role: "student",
        password: ACCOUNT_PASSWORD,
      });
    }

    adminCookie = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
    teacherCookie = await login(TEACHER_A_LOGIN, ACCOUNT_PASSWORD);
    studentACookie = await login(STUDENT_A_LOGIN, ACCOUNT_PASSWORD);
    studentBCookie = await login(STUDENT_B_LOGIN, ACCOUNT_PASSWORD);
    studentEmptyCookie = await login(STUDENT_EMPTY_LOGIN, ACCOUNT_PASSWORD);

    const year = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2025 },
      adminCookie,
    );
    expect(year.status).toBe(201);
    const yearId = (
      (await year.json()) as { academicYear: { id: string } }
    ).academicYear.id;

    for (const half of ["first", "second"] as const) {
      const response = await api(
        "POST",
        "/api/admin/terms",
        { academicYearId: yearId, half },
        adminCookie,
      );
      expect(response.status).toBe(201);
      const term = (await response.json()) as { term: TermJson };
      if (half === "first") ids.termFirst = term.term.id;
      else ids.termSecond = term.term.id;
    }

    // 一个尚未排任何课的学期，用来验证「尚未排课」的空状态。
    const emptyYear = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2026 },
      adminCookie,
    );
    expect(emptyYear.status).toBe(201);
    const emptyYearId = (
      (await emptyYear.json()) as { academicYear: { id: string } }
    ).academicYear.id;
    const emptyTerm = await api(
      "POST",
      "/api/admin/terms",
      { academicYearId: emptyYearId, half: "first" },
      adminCookie,
    );
    expect(emptyTerm.status).toBe(201);
    ids.termEmpty = ((await emptyTerm.json()) as { term: TermJson }).term.id;

    ids.classOne = await createAdministrativeClass("高二 1 班");
    ids.classTwo = await createAdministrativeClass("高二 2 班");
    ids.classThree = await createAdministrativeClass("高二 3 班");

    ids.studentA = await createStudent({
      studentNumber: STUDENT_A_LOGIN,
      name: "张三",
      administrativeClassId: ids.classOne,
    });
    ids.studentB = await createStudent({
      studentNumber: STUDENT_B_LOGIN,
      name: "李四",
      administrativeClassId: ids.classOne,
    });
    await createStudent({
      studentNumber: STUDENT_EMPTY_LOGIN,
      name: "赵六",
      administrativeClassId: ids.classThree,
    });

    ids.courseMath = await createCourse("高等数学");
    ids.courseEnglish = await createCourse("英语");
    ids.courseHistory = await createCourse("历史");

    const teacherA = await accountIdOf(TEACHER_A_LOGIN);
    const teacherB = await accountIdOf(TEACHER_B_LOGIN);

    ids.teachingClassMath = await createTeachingClass({
      termId: ids.termFirst,
      courseId: ids.courseMath,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 高等数学",
      administrativeClassId: ids.classOne,
    });
    // 只有李四被手工加入的另一个教学班：张三不应看到它的课。
    ids.teachingClassEnglish = await createTeachingClass({
      termId: ids.termFirst,
      courseId: ids.courseEnglish,
      teacherAccountId: teacherB,
      displayName: "高二 1 班 英语（李四单独）",
    });
    await addStudent(ids.teachingClassEnglish, ids.studentB);
    ids.teachingClassHistory = await createTeachingClass({
      termId: ids.termSecond,
      courseId: ids.courseHistory,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 历史（上学期）",
      administrativeClassId: ids.classOne,
    });
    ids.teachingClassEmpty = await createTeachingClass({
      termId: ids.termFirst,
      courseId: ids.courseMath,
      teacherAccountId: teacherA,
      displayName: "高二 3 班 高等数学（未排课）",
      administrativeClassId: ids.classThree,
    });

    // 张三所在教学班的课：同一时段有单周与双周两条，必须都可见。
    await createEntry(ids.teachingClassMath, {
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      classroom: "教学楼 A101",
    });
    await createEntry(ids.teachingClassMath, {
      weekday: 3,
      startPeriod: 5,
      endPeriod: 6,
      weekParity: "odd",
      classroom: "实验楼 C303",
    });
    await createEntry(ids.teachingClassMath, {
      weekday: 3,
      startPeriod: 5,
      endPeriod: 6,
      weekParity: "even",
      classroom: "实验楼 C304",
    });
    await createEntry(ids.teachingClassMath, {
      weekday: 5,
      startPeriod: 3,
      endPeriod: 4,
      classroom: "教学楼 E505",
    });

    // 别人的课与历史学期的课，都不应出现在张三的首屏。
    await createEntry(ids.teachingClassEnglish, {
      weekday: 4,
      startPeriod: 1,
      endPeriod: 2,
      classroom: "机密教室 S999",
    });
    await createEntry(ids.teachingClassHistory, {
      weekday: 2,
      startPeriod: 1,
      endPeriod: 2,
      classroom: "旧教学楼 OLD101",
    });
  }, 240_000);

  afterAll(async () => {
    await app.stop();
  });

  it("未登录访问学生首屏被带回登录页", async () => {
    const response = await page("/student");
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fstudent");

    const apiResponse = await api("GET", "/api/student/timetable");
    expect(apiResponse.status).toBe(401);
    expect(await errorOf(apiResponse)).toBe("请先登录。");
  });

  it("尚未设置当前学期时，学生首屏与接口都给出明确提示而不是报错", async () => {
    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("尚未设置当前学期");
    expect(html).toContain("联系教务管理员");
    expect(html).not.toContain("Internal Server Error");

    const timetable = await studentTimetable();
    expect(timetable.currentTerm).toBeNull();
    expect(timetable.term).toBeNull();
    expect(timetable.entries).toEqual([]);
    expect(timetable.teachingWeek).toBeNull();
    expect(timetable.inTeachingWeek).toBe(false);
    expect(timetable.startsOn).toBeNull();
  });

  it("教务管理员可在学年学期页设置教学第 1 周起始日期，非法日期被拒绝", async () => {
    const startsOn = "2026-03-02";
    const response = await setStartsOn(ids.termFirst, startsOn);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { term: TermJson };
    expect(body.term).toMatchObject({
      id: ids.termFirst,
      label: "2025-2026 学年上学期",
      startsOn,
    });

    const rows = await queryRows<{ starts_on: string }>(
      app.schema!,
      "select starts_on::text as starts_on from terms where id = $1",
      [ids.termFirst],
    );
    expect(rows[0]!.starts_on).toBe(startsOn);

    for (const invalid of [
      "2026-02-30",
      "2026-3-2",
      "03/02/2026",
      "not-a-date",
      "",
      20260302,
    ]) {
      const rejected = await setStartsOn(ids.termFirst, invalid);
      expect(rejected.status).toBe(400);
      expect(await errorOf(rejected)).toContain("开学日期");
    }

    // 其他角色不能修改开学日期。
    for (const [cookie, status] of [
      [teacherCookie, 403],
      [studentACookie, 403],
      ["", 401],
    ] as const) {
      const denied = await setStartsOn(ids.termFirst, "2026-03-09", cookie);
      expect(denied.status).toBe(status);
    }

    // 教务管理员页面提供日期输入，并回填已设置的日期。
    const adminPage = await page("/admin/terms", adminCookie);
    expect(adminPage.status).toBe(200);
    const adminHtml = await adminPage.text();
    expect(adminHtml).toContain('type="date"');
    expect(adminHtml).toContain('name="startsOn"');
    expect(adminHtml).toContain(`value="${startsOn}"`);
    expect(adminHtml).toContain("开学日期");

    // 学期列表接口也返回该日期。
    const terms = await api("GET", "/api/terms", undefined, adminCookie);
    const termsBody = (await terms.json()) as {
      academicYears: { terms: TermJson[] }[];
    };
    const firstTerm = termsBody.academicYears
      .flatMap((year) => year.terms)
      .find((term) => term.id === ids.termFirst)!;
    expect(firstTerm.startsOn).toBe(startsOn);
  });

  it("设置当前学期后，首屏即当前学期课表，按星期与节次排布", async () => {
    await setCurrentTerm(ids.termFirst);

    const timetable = await studentTimetable();
    expect(timetable.currentTerm).toMatchObject({ id: ids.termFirst });
    expect(timetable.student).toMatchObject({
      id: ids.studentA,
      studentNumber: STUDENT_A_LOGIN,
      name: "张三",
    });
    expect(timetable.entries).toHaveLength(4);
    expect(timetable.entries.map((entry) => entry.classroom).sort()).toEqual(
      ["实验楼 C303", "实验楼 C304", "教学楼 A101", "教学楼 E505"].sort(),
    );
    expect(timetable.weekRange).toEqual({ startWeek: 1, endWeek: 16 });
    expect(timetable.entries.map((entry) => entry.weekday)).toEqual([
      1, 3, 3, 5,
    ]);

    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("我的课表");
    expect(html).toContain("2025-2026 学年上学期");
    for (const label of ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("第 1-2 节");
    expect(html).toContain("第 5-6 节");
    expect(html).toContain("第 3-4 节");
    expect(html).toContain("教学楼 A101");
    expect(html).toContain("实验楼 C303");
    expect(html).toContain("实验楼 C304");
    expect(html).toContain("教学楼 E505");
    expect(html).toContain("高等数学");
    expect(html).toContain("教师甲");
    // 同一时段的两条单双周课必须同时出现，不能被合并。
    expect(html.indexOf("实验楼 C303")).toBeLessThan(
      html.indexOf("实验楼 C304"),
    );
    // 他人的课与历史学期的课不出现在首屏。
    expect(html).not.toContain("机密教室 S999");
    expect(html).not.toContain("旧教学楼 OLD101");
    expect(html).not.toContain("历史（上学期）");
    expect(html).not.toContain("Internal Server Error");
  });

  it("本周为双周时，单周课标为「本周不上」，双周课正常显示", async () => {
    // 开学日期设在 7 天前：今天正好是第 2 周（双周）。
    await setStartsOnOk(ids.termFirst, schoolDate(-7));

    const timetable = await studentTimetable();
    expect(timetable.computedWeek).toBe(2);
    expect(timetable.teachingWeek).toBe(2);
    expect(timetable.inTeachingWeek).toBe(true);

    expect(entryOf(timetable, "实验楼 C303").scheduledThisWeek).toBe(false);
    expect(entryOf(timetable, "实验楼 C304").scheduledThisWeek).toBe(true);
    expect(entryOf(timetable, "教学楼 A101").scheduledThisWeek).toBe(true);
    expect(entryOf(timetable, "教学楼 E505").scheduledThisWeek).toBe(true);

    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("第 2 周");
    expect(html).toContain("本周不上");
    // 本周不上只应落在单周那条上：页面里能同时读到两条同一时段的课。
    expect(html).toContain("实验楼 C303");
    expect(html).toContain("实验楼 C304");
  });

  it("本周为单周时，双周课标为「本周不上」，单周课正常显示", async () => {
    // 开学日期就是今天：今天正好是第 1 周（单周）。
    await setStartsOnOk(ids.termFirst, schoolDate(0));

    const timetable = await studentTimetable();
    expect(timetable.computedWeek).toBe(1);
    expect(timetable.teachingWeek).toBe(1);
    expect(timetable.inTeachingWeek).toBe(true);

    expect(entryOf(timetable, "实验楼 C303").scheduledThisWeek).toBe(true);
    expect(entryOf(timetable, "实验楼 C304").scheduledThisWeek).toBe(false);
    expect(entryOf(timetable, "教学楼 A101").scheduledThisWeek).toBe(true);

    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("第 1 周");
    expect(html).toContain("本周不上");
    expect(html).toContain("实验楼 C303");
    expect(html).toContain("实验楼 C304");
  });

  it("周次按开学日期整除周数计算；超出课表周次范围视为不在教学周内", async () => {
    // 第 1 周：0-6 天前都算第 1 周。
    await setStartsOnOk(ids.termFirst, schoolDate(-6));
    expect((await studentTimetable()).computedWeek).toBe(1);

    // 第 5 周：34 天前。
    await setStartsOnOk(ids.termFirst, schoolDate(-34));
    const week5 = await studentTimetable();
    expect(week5.computedWeek).toBe(5);
    expect(week5.teachingWeek).toBe(5);
    expect(entryOf(week5, "实验楼 C303").scheduledThisWeek).toBe(true);
    expect(entryOf(week5, "实验楼 C304").scheduledThisWeek).toBe(false);

    // 第 29 周：196 天前，超出本学期课表第 1-16 周的范围，不标本周。
    await setStartsOnOk(ids.termFirst, schoolDate(-196));
    const outside = await studentTimetable();
    expect(outside.computedWeek).toBe(29);
    expect(outside.inTeachingWeek).toBe(false);
    expect(outside.teachingWeek).toBeNull();
    expect(
      outside.entries.every((entry) => entry.scheduledThisWeek === null),
    ).toBe(true);

    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("不在教学周内");
    expect(html).not.toContain("本周不上");
    // 不在教学周内时课表本身仍然完整可见。
    expect(html).toContain("教学楼 A101");
  });

  it("学期未设置开学日期时，课表仍可用，只是不标本周并给出轻提示", async () => {
    const cleared = await setStartsOn(ids.termFirst, null);
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { term: TermJson }).term.startsOn).toBe(
      null,
    );

    const rows = await queryRows<{ starts_on: string | null }>(
      app.schema!,
      "select starts_on::text as starts_on from terms where id = $1",
      [ids.termFirst],
    );
    expect(rows[0]!.starts_on).toBeNull();

    const timetable = await studentTimetable();
    expect(timetable.startsOn).toBeNull();
    expect(timetable.computedWeek).toBeNull();
    expect(timetable.teachingWeek).toBeNull();
    expect(timetable.inTeachingWeek).toBe(false);
    expect(timetable.entries).toHaveLength(4);
    expect(
      timetable.entries.every((entry) => entry.scheduledThisWeek === null),
    ).toBe(true);

    const response = await page("/student", studentACookie);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("尚未设置开学日期");
    expect(html).toContain("教学楼 A101");
    expect(html).toContain("实验楼 C303");
    expect(html).not.toContain("本周不上");
    expect(html).not.toContain("Internal Server Error");
    expect(html).not.toContain("服务暂时不可用");

    // 改回一个正常日期，后续用例依赖「本周」标记。
    await setStartsOnOk(ids.termFirst, schoolDate(-7));
  });

  it("学生无法通过构造请求看到他人课表", async () => {
    // 同一个班里的李四能看到自己单独的教学班，张三不能。
    const liTimetable = await studentTimetable(studentBCookie);
    expect(liTimetable.student?.id).toBe(ids.studentB);
    expect(
      liTimetable.entries.map((entry) => entry.classroom).sort(),
    ).toEqual(
      [
        "机密教室 S999",
        "实验楼 C303",
        "实验楼 C304",
        "教学楼 A101",
        "教学楼 E505",
      ].sort(),
    );

    // 用查询参数指定他人：403。
    const byQuery = await api(
      "GET",
      `/api/student/timetable?studentId=${ids.studentB}`,
      undefined,
      studentACookie,
    );
    expect(byQuery.status).toBe(403);
    expect(await errorOf(byQuery)).toBe("无权访问。");

    // 用路径指定他人：403；指定自己：200 且只有自己的课。
    const byPath = await api(
      "GET",
      `/api/student/timetable/${ids.studentB}`,
      undefined,
      studentACookie,
    );
    expect(byPath.status).toBe(403);
    expect(await errorOf(byPath)).toBe("无权访问。");

    const ownPath = await api(
      "GET",
      `/api/student/timetable/${ids.studentA}`,
      undefined,
      studentACookie,
    );
    expect(ownPath.status).toBe(200);
    const own = (await ownPath.json()) as StudentTimetableJson;
    expect(own.student?.id).toBe(ids.studentA);
    expect(own.entries.some((entry) => entry.classroom === "机密教室 S999")).toBe(
      false,
    );

    // 不能通过指定学期绕到历史学期。
    const byTerm = await api(
      "GET",
      `/api/student/timetable?termId=${ids.termSecond}`,
      undefined,
      studentACookie,
    );
    expect(byTerm.status).toBe(400);
    expect(await errorOf(byTerm)).toContain("当前学期");
  });

  it("只显示当前学期：切换当前学期后首屏只出现新学期的课", async () => {
    await setCurrentTerm(ids.termSecond);

    const timetable = await studentTimetable();
    expect(timetable.currentTerm?.id).toBe(ids.termSecond);
    expect(timetable.entries.map((entry) => entry.classroom)).toEqual([
      "旧教学楼 OLD101",
    ]);

    const html = await (await page("/student", studentACookie)).text();
    expect(html).toContain("2025-2026 学年下学期");
    expect(html).toContain("旧教学楼 OLD101");
    expect(html).not.toContain("教学楼 A101");
    expect(html).not.toContain("实验楼 C303");

    await setCurrentTerm(ids.termFirst);
  });

  it("当前学期尚未排课或学生未被加入教学班时给出明确空状态", async () => {
    // 张三所在学期有课；赵六在本学期没有任何课。
    const html = await (await page("/student", studentEmptyCookie)).text();
    expect(html).toContain("当前学期还没有你的课");
    expect(html).not.toContain("Internal Server Error");

    // 切到一个完全没有排课的学期。
    await setCurrentTerm(ids.termEmpty);
    const emptyResponse = await page("/student", studentACookie);
    expect(emptyResponse.status).toBe(200);
    const emptyHtml = await emptyResponse.text();
    expect(emptyHtml).toContain("尚未排课");
    expect(emptyHtml).not.toContain("Internal Server Error");

    const timetable = await studentTimetable();
    expect(timetable.entries).toEqual([]);
    expect(timetable.weekRange).toBeNull();

    await setCurrentTerm(ids.termFirst);
  });

  it("接口只允许学生访问：教师与教务管理员被拒绝", async () => {
    for (const cookie of [teacherCookie, adminCookie]) {
      const response = await api(
        "GET",
        "/api/student/timetable",
        undefined,
        cookie,
      );
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe("无权访问。");
    }
  });

  it("移动端无需横向滚动：课表使用可堆叠的自适应布局", async () => {
    const response = await page("/student", studentACookie);
    const html = await response.text();
    expect(html).toContain('class="timetable-week"');
    expect(html).toContain('name="viewport"');

    const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(
      (match) => match[1]!,
    );
    expect(hrefs.length).toBeGreaterThan(0);

    let css = "";
    for (const href of hrefs) {
      const asset = await fetch(`${app.baseUrl}${href}`);
      expect(asset.status).toBe(200);
      css += await asset.text();
    }

    expect(css).toContain(".timetable-week");
    expect(css).toMatch(/\.timetable-week\s*\{[^}]*grid-template-columns/);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.timetable-week\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
