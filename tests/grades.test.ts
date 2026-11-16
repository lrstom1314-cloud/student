import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin10";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t10001";
const TEACHER_B_LOGIN = "t10002";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentCookie = "";

type Json = Record<string, unknown>;

type GradeItemJson = {
  id: string;
  name: string;
  maxScore: number;
  weight: number;
};

type OverallJson = {
  computedScore: number | null;
  overrideScore: number | null;
  finalScore: number | null;
  finalSource: "computed" | "override" | null;
  status: "complete" | "incomplete";
  missingGradeItemIds: string[];
};

type SheetStudentJson = {
  id: string;
  studentNumber: string;
  name: string;
  administrativeClass: { id: string; name: string };
  grades: Record<string, number | null>;
  overall: OverallJson;
};

type GradeSheetJson = {
  teachingClass: { id: string; displayName: string };
  gradeItems: GradeItemJson[];
  weightTotal: number;
  weightComplete: boolean;
  weightWarning: string | null;
  students: SheetStudentJson[];
};

const ids = {
  termId: "",
  courseId: "",
  administrativeClassId: "",
  studentZhang: "",
  studentLi: "",
  studentWang: "",
  studentZhao: "",
  classMain: "",
  classOther: "",
  classRounding: "",
  classValidation: "",
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

async function createGradeItem(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/grade-items`,
    body,
    cookie,
  );
}

async function createGradeItemOk(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<{ gradeItem: GradeItemJson; sheet: GradeSheetJson }> {
  const response = await createGradeItem(teachingClassId, body, cookie);
  expect(response.status).toBe(201);
  return (await response.json()) as {
    gradeItem: GradeItemJson;
    sheet: GradeSheetJson;
  };
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
  scores: Array<{
    studentId: string;
    gradeItemId: string;
    score: number | string | null;
  }>,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "PUT",
    `/api/teaching-classes/${teachingClassId}/grades`,
    { scores },
    cookie,
  );
}

async function createTeachingClass(input: {
  teacherLogin: string;
  displayName: string;
  studentIds: string[];
}): Promise<string> {
  const teacherId = (
    await queryRows<{ id: string }>(
      app.schema!,
      "select id from accounts where login_name = $1",
      [input.teacherLogin],
    )
  )[0]!.id;

  const created = await api(
    "POST",
    "/api/admin/teaching-classes",
    {
      termId: ids.termId,
      courseId: ids.courseId,
      teacherAccountId: teacherId,
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

async function createStudent(input: {
  studentNumber: string;
  name: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/students",
    {
      studentNumber: input.studentNumber,
      name: input.name,
      administrativeClassId: ids.administrativeClassId,
      initialPassword: ACCOUNT_PASSWORD,
    },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { student: { id: string } }).student.id;
}

describe("成绩项与总评计算", () => {
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
      ["s1001", "张三"],
      ["s1002", "李四"],
      ["s1003", "王五"],
      ["s1004", "赵六"],
    ]) {
      bootstrapAccount({
        loginName: loginName!,
        displayName: displayName!,
        role: "student",
        password: ACCOUNT_PASSWORD,
      });
    }

    adminCookie = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
    teacherACookie = await login(TEACHER_A_LOGIN, ACCOUNT_PASSWORD);
    teacherBCookie = await login(TEACHER_B_LOGIN, ACCOUNT_PASSWORD);
    studentCookie = await login("s1001", ACCOUNT_PASSWORD);

    const year = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2026 },
      adminCookie,
    );
    expect(year.status).toBe(201);
    const yearId = (
      (await year.json()) as { academicYear: { id: string } }
    ).academicYear.id;

    const term = await api(
      "POST",
      "/api/admin/terms",
      { academicYearId: yearId, half: "first" },
      adminCookie,
    );
    expect(term.status).toBe(201);
    ids.termId = ((await term.json()) as { term: { id: string } }).term.id;

    const administrativeClass = await api(
      "POST",
      "/api/admin/administrative-classes",
      { name: "高一 1 班" },
      adminCookie,
    );
    expect(administrativeClass.status).toBe(201);
    ids.administrativeClassId = (
      (await administrativeClass.json()) as {
        administrativeClass: { id: string };
      }
    ).administrativeClass.id;

    const course = await api(
      "POST",
      "/api/admin/courses",
      { name: "语文", credits: 3 },
      adminCookie,
    );
    expect(course.status).toBe(201);
    ids.courseId = ((await course.json()) as { course: { id: string } }).course.id;

    ids.studentZhang = await createStudent({
      studentNumber: "s1001",
      name: "张三",
    });
    ids.studentLi = await createStudent({
      studentNumber: "s1002",
      name: "李四",
    });
    ids.studentWang = await createStudent({
      studentNumber: "s1003",
      name: "王五",
    });
    ids.studentZhao = await createStudent({
      studentNumber: "s1004",
      name: "赵六",
    });

    ids.classMain = await createTeachingClass({
      teacherLogin: TEACHER_A_LOGIN,
      displayName: "高一 1 班 语文",
      studentIds: [ids.studentZhang, ids.studentLi],
    });
    ids.classOther = await createTeachingClass({
      teacherLogin: TEACHER_B_LOGIN,
      displayName: "高一 1 班 语文（乙）",
      studentIds: [ids.studentWang],
    });
    ids.classRounding = await createTeachingClass({
      teacherLogin: TEACHER_A_LOGIN,
      displayName: "高一 1 班 语文（舍入）",
      studentIds: [ids.studentZhao],
    });
    ids.classValidation = await createTeachingClass({
      teacherLogin: TEACHER_A_LOGIN,
      displayName: "高一 1 班 语文（校验）",
      studentIds: [ids.studentLi],
    });
  }, 180_000);

  afterAll(async () => {
    await app.stop();
  });

  describe("成绩项", () => {
    it("教师可为自己任教的教学班定义成绩项：名称、满分、权重", async () => {
      const first = await createGradeItemOk(ids.classMain, {
        name: "平时",
        maxScore: 100,
        weight: 30,
      });
      expect(first.gradeItem).toMatchObject({
        name: "平时",
        maxScore: 100,
        weight: 30,
      });
      expect(first.sheet.weightTotal).toBe(30);

      await createGradeItemOk(ids.classMain, {
        name: "期中",
        maxScore: 100,
        weight: 30,
      });
      const third = await createGradeItemOk(ids.classMain, {
        name: "期末",
        maxScore: 100,
        weight: 40,
      });

      expect(third.sheet.weightTotal).toBe(100);
      expect(third.sheet.weightComplete).toBe(true);
      expect(third.sheet.weightWarning).toBeNull();
      expect(third.sheet.gradeItems.map((item) => item.name)).toEqual([
        "平时",
        "期中",
        "期末",
      ]);

      const rows = await queryRows<{
        name: string;
        max_score: string;
        weight: string;
      }>(
        app.schema!,
        `select name, max_score::text as max_score, weight::text as weight
         from grade_items
         where teaching_class_id = $1
         order by created_at`,
        [ids.classMain],
      );
      expect(rows).toEqual([
        { name: "平时", max_score: "100.00", weight: "30.00" },
        { name: "期中", max_score: "100.00", weight: "30.00" },
        { name: "期末", max_score: "100.00", weight: "40.00" },
      ]);
    });

    it("权重合计不等于 100 时给出提示，但不阻塞保存", async () => {
      const response = await createGradeItem(ids.classRounding, {
        name: "小测",
        maxScore: 320,
        weight: 40,
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { sheet: GradeSheetJson };

      expect(body.sheet.weightTotal).toBe(40);
      expect(body.sheet.weightComplete).toBe(false);
      expect(body.sheet.weightWarning).toContain("40%");
      expect(body.sheet.weightWarning).toContain("不等于 100%");
      expect(body.sheet.gradeItems).toHaveLength(1);
    });

    it("成绩项参数不合法或重名时返回可读的中文错误，且不写入", async () => {
      const cases: Array<{ body: Json; word: string; status: number }> = [
        {
          body: { name: "  ", maxScore: 100, weight: 10 },
          word: "名称",
          status: 400,
        },
        {
          body: { name: "零满分", maxScore: 0, weight: 10 },
          word: "满分",
          status: 400,
        },
        {
          body: { name: "负满分", maxScore: -5, weight: 10 },
          word: "满分",
          status: 400,
        },
        {
          body: { name: "零权重", maxScore: 100, weight: 0 },
          word: "权重",
          status: 400,
        },
        {
          body: { name: "超权重", maxScore: 100, weight: 101 },
          word: "权重",
          status: 400,
        },
        {
          body: { name: "三分小数", maxScore: 100.123, weight: 10 },
          word: "满分",
          status: 400,
        },
      ];

      for (const item of cases) {
        const response = await createGradeItem(ids.classValidation, item.body);
        expect(response.status).toBe(item.status);
        expect(await errorOf(response)).toContain(item.word);
      }

      const duplicate = await createGradeItem(ids.classMain, {
        name: "平时",
        maxScore: 50,
        weight: 10,
      });
      expect(duplicate.status).toBe(409);
      const duplicateError = await errorOf(duplicate);
      expect(duplicateError).toContain("同名");
      expect(duplicateError).not.toContain("constraint");
      expect(duplicateError).not.toContain("duplicate");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from grade_items where teaching_class_id = $1",
        [ids.classValidation],
      );
      expect(rows[0]!.count).toBe(0);
    });

    it("只有任教教师与教务管理员能读写成绩，学生返回 403", async () => {
      const foreign = await createGradeItem(
        ids.classMain,
        { name: "越权项", maxScore: 100, weight: 10 },
        teacherBCookie,
      );
      expect(foreign.status).toBe(403);
      expect(await errorOf(foreign)).toBe("无权访问。");

      const byStudent = await createGradeItem(
        ids.classMain,
        { name: "学生项", maxScore: 100, weight: 10 },
        studentCookie,
      );
      expect(byStudent.status).toBe(403);

      const foreignRead = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grades`,
        undefined,
        teacherBCookie,
      );
      expect(foreignRead.status).toBe(403);

      const studentRead = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grades`,
        undefined,
        studentCookie,
      );
      expect(studentRead.status).toBe(403);

      const anonymous = await createGradeItem(
        ids.classMain,
        { name: "匿名项", maxScore: 100, weight: 10 },
        "",
      );
      expect(anonymous.status).toBe(401);

      const byAdmin = await createGradeItemOk(
        ids.classValidation,
        { name: "管理员项", maxScore: 100, weight: 10 },
        adminCookie,
      );
      expect(byAdmin.gradeItem.name).toBe("管理员项");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from grade_items where name like '%越权%' or name like '%学生项%' or name like '%匿名项%'",
      );
      expect(rows[0]!.count).toBe(0);
    });
  });
});
