import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin11";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t11001";
const TEACHER_B_LOGIN = "t11002";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentCookie = "";
let studentBMCookie = "";

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
  grades: Record<string, number | null>;
  overall: OverallJson;
};

type PublicationJson = { id: string; version: number; publishedAt: string };

type LockJson = {
  state: "draft" | "published";
  latestPublication: PublicationJson | null;
};

type GradeSheetJson = {
  teachingClass: { id: string; displayName: string };
  gradeItems: GradeItemJson[];
  students: SheetStudentJson[];
  lock: LockJson;
};

type StudentCourseJson = {
  teachingClass: {
    id: string;
    displayName: string;
    courseName: string;
    teacherName: string;
    termLabel: string;
  };
  published: false;
} | {
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

type LogEntryJson = {
  id: string;
  createdAt: string;
  action: string;
  target: string;
  reason: string | null;
  oldValue: number | null;
  newValue: number | null;
  actor: { id: string; displayName: string; loginName: string };
  student: { id: string; studentNumber: string; name: string } | null;
  gradeItem: { id: string; name: string } | null;
  teachingClass: { id: string; displayName: string };
};

const ids = {
  termId: "",
  courseId: "",
  administrativeClassId: "",
  studentZhang: "",
  studentLi: "",
  studentWang: "",
  classMain: "",
  classOther: "",
  classSecond: "",
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

async function createGradeItemOk(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<{ gradeItem: GradeItemJson; sheet: GradeSheetJson }> {
  const response = await api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/grade-items`,
    body,
    cookie,
  );
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

async function publish(
  teachingClassId: string,
  body: Json = { confirmed: true },
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/publish`,
    body,
    cookie,
  );
}

async function unlock(
  teachingClassId: string,
  body: Json,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/unlock`,
    body,
    cookie,
  );
}

async function studentCourses(cookie: string = studentCookie) {
  const response = await api("GET", "/api/student/grades", undefined, cookie);
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      currentTerm: { id: string; label: string } | null;
      term: { id: string; label: string } | null;
      courses: StudentCourseJson[];
    }
  ).courses;
}

function courseOf(
  courses: StudentCourseJson[],
  teachingClassId: string,
): StudentCourseJson {
  const course = courses.find(
    (entry) => entry.teachingClass.id === teachingClassId,
  );
  if (!course) throw new Error(`学生成绩中没有教学班 ${teachingClassId}`);
  return course;
}

async function classLogs(
  teachingClassId: string,
  cookie: string = adminCookie,
): Promise<LogEntryJson[]> {
  const response = await api(
    "GET",
    `/api/teaching-classes/${teachingClassId}/grade-logs`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { logs: LogEntryJson[] }).logs;
}

async function studentLogs(
  studentId: string,
  cookie: string = adminCookie,
): Promise<LogEntryJson[]> {
  const response = await api(
    "GET",
    `/api/admin/students/${studentId}/grade-logs`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { logs: LogEntryJson[] }).logs;
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

describe("发布、锁定与变更日志", () => {
  beforeAll(async () => {
    app = await startTestApp();

    bootstrapAccount({
      loginName: ADMIN_LOGIN,
      displayName: "教务乙",
      role: "administrator",
      password: ADMIN_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_A_LOGIN,
      displayName: "教师丙",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_B_LOGIN,
      displayName: "教师丁",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    for (const [loginName, displayName] of [
      ["s1101", "张三"],
      ["s1102", "李四"],
      ["s1103", "王五"],
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
    studentCookie = await login("s1101", ACCOUNT_PASSWORD);
    studentBMCookie = await login("s1102", ACCOUNT_PASSWORD);

    const year = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2027 },
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

    const currentTerm = await api(
      "POST",
      "/api/admin/current-term",
      { termId: ids.termId, confirmed: true },
      adminCookie,
    );
    expect(currentTerm.status).toBe(200);

    const administrativeClass = await api(
      "POST",
      "/api/admin/administrative-classes",
      { name: "高二 2 班" },
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
      { name: "数学", credits: 4 },
      adminCookie,
    );
    expect(course.status).toBe(201);
    ids.courseId = ((await course.json()) as { course: { id: string } })
      .course.id;

    ids.studentZhang = await createStudent({
      studentNumber: "s1101",
      name: "张三",
    });
    ids.studentLi = await createStudent({
      studentNumber: "s1102",
      name: "李四",
    });
    ids.studentWang = await createStudent({
      studentNumber: "s1103",
      name: "王五",
    });

    ids.classMain = await createTeachingClass({
      teacherLogin: TEACHER_A_LOGIN,
      displayName: "高二 2 班 数学",
      studentIds: [ids.studentZhang, ids.studentLi],
    });
    ids.classOther = await createTeachingClass({
      teacherLogin: TEACHER_B_LOGIN,
      displayName: "高二 2 班 数学（丁）",
      studentIds: [ids.studentWang],
    });
    ids.classSecond = await createTeachingClass({
      teacherLogin: TEACHER_A_LOGIN,
      displayName: "高二 2 班 数学（二班）",
      studentIds: [ids.studentZhang],
    });
  }, 240_000);

  afterAll(async () => {
    await app.stop();
  });

  describe("草稿与发布", () => {
    it("草稿态学生看不到任何成绩数据：既不是 0 分，也不是未完成", async () => {
      await createGradeItemOk(ids.classMain, {
        name: "平时",
        maxScore: 100,
        weight: 30,
      });
      await createGradeItemOk(ids.classMain, {
        name: "期中",
        maxScore: 100,
        weight: 30,
      });
      await createGradeItemOk(ids.classMain, {
        name: "期末",
        maxScore: 100,
        weight: 40,
      });

      const sheet = await getSheet(ids.classMain);
      const zhang = sheet.students.find(
        (student) => student.studentNumber === "s1101",
      )!;
      const li = sheet.students.find(
        (student) => student.studentNumber === "s1102",
      )!;
      const items = sheet.gradeItems;

      expect(
        (
          await saveScores(ids.classMain, [
            { studentId: zhang.id, gradeItemId: items[0]!.id, score: 80 },
            { studentId: zhang.id, gradeItemId: items[1]!.id, score: 90 },
            { studentId: zhang.id, gradeItemId: items[2]!.id, score: 85 },
            { studentId: li.id, gradeItemId: items[0]!.id, score: 100 },
            { studentId: li.id, gradeItemId: items[1]!.id, score: 100 },
            { studentId: li.id, gradeItemId: items[2]!.id, score: 100 },
          ])
        ).status,
      ).toBe(200);

      // 教师的实时视图里已有成绩，但学生端在发布前必须完全看不到。
      expect(sheet.lock).toEqual({
        state: "draft",
        latestPublication: null,
      });

      const courses = await studentCourses();
      const course = courseOf(courses, ids.classMain);
      expect(course.published).toBe(false);
      const serialized = JSON.stringify(course);
      expect(serialized).not.toContain("平时");
      expect(serialized).not.toContain("incomplete");
      expect(serialized).not.toContain("85");
      expect(serialized).not.toContain("未完成");

      const studentPage = await page("/student", studentCookie);
      expect(studentPage.status).toBe(200);
      const html = await studentPage.text();
      expect(html).toContain("暂无成绩");
      expect(html).not.toContain("平时");
      expect(html).not.toContain("未完成");

      // 有覆盖值的李四同样不可见；这个覆盖用于验证快照会保存覆盖值。
      const override = await api(
        "PUT",
        `/api/teaching-classes/${ids.classMain}/overalls/${li.id}`,
        { score: 98 },
        teacherACookie,
      );
      expect(override.status).toBe(200);
      expect(
        (await studentCourses()).every(
          (entry) =>
            entry.teachingClass.id !== ids.classMain ||
            entry.published === false,
        ),
      ).toBe(true);
    });
  });
});
