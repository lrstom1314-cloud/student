import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin12";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t12001";
const TEACHER_B_LOGIN = "t12002";
const STUDENT_ZHANG_LOGIN = "s1201";
const STUDENT_LI_LOGIN = "s1202";
const STUDENT_WANG_LOGIN = "s1203";
const STUDENT_EMPTY_LOGIN = "s1204";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentZhangCookie = "";
let studentLiCookie = "";
let studentWangCookie = "";
let studentEmptyCookie = "";

type Json = Record<string, unknown>;

type TermJson = { id: string; label: string };

type PublicationJson = { id: string; version: number; publishedAt: string };

type StudentCourseJson =
  | {
      teachingClass: {
        id: string;
        displayName: string;
        courseName: string;
        teacherName: string;
        termLabel: string;
      };
      published: false;
    }
  | {
      teachingClass: {
        id: string;
        displayName: string;
        courseName: string;
        teacherName: string;
        termLabel: string;
      };
      published: true;
      publication: PublicationJson;
      overall: {
        computedScore: number | null;
        overrideScore: number | null;
        finalScore: number | null;
        finalSource: "computed" | "override" | null;
        status: "complete" | "incomplete";
      };
      items: Array<{
        gradeItemId: string;
        name: string;
        maxScore: number;
        weight: number;
        score: number | null;
      }>;
    };

type StudentGradeReportJson = {
  currentTerm: TermJson | null;
  term: TermJson | null;
  student: { id: string; studentNumber: string; name: string } | null;
  courses: StudentCourseJson[];
};

type GradeItemJson = { id: string; name: string; maxScore: number; weight: number };

type SheetStudentJson = {
  id: string;
  studentNumber: string;
  name: string;
  grades: Record<string, number | null>;
  overall: { finalScore: number | null };
};

type GradeSheetJson = {
  gradeItems: GradeItemJson[];
  students: SheetStudentJson[];
  lock: { state: "draft" | "published"; latestPublication: PublicationJson | null };
};

const ids = {
  termCurrent: "",
  termPast: "",
  classOne: "",
  classTwo: "",
  courseMath: "",
  courseEnglish: "",
  coursePhysics: "",
  courseHistory: "",
  classMath: "",
  classEnglish: "",
  classPhysics: "",
  classHistory: "",
  classMathDraft: "",
  studentZhang: "",
  studentLi: "",
  studentWang: "",
  studentEmpty: "",
};

async function api(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

async function createStudent(input: {
  studentNumber: string;
  name: string;
  administrativeClassId: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/students",
    {
      studentNumber: input.studentNumber,
      name: input.name,
      administrativeClassId: input.administrativeClassId,
      initialPassword: ACCOUNT_PASSWORD,
    },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { student: { id: string } }).student.id;
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
  studentIds: string[];
}): Promise<string> {
  const created = await api(
    "POST",
    "/api/admin/teaching-classes",
    {
      termId: input.termId,
      courseId: input.courseId,
      teacherAccountId: input.teacherAccountId,
      displayName: input.displayName,
    },
    adminCookie,
  );
  expect(created.status).toBe(201);
  const teachingClassId = (
    (await created.json()) as { teachingClass: { id: string } }
  ).teachingClass.id;

  for (const studentId of input.studentIds) {
    const added = await api(
      "POST",
      `/api/admin/teaching-classes/${teachingClassId}/students`,
      { studentId },
      adminCookie,
    );
    expect(added.status).toBe(200);
  }
  return teachingClassId;
}

async function createGradeItem(
  teachingClassId: string,
  body: { name: string; maxScore: number; weight: number },
  cookie: string = teacherACookie,
): Promise<GradeItemJson> {
  const response = await api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/grade-items`,
    body,
    cookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { gradeItem: GradeItemJson }).gradeItem;
}

async function getSheet(
  teachingClassId: string,
  cookie: string = teacherACookie,
): Promise<GradeSheetJson> {
  const response = await api(
    "GET",
    `/api/teaching-classes/${teachingClassId}/grades`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { sheet: GradeSheetJson }).sheet;
}

async function saveScores(
  teachingClassId: string,
  scores: Array<{ studentId: string; gradeItemId: string; score: number | null }>,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "PUT",
    `/api/teaching-classes/${teachingClassId}/grades`,
    { scores },
    cookie,
  );
}

async function publish(
  teachingClassId: string,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/publish`,
    { confirmed: true },
    cookie,
  );
}

async function studentReport(
  cookie: string = studentZhangCookie,
  query = "",
): Promise<StudentGradeReportJson> {
  const response = await api(
    "GET",
    `/api/student/grades${query}`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StudentGradeReportJson;
}

function courseOf(
  report: StudentGradeReportJson,
  teachingClassId: string,
): StudentCourseJson {
  const course = report.courses.find(
    (entry) => entry.teachingClass.id === teachingClassId,
  );
  if (!course) throw new Error(`学生成绩中没有教学班 ${teachingClassId}`);
  return course;
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

describe("学生成绩查询", () => {
  beforeAll(async () => {
    app = await startTestApp();

    bootstrapAccount({
      loginName: ADMIN_LOGIN,
      displayName: "教务丙",
      role: "administrator",
      password: ADMIN_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_A_LOGIN,
      displayName: "教师戊",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_B_LOGIN,
      displayName: "教师己",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    for (const [loginName, displayName] of [
      [STUDENT_ZHANG_LOGIN, "张三"],
      [STUDENT_LI_LOGIN, "李四"],
      [STUDENT_WANG_LOGIN, "王五"],
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
    teacherACookie = await login(TEACHER_A_LOGIN, ACCOUNT_PASSWORD);
    teacherBCookie = await login(TEACHER_B_LOGIN, ACCOUNT_PASSWORD);
    studentZhangCookie = await login(STUDENT_ZHANG_LOGIN, ACCOUNT_PASSWORD);
    studentLiCookie = await login(STUDENT_LI_LOGIN, ACCOUNT_PASSWORD);
    studentWangCookie = await login(STUDENT_WANG_LOGIN, ACCOUNT_PASSWORD);
    studentEmptyCookie = await login(STUDENT_EMPTY_LOGIN, ACCOUNT_PASSWORD);

    const currentYear = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2026 },
      adminCookie,
    );
    expect(currentYear.status).toBe(201);
    const currentYearId = (
      (await currentYear.json()) as { academicYear: { id: string } }
    ).academicYear.id;

    const pastYear = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2025 },
      adminCookie,
    );
    expect(pastYear.status).toBe(201);
    const pastYearId = (
      (await pastYear.json()) as { academicYear: { id: string } }
    ).academicYear.id;

    const currentTerm = await api(
      "POST",
      "/api/admin/terms",
      { academicYearId: currentYearId, half: "first" },
      adminCookie,
    );
    expect(currentTerm.status).toBe(201);
    ids.termCurrent = ((await currentTerm.json()) as { term: TermJson }).term.id;

    const pastTerm = await api(
      "POST",
      "/api/admin/terms",
      { academicYearId: pastYearId, half: "second" },
      adminCookie,
    );
    expect(pastTerm.status).toBe(201);
    ids.termPast = ((await pastTerm.json()) as { term: TermJson }).term.id;

    const classOne = await api(
      "POST",
      "/api/admin/administrative-classes",
      { name: "高三 1 班" },
      adminCookie,
    );
    expect(classOne.status).toBe(201);
    ids.classOne = (
      (await classOne.json()) as { administrativeClass: { id: string } }
    ).administrativeClass.id;

    const classTwo = await api(
      "POST",
      "/api/admin/administrative-classes",
      { name: "高三 2 班" },
      adminCookie,
    );
    expect(classTwo.status).toBe(201);
    ids.classTwo = (
      (await classTwo.json()) as { administrativeClass: { id: string } }
    ).administrativeClass.id;

    ids.studentZhang = await createStudent({
      studentNumber: STUDENT_ZHANG_LOGIN,
      name: "张三",
      administrativeClassId: ids.classOne,
    });
    ids.studentLi = await createStudent({
      studentNumber: STUDENT_LI_LOGIN,
      name: "李四",
      administrativeClassId: ids.classOne,
    });
    ids.studentEmpty = await createStudent({
      studentNumber: STUDENT_EMPTY_LOGIN,
      name: "赵六",
      administrativeClassId: ids.classOne,
    });
    ids.studentWang = await createStudent({
      studentNumber: STUDENT_WANG_LOGIN,
      name: "王五",
      administrativeClassId: ids.classTwo,
    });

    for (const [key, name] of [
      ["courseMath", "数学"],
      ["courseEnglish", "英语"],
      ["coursePhysics", "物理"],
      ["courseHistory", "历史"],
    ] as const) {
      const response = await api(
        "POST",
        "/api/admin/courses",
        { name, credits: 2 },
        adminCookie,
      );
      expect(response.status).toBe(201);
      ids[key] = ((await response.json()) as { course: { id: string } }).course
        .id;
    }

    const teacherA = await accountIdOf(TEACHER_A_LOGIN);
    const teacherB = await accountIdOf(TEACHER_B_LOGIN);

    ids.classMath = await createTeachingClass({
      termId: ids.termCurrent,
      courseId: ids.courseMath,
      teacherAccountId: teacherA,
      displayName: "高三 1 班 数学",
      studentIds: [ids.studentZhang, ids.studentLi],
    });
    ids.classEnglish = await createTeachingClass({
      termId: ids.termCurrent,
      courseId: ids.courseEnglish,
      teacherAccountId: teacherA,
      displayName: "高三 1 班 英语（仅李四）",
      studentIds: [ids.studentLi],
    });
    ids.classPhysics = await createTeachingClass({
      termId: ids.termCurrent,
      courseId: ids.coursePhysics,
      teacherAccountId: teacherA,
      displayName: "高三 1 班 物理",
      studentIds: [ids.studentZhang],
    });
    ids.classHistory = await createTeachingClass({
      termId: ids.termPast,
      courseId: ids.courseHistory,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 历史（上学期）",
      studentIds: [ids.studentZhang],
    });
    ids.classMathDraft = await createTeachingClass({
      termId: ids.termCurrent,
      courseId: ids.courseMath,
      teacherAccountId: teacherB,
      displayName: "高三 2 班 数学（未发布）",
      studentIds: [ids.studentWang],
    });

    const mathDaily = await createGradeItem(ids.classMath, {
      name: "平时",
      maxScore: 100,
      weight: 30,
    });
    const mathMidterm = await createGradeItem(ids.classMath, {
      name: "期中",
      maxScore: 100,
      weight: 30,
    });
    const mathFinal = await createGradeItem(ids.classMath, {
      name: "期末",
      maxScore: 100,
      weight: 40,
    });

    expect(
      (
        await saveScores(ids.classMath, [
          { studentId: ids.studentZhang, gradeItemId: mathDaily.id, score: 80 },
          { studentId: ids.studentZhang, gradeItemId: mathMidterm.id, score: 90 },
          { studentId: ids.studentZhang, gradeItemId: mathFinal.id, score: 85 },
          { studentId: ids.studentLi, gradeItemId: mathDaily.id, score: 100 },
          { studentId: ids.studentLi, gradeItemId: mathMidterm.id, score: 100 },
          { studentId: ids.studentLi, gradeItemId: mathFinal.id, score: 100 },
        ])
      ).status,
    ).toBe(200);

    expect(
      (
        await api(
          "PUT",
          `/api/teaching-classes/${ids.classMath}/overalls/${ids.studentLi}`,
          { score: 98 },
          teacherACookie,
        )
      ).status,
    ).toBe(200);

    await createGradeItem(ids.classEnglish, {
      name: "听力",
      maxScore: 100,
      weight: 100,
    });

    // 物理有两个成绩项：出勤真实得 0 分，实验完全没有得分。
    // 发布后总评应「未完成」，实验显示「未录入」，出勤仍显示真实的 0。
    await createGradeItem(ids.classPhysics, {
      name: "实验",
      maxScore: 100,
      weight: 60,
    });
    const physicsAttendance = await createGradeItem(ids.classPhysics, {
      name: "出勤",
      maxScore: 100,
      weight: 40,
    });
    expect(
      (
        await saveScores(ids.classPhysics, [
          {
            studentId: ids.studentZhang,
            gradeItemId: physicsAttendance.id,
            score: 0,
          },
        ])
      ).status,
    ).toBe(200);

    const historyFinal = await createGradeItem(ids.classHistory, {
      name: "期末",
      maxScore: 100,
      weight: 100,
    });
    expect(
      (
        await saveScores(ids.classHistory, [
          {
            studentId: ids.studentZhang,
            gradeItemId: historyFinal.id,
            score: 95,
          },
        ])
      ).status,
    ).toBe(200);
    expect((await publish(ids.classHistory)).status).toBe(200);

    const draftItem = await createGradeItem(
      ids.classMathDraft,
      { name: "平时", maxScore: 100, weight: 100 },
      teacherBCookie,
    );
    expect(
      (
        await saveScores(
          ids.classMathDraft,
          [
            {
              studentId: ids.studentWang,
              gradeItemId: draftItem.id,
              score: 70,
            },
          ],
          teacherBCookie,
        )
      ).status,
    ).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await app.stop();
  });

  it("未登录被带回登录页，教师与教务管理员不能访问学生成绩接口", async () => {
    const anonymousPage = await page("/student");
    expect(anonymousPage.status).toBe(307);
    expect(anonymousPage.headers.get("location") ?? "").toContain("/login");

    const anonymousApi = await api("GET", "/api/student/grades");
    expect(anonymousApi.status).toBe(401);
    expect(await errorOf(anonymousApi)).toBe("请先登录。");

    for (const cookie of [teacherACookie, adminCookie]) {
      const denied = await api("GET", "/api/student/grades", undefined, cookie);
      expect(denied.status).toBe(403);
      expect(await errorOf(denied)).toBe("无权访问。");
    }
  });

  it("未设置当前学期时给出明确提示，而不是空白或报错", async () => {
    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).toContain("尚未设置当前学期");
    expect(html).toContain("联系教务管理员");
    expect(html).not.toContain("Internal Server Error");

    const report = await studentReport();
    expect(report.currentTerm).toBeNull();
    expect(report.term).toBeNull();
    expect(report.courses).toEqual([]);

    await setCurrentTerm(ids.termCurrent);
  });

  it("教师未发布时学生只看到「暂无成绩」，草稿分数与成绩项均不泄露", async () => {
    // 数学与物理此时都是草稿：教师已录分数，学生端一个字段都不应出现。
    const report = await studentReport();
    expect(courseOf(report, ids.classMath).published).toBe(false);
    expect(courseOf(report, ids.classPhysics).published).toBe(false);
    // 草稿教学班只带课程基本信息，不携带任何成绩字段。
    for (const course of report.courses) {
      expect(course.published).toBe(false);
      expect(Object.keys(course).sort()).toEqual(["published", "teachingClass"]);
    }
    const serialized = JSON.stringify(report.courses);
    for (const leaked of ["平时", "期中", "期末", "实验"]) {
      expect(serialized).not.toContain(leaked);
    }

    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).toContain("暂无成绩");
    expect(html).toContain("尚未发布");
    expect(html).not.toContain("平时");
    expect(html).not.toContain("Internal Server Error");

    // 未加入任何教学班是另一种状态，文案必须与「暂无成绩」区分。
    const emptyHtml = await (
      await page("/student", studentEmptyCookie)
    ).text();
    expect(emptyHtml).toContain("还没有加入任何教学班");
    expect(emptyHtml).not.toContain("暂无成绩");

    // 另一个教师的草稿班同样不可见。
    const wangHtml = await (await page("/student", studentWangCookie)).text();
    expect(wangHtml).toContain("暂无成绩");
    expect(wangHtml).not.toContain("平时");
  });

  it("发布后看到总评、成绩项明细与教师覆盖值；缺分显示「未录入」而不是 0", async () => {
    expect((await publish(ids.classMath)).status).toBe(200);
    expect((await publish(ids.classPhysics)).status).toBe(200);

    const zhangReport = await studentReport();
    const math = courseOf(zhangReport, ids.classMath);
    if (!math.published) throw new Error("数学应当已发布");
    expect(math.overall).toMatchObject({
      finalScore: 85,
      finalSource: "computed",
      status: "complete",
    });
    expect(
      math.items.map((item) => ({
        name: item.name,
        maxScore: item.maxScore,
        weight: item.weight,
        score: item.score,
      })),
    ).toEqual([
      { name: "平时", maxScore: 100, weight: 30, score: 80 },
      { name: "期中", maxScore: 100, weight: 30, score: 90 },
      { name: "期末", maxScore: 100, weight: 40, score: 85 },
    ]);
    expect(math.teachingClass.termLabel).toBe("2026-2027 学年上学期");
    expect(math.teachingClass.teacherName).toBe("教师戊");

    // 总评被教师覆盖时，学生拿到的是覆盖值。
    const liReport = await studentReport(studentLiCookie);
    const liMath = courseOf(liReport, ids.classMath);
    if (!liMath.published) throw new Error("数学应当已发布");
    expect(liMath.overall).toMatchObject({
      computedScore: 100,
      overrideScore: 98,
      finalScore: 98,
      finalSource: "override",
      status: "complete",
    });

    // 缺分：总评无法计算，单项得分为 null（不是 0）；真实 0 分仍是 0。
    const physics = courseOf(zhangReport, ids.classPhysics);
    if (!physics.published) throw new Error("物理应当已发布");
    expect(physics.overall.status).toBe("incomplete");
    expect(physics.overall.finalScore).toBeNull();
    expect(
      physics.items.map((item) => ({ name: item.name, score: item.score })),
    ).toEqual([
      { name: "实验", score: null },
      { name: "出勤", score: 0 },
    ]);

    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).toContain("我的成绩");
    expect(html).toContain("总评");
    expect(html).toContain("<strong>85</strong>");
    expect(html).toContain("平时");
    expect(html).toContain("期中");
    expect(html).toContain("期末");
    expect(html).toContain("成绩明细");
    expect(html).toContain("100");
    expect(html).toMatch(/30(<!-- -->)?%/);
    expect(html).toMatch(/40(<!-- -->)?%/);
    // 物理缺分显示「未录入」，真实的 0 分仍显示 0，总评显示「总评未完成」。
    expect(html).toContain("未录入");
    expect(html).toContain("总评未完成");
    expect(html).toContain("实验");
    expect(html).toContain("出勤");
    expect(html).toMatch(/>0</);
    expect(html).not.toContain("<strong>0</strong>");
    expect(html).not.toContain("Internal Server Error");

    const liHtml = await (await page("/student", studentLiCookie)).text();
    expect(liHtml).toContain("<strong>98</strong>");
    expect(liHtml).toContain("教师调整");
    // 不把内部字段名暴露给学生。
    for (const internal of [
      "computedScore",
      "overrideScore",
      "finalSource",
      "教师调整原因",
    ]) {
      expect(liHtml).not.toContain(internal);
    }
  });

  it("学生只能看自己的成绩：构造请求读他人返回 403/404，也不能指定历史学期", async () => {
    const own = await api(
      "GET",
      `/api/student/grades?studentId=${ids.studentZhang}`,
      undefined,
      studentZhangCookie,
    );
    expect(own.status).toBe(200);

    const other = await api(
      "GET",
      `/api/student/grades?studentId=${ids.studentLi}`,
      undefined,
      studentZhangCookie,
    );
    expect(other.status).toBe(403);
    expect(await errorOf(other)).toBe("无权访问。");

    const malformed = await api(
      "GET",
      "/api/student/grades?studentId=not-a-uuid",
      undefined,
      studentZhangCookie,
    );
    expect(malformed.status).toBe(403);

    const byPath = await api(
      "GET",
      `/api/student/grades/${ids.studentLi}`,
      undefined,
      studentZhangCookie,
    );
    expect(byPath.status).toBe(404);

    for (const query of [
      `?termId=${ids.termPast}`,
      "?termId=00000000-0000-4000-8000-000000000000",
      "?termId=not-a-uuid",
    ]) {
      const response = await api(
        "GET",
        `/api/student/grades${query}`,
        undefined,
        studentZhangCookie,
      );
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toContain("当前学期");
    }

    // 张三的成绩里不应出现只在李四班上的英语，或只属于王五的教学班。
    const report = await studentReport();
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("李四");
    expect(serialized).not.toContain("王五");
    expect(serialized).not.toContain("英语");
    expect(serialized).not.toContain("高三 2 班 数学（未发布）");

    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).not.toContain("英语");
    expect(html).not.toContain("高三 2 班 数学（未发布）");
    expect(html).not.toContain("高二 1 班 历史（上学期）");
  });

  it("只显示当前学期：切换当前学期后只出现该学期的成绩", async () => {
    await setCurrentTerm(ids.termPast);

    const report = await studentReport();
    expect(report.currentTerm?.id).toBe(ids.termPast);
    expect(report.courses.map((course) => course.teachingClass.id)).toEqual([
      ids.classHistory,
    ]);
    const history = courseOf(report, ids.classHistory);
    if (!history.published) throw new Error("历史应当已发布");
    expect(history.overall.finalScore).toBe(95);

    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).toContain("2025-2026 学年下学期");
    expect(html).toContain("高二 1 班 历史（上学期）");
    expect(html).not.toContain("平时");
    expect(html).not.toContain("实验");

    await setCurrentTerm(ids.termCurrent);
  });

  it("解锁期间教师改分不提前泄露，重新发布后学生才看到新版本", async () => {
    const unlocked = await api(
      "POST",
      `/api/teaching-classes/${ids.classMath}/unlock`,
      { reason: "期末成绩录入错误，需更正后重新发布" },
      adminCookie,
    );
    expect(unlocked.status).toBe(200);
    expect(
      ((await unlocked.json()) as { lock: { state: string } }).lock.state,
    ).toBe("draft");

    const sheet = await getSheet(ids.classMath);
    const daily = sheet.gradeItems.find((item) => item.name === "平时")!;
    expect(
      (
        await saveScores(ids.classMath, [
          { studentId: ids.studentZhang, gradeItemId: daily.id, score: 50 },
        ])
      ).status,
    ).toBe(200);

    // 教师实时视图已经变了（50×30% + 90×30% + 85×40% = 76），学生仍看旧快照。
    const live = await getSheet(ids.classMath);
    expect(
      live.students.find((student) => student.studentNumber === STUDENT_ZHANG_LOGIN)!
        .overall.finalScore,
    ).toBe(76);

    const report = await studentReport();
    const math = courseOf(report, ids.classMath);
    if (!math.published) throw new Error("应当仍能看到上一次发布的快照");
    expect(math.publication.version).toBe(1);
    expect(math.overall.finalScore).toBe(85);
    expect(math.items.find((item) => item.name === "平时")!.score).toBe(80);

    const lockedHtml = await (
      await page("/student", studentZhangCookie)
    ).text();
    expect(lockedHtml).toContain("<strong>85</strong>");
    expect(lockedHtml).not.toContain("<strong>76</strong>");
    expect(lockedHtml).not.toContain("成绩录入错误");

    expect((await publish(ids.classMath)).status).toBe(200);

    const after = await studentReport();
    const updated = courseOf(after, ids.classMath);
    if (!updated.published) throw new Error("应当已重新发布");
    expect(updated.publication.version).toBe(2);
    expect(updated.overall.finalScore).toBe(76);
    expect(updated.items.find((item) => item.name === "平时")!.score).toBe(50);

    const updatedHtml = await (
      await page("/student", studentZhangCookie)
    ).text();
    expect(updatedHtml).toContain("<strong>76</strong>");
    expect(updatedHtml).toMatch(/>50</);
  });

  it("界面与接口都不出现排名、班级平均分或同班对比", async () => {
    const html = await (await page("/student", studentZhangCookie)).text();
    for (const forbidden of [
      "排名",
      "平均分",
      "班级平均",
      "同班",
      "超过了",
      "百分位",
      "名次",
      "前 10",
      "排名前",
    ]) {
      expect(html, `页面不应出现「${forbidden}」`).not.toContain(forbidden);
    }

    const serialized = JSON.stringify(await studentReport()).toLowerCase();
    for (const forbidden of ["rank", "average", "percentile", "class_avg"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("移动端无需横向滚动即可读完总评与明细", async () => {
    const html = await (await page("/student", studentZhangCookie)).text();
    expect(html).toContain('name="viewport"');
    expect(html).toContain('class="grade-courses"');
    expect(html).toContain('class="grade-items"');
    expect(html).toContain("<details");
    // 学生成绩不使用会横向滚动的宽表。
    expect(html).not.toContain('class="table"');

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

    expect(css).toContain(".grade-courses");
    expect(css).toContain(".grade-items");
    expect(css).toContain(".grade-item");
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.grade-item\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
