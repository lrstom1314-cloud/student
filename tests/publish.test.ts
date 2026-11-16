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

    it("发布需要二次确认；教师发布后学生立即可见，快照保留成绩项与覆盖值", async () => {
      const unconfirmed = await publish(ids.classMain, {});
      expect(unconfirmed.status).toBe(400);
      expect(await errorOf(unconfirmed)).toContain("确认");
      expect((await getSheet(ids.classMain)).lock.state).toBe("draft");

      const byForeignTeacher = await publish(
        ids.classMain,
        { confirmed: true },
        teacherBCookie,
      );
      expect(byForeignTeacher.status).toBe(403);

      const byStudent = await publish(
        ids.classMain,
        { confirmed: true },
        studentCookie,
      );
      expect(byStudent.status).toBe(403);

      const published = await publish(ids.classMain);
      expect(published.status).toBe(200);
      const body = (await published.json()) as {
        publication: PublicationJson;
        lock: LockJson;
        sheet: GradeSheetJson;
      };
      expect(body.publication.version).toBe(1);
      expect(body.lock.state).toBe("published");
      expect(body.lock.latestPublication?.id).toBe(body.publication.id);
      expect(body.sheet.lock.state).toBe("published");

      // 张三看到自己的成绩项明细与总评。
      const zhangCourse = courseOf(
        await studentCourses(),
        ids.classMain,
      );
      expect(zhangCourse.published).toBe(true);
      if (!zhangCourse.published) throw new Error("应当已发布");
      expect(zhangCourse.overall).toMatchObject({
        computedScore: 85,
        overrideScore: null,
        finalScore: 85,
        finalSource: "computed",
        status: "complete",
      });
      expect(
        zhangCourse.items.map((item) => ({
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

      // 李四的总评在发布前被教师覆盖为 98，快照必须记住覆盖值。
      const liCourse = courseOf(await studentCourses(studentBMCookie), ids.classMain);
      if (!liCourse.published) throw new Error("应当已发布");
      expect(liCourse.overall).toMatchObject({
        computedScore: 100,
        overrideScore: 98,
        finalScore: 98,
        finalSource: "override",
        status: "complete",
      });

      const studentPage = await page("/student", studentCookie);
      const html = await studentPage.text();
      expect(html).toContain("平时");
      expect(html).toContain("成绩明细");
      expect(html).toContain("<strong>85</strong>");

      const publications = await queryRows<{
        version: number;
        published_by: string;
      }>(
        app.schema!,
        `select version, published_by from grade_publications
         where teaching_class_id = $1 order by version`,
        [ids.classMain],
      );
      const teacherAId = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [TEACHER_A_LOGIN],
        )
      )[0]!.id;
      expect(publications).toEqual([
        { version: 1, published_by: teacherAId },
      ]);

      const snapshotItems = await queryRows<{
        name: string;
        max_score: string;
        weight: string;
        position: number;
      }>(
        app.schema!,
        `select name, max_score::text as max_score,
           weight::text as weight, position
         from grade_publication_items
         where publication_id = $1 order by position`,
        [body.publication.id],
      );
      expect(snapshotItems).toEqual([
        { name: "平时", max_score: "100.00", weight: "30.00", position: 0 },
        { name: "期中", max_score: "100.00", weight: "30.00", position: 1 },
        { name: "期末", max_score: "100.00", weight: "40.00", position: 2 },
      ]);

      const snapshotOveralls = await queryRows<{
        student_number: string;
        final_score: string | null;
        computed_score: string | null;
        override_score: string | null;
        final_source: string | null;
        status: string;
      }>(
        app.schema!,
        `select student_number, final_score::text as final_score,
           computed_score::text as computed_score,
           override_score::text as override_score, final_source, status
         from grade_publication_overalls
         where publication_id = $1 order by student_number`,
        [body.publication.id],
      );
      expect(snapshotOveralls).toEqual([
        {
          student_number: "s1101",
          final_score: "85.00",
          computed_score: "85.00",
          override_score: null,
          final_source: "computed",
          status: "complete",
        },
        {
          student_number: "s1102",
          final_score: "98.00",
          computed_score: "100.00",
          override_score: "98.00",
          final_source: "override",
          status: "complete",
        },
      ]);

      const snapshotScores = await queryRows<{ count: number }>(
        app.schema!,
        `select count(*)::int as count from grade_publication_scores
         where publication_id = $1`,
        [body.publication.id],
      );
      expect(snapshotScores[0]!.count).toBe(6);

      const again = await publish(ids.classMain);
      expect(again.status).toBe(409);
      expect(await errorOf(again)).toContain("解锁");
    });
  });

  describe("锁定语义", () => {
    it("锁定期间教师与教务管理员的任何成绩写入都被拒绝", async () => {
      const before = await getSheet(ids.classMain);
      const item = before.gradeItems[0]!;
      const zhang = before.students.find(
        (student) => student.studentNumber === "s1101",
      )!;
      const li = before.students.find(
        (student) => student.studentNumber === "s1102",
      )!;

      const attempts: Array<{ name: string; response: Response }> = [
        {
          name: "教师新增成绩项",
          response: await api(
            "POST",
            `/api/teaching-classes/${ids.classMain}/grade-items`,
            { name: "锁定项", maxScore: 100, weight: 10 },
            teacherACookie,
          ),
        },
        {
          name: "管理员新增成绩项",
          response: await api(
            "POST",
            `/api/teaching-classes/${ids.classMain}/grade-items`,
            { name: "管理员锁定项", maxScore: 100, weight: 10 },
            adminCookie,
          ),
        },
        {
          name: "教师保存得分",
          response: await saveScores(ids.classMain, [
            { studentId: zhang.id, gradeItemId: item.id, score: 10 },
          ]),
        },
        {
          name: "管理员保存得分",
          response: await saveScores(
            ids.classMain,
            [{ studentId: zhang.id, gradeItemId: item.id, score: 10 }],
            adminCookie,
          ),
        },
        {
          name: "教师覆盖总评",
          response: await api(
            "PUT",
            `/api/teaching-classes/${ids.classMain}/overalls/${zhang.id}`,
            { score: 60 },
            teacherACookie,
          ),
        },
        {
          name: "管理员覆盖总评",
          response: await api(
            "PUT",
            `/api/teaching-classes/${ids.classMain}/overalls/${zhang.id}`,
            { score: 60 },
            adminCookie,
          ),
        },
        {
          name: "教师取消覆盖",
          response: await api(
            "DELETE",
            `/api/teaching-classes/${ids.classMain}/overalls/${li.id}`,
            undefined,
            teacherACookie,
          ),
        },
        {
          name: "管理员取消覆盖",
          response: await api(
            "DELETE",
            `/api/teaching-classes/${ids.classMain}/overalls/${li.id}`,
            undefined,
            adminCookie,
          ),
        },
      ];

      for (const attempt of attempts) {
        expect(
          attempt.response.status,
          `${attempt.name} 应当被拒绝`,
        ).toBe(409);
        expect(await errorOf(attempt.response)).toContain("解锁");
      }

      const after = await getSheet(ids.classMain);
      expect(after.students).toEqual(before.students);
      expect(after.gradeItems).toEqual(before.gradeItems);

      const itemCount = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from grade_items where teaching_class_id = $1",
        [ids.classMain],
      );
      expect(itemCount[0]!.count).toBe(3);

      const course = courseOf(await studentCourses(), ids.classMain);
      if (!course.published) throw new Error("应当仍为已发布");
      expect(course.overall.finalScore).toBe(85);
    });
  });

  describe("解锁", () => {
    it("解锁必须由教务管理员填写理由，教师尝试解锁返回 403", async () => {
      const reason = "期末成绩录入错误，需更正后重新发布";

      const byTeacher = await unlock(
        ids.classMain,
        { reason },
        teacherACookie,
      );
      expect(byTeacher.status).toBe(403);
      expect(await errorOf(byTeacher)).toContain("教务管理员");

      const noReason = await unlock(ids.classMain, {});
      expect(noReason.status).toBe(400);
      expect(await errorOf(noReason)).toContain("理由");

      const blankReason = await unlock(ids.classMain, { reason: "   " });
      expect(blankReason.status).toBe(400);
      expect(await errorOf(blankReason)).toContain("理由");

      // 失败的解锁不能改变状态：仍然锁定、仍然拒绝写入。
      expect((await getSheet(ids.classMain)).lock.state).toBe("published");
      const zhang = (await getSheet(ids.classMain)).students.find(
        (student) => student.studentNumber === "s1101",
      )!;
      const stillLocked = await saveScores(ids.classMain, [
        {
          studentId: zhang.id,
          gradeItemId: (await getSheet(ids.classMain)).gradeItems[0]!.id,
          score: 50,
        },
      ]);
      expect(stillLocked.status).toBe(409);

      const byStudent = await unlock(
        ids.classMain,
        { reason },
        studentCookie,
      );
      expect(byStudent.status).toBe(403);

      const unlocked = await unlock(ids.classMain, { reason });
      expect(unlocked.status).toBe(200);
      const body = (await unlocked.json()) as {
        lock: LockJson;
        sheet: GradeSheetJson;
      };
      expect(body.lock.state).toBe("draft");
      expect(body.lock.latestPublication?.version).toBe(1);

      const stateRow = await queryRows<{ grade_state: string }>(
        app.schema!,
        "select grade_state from teaching_classes where id = $1",
        [ids.classMain],
      );
      expect(stateRow).toEqual([{ grade_state: "draft" }]);

      const unlockLogs = await queryRows<{
        action: string;
        target: string;
        reason: string | null;
        student_id: string | null;
        actor_account_id: string;
        old_value: string | null;
        new_value: string | null;
      }>(
        app.schema!,
        `select action, target, reason, student_id, actor_account_id,
           old_value::text as old_value, new_value::text as new_value
         from grade_change_logs
         where teaching_class_id = $1 and action = 'unlock'`,
        [ids.classMain],
      );
      const adminId = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [ADMIN_LOGIN],
        )
      )[0]!.id;
      expect(unlockLogs).toEqual([
        {
          action: "unlock",
          target: "teaching_class",
          reason,
          student_id: null,
          actor_account_id: adminId,
          old_value: null,
          new_value: null,
        },
      ]);

      // 学生仍然看到上一次发布的快照。
      const course = courseOf(await studentCourses(), ids.classMain);
      if (!course.published) throw new Error("应当仍能看到旧快照");
      expect(course.publication.version).toBe(1);
      expect(course.overall.finalScore).toBe(85);
    });

    it("解锁后教师可继续修改，学生仍看到上一次发布的快照而非草稿", async () => {
      const sheet = await getSheet(ids.classMain);
      const daily = sheet.gradeItems[0]!;
      const zhang = sheet.students.find(
        (student) => student.studentNumber === "s1101",
      )!;

      const saved = await saveScores(ids.classMain, [
        { studentId: zhang.id, gradeItemId: daily.id, score: 50 },
      ]);
      expect(saved.status).toBe(200);

      const live = await getSheet(ids.classMain);
      expect(
        live.students.find((student) => student.studentNumber === "s1101")!
          .grades[daily.id],
      ).toBe(50);
      // 50 × 30% + 90 × 30% + 85 × 40% = 76。
      expect(
        live.students.find((student) => student.studentNumber === "s1101")!
          .overall.finalScore,
      ).toBe(76);
      expect(live.lock.state).toBe("draft");

      const course = courseOf(await studentCourses(), ids.classMain);
      if (!course.published) throw new Error("应当仍能看到旧快照");
      expect(course.publication.version).toBe(1);
      expect(course.overall.finalScore).toBe(85);
      expect(course.items.find((item) => item.name === "平时")!.score).toBe(80);

      const studentPage = await page("/student", studentCookie);
      const html = await studentPage.text();
      expect(html).toContain("<strong>85</strong>");
      expect(html).not.toContain("<strong>76</strong>");

      // 旧快照没有被解锁期间的写入污染。
      const snapshot = await queryRows<{ score: string }>(
        app.schema!,
        `select score::text as score from grade_publication_scores
         where publication_id = $1
           and grade_item_id = $2
           and student_id = $3`,
        [course.publication.id, daily.id, zhang.id],
      );
      expect(snapshot).toEqual([{ score: "80.00" }]);
    });

    it("修改后再次发布，学生看到新版本", async () => {
      const published = await publish(ids.classMain);
      expect(published.status).toBe(200);
      const body = (await published.json()) as {
        publication: PublicationJson;
      };
      expect(body.publication.version).toBe(2);

      const course = courseOf(await studentCourses(), ids.classMain);
      if (!course.published) throw new Error("应当已发布");
      expect(course.publication.version).toBe(2);
      expect(course.overall.finalScore).toBe(76);
      expect(course.items.find((item) => item.name === "平时")!.score).toBe(50);

      const studentPage = await page("/student", studentCookie);
      expect(await studentPage.text()).toContain("76");

      const versions = await queryRows<{ version: number }>(
        app.schema!,
        `select version from grade_publications
         where teaching_class_id = $1 order by version`,
        [ids.classMain],
      );
      expect(versions.map((row) => row.version)).toEqual([1, 2]);

      // 第一版快照原样保留，历史结果可追溯。
      const firstVersion = (
        await queryRows<{ id: string }>(
          app.schema!,
          `select id from grade_publications
           where teaching_class_id = $1 and version = 1`,
          [ids.classMain],
        )
      )[0]!.id;
      const firstOverall = await queryRows<{ final_score: string | null }>(
        app.schema!,
        `select final_score::text as final_score
         from grade_publication_overalls
         where publication_id = $1
           and student_number = 's1101'`,
        [firstVersion],
      );
      expect(firstOverall).toEqual([{ final_score: "85.00" }]);
    });
  });

  describe("变更日志", () => {
    it("日志记录录入、修改、覆盖总评、发布与解锁，含操作人、学生、项目与新旧值", async () => {
      const logs = await classLogs(ids.classMain);
      expect(logs.length).toBeGreaterThan(0);

      for (const entry of logs) {
        expect(entry.actor.displayName.length).toBeGreaterThan(0);
        expect(entry.actor.loginName.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(entry.createdAt))).toBe(false);
        expect(entry.teachingClass.id).toBe(ids.classMain);
      }

      // 时间倒序。
      for (let index = 1; index < logs.length; index += 1) {
        expect(Date.parse(logs[index - 1]!.createdAt)).toBeGreaterThanOrEqual(
          Date.parse(logs[index]!.createdAt),
        );
      }

      const actions = new Set(logs.map((entry) => entry.action));
      for (const action of [
        "record",
        "update",
        "override_overall",
        "publish",
        "unlock",
      ]) {
        expect(actions.has(action), `缺少动作 ${action}`).toBe(true);
      }

      const publishes = logs.filter((entry) => entry.action === "publish");
      expect(publishes).toHaveLength(2);
      for (const entry of publishes) {
        expect(entry.target).toBe("teaching_class");
        expect(entry.student).toBeNull();
        expect(entry.gradeItem).toBeNull();
      }

      const unlocks = logs.filter((entry) => entry.action === "unlock");
      expect(unlocks).toHaveLength(1);
      expect(unlocks[0]!.reason).toContain("更正");

      const update = logs.find(
        (entry) =>
          entry.action === "update" &&
          entry.gradeItem?.name === "平时" &&
          entry.student?.studentNumber === "s1101",
      );
      expect(update).toMatchObject({
        target: "grade_item",
        oldValue: 80,
        newValue: 50,
      });
      expect(update!.student!.name).toBe("张三");

      const override = logs.find(
        (entry) =>
          entry.action === "override_overall" &&
          entry.student?.studentNumber === "s1102",
      );
      expect(override).toMatchObject({
        target: "overall",
        newValue: 98,
        student: { name: "李四" },
      });

      const records = logs.filter(
        (entry) => entry.action === "record" && entry.target === "grade_item",
      );
      expect(records.length).toBeGreaterThan(0);
      expect(
        records.every(
          (entry) => entry.oldValue === null && entry.newValue !== null,
        ),
      ).toBe(true);
    });

    it("管理员可按教学班与按学生查询；教师只能查自己任教的教学班", async () => {
      // 给第二个教学班制造日志，验证按学生查询会跨教学班。
      await createGradeItemOk(ids.classSecond, {
        name: "单元测验",
        maxScore: 100,
        weight: 100,
      });
      const secondSheet = await getSheet(ids.classSecond);
      expect(
        (
          await saveScores(ids.classSecond, [
            {
              studentId: secondSheet.students[0]!.id,
              gradeItemId: secondSheet.gradeItems[0]!.id,
              score: 88,
            },
          ])
        ).status,
      ).toBe(200);
      expect((await publish(ids.classSecond)).status).toBe(200);

      const adminClassLogs = await classLogs(ids.classMain, adminCookie);
      const teacherClassLogs = await classLogs(ids.classMain, teacherACookie);
      expect(teacherClassLogs.map((entry) => entry.id)).toEqual(
        adminClassLogs.map((entry) => entry.id),
      );

      const foreign = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grade-logs`,
        undefined,
        teacherBCookie,
      );
      expect(foreign.status).toBe(403);

      const byStudentOnClassEndpoint = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grade-logs`,
        undefined,
        studentCookie,
      );
      expect(byStudentOnClassEndpoint.status).toBe(403);

      const anonymous = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grade-logs`,
      );
      expect(anonymous.status).toBe(401);

      const zhangId = ids.studentZhang;
      const zhangLogs = await studentLogs(zhangId);
      const classIds = new Set(
        zhangLogs.map((entry) => entry.teachingClass.id),
      );
      expect(classIds.has(ids.classMain)).toBe(true);
      expect(classIds.has(ids.classSecond)).toBe(true);
      expect(
        zhangLogs.every(
          (entry) =>
            entry.student === null || entry.student.id === zhangId,
        ),
      ).toBe(true);
      const zhangPublishes = zhangLogs.filter(
        (entry) => entry.action === "publish",
      );
      expect(
        zhangPublishes.filter(
          (entry) => entry.teachingClass.id === ids.classMain,
        ),
      ).toHaveLength(2);
      expect(
        zhangPublishes.filter(
          (entry) => entry.teachingClass.id === ids.classSecond,
        ),
      ).toHaveLength(1);

      const byTeacherOnStudentEndpoint = await api(
        "GET",
        `/api/admin/students/${zhangId}/grade-logs`,
        undefined,
        teacherACookie,
      );
      expect(byTeacherOnStudentEndpoint.status).toBe(403);

      const filtered = await api(
        "GET",
        `/api/teaching-classes/${ids.classMain}/grade-logs?studentId=${zhangId}`,
        undefined,
        adminCookie,
      );
      expect(filtered.status).toBe(200);
      const filteredLogs = (
        (await filtered.json()) as { logs: LogEntryJson[] }
      ).logs;
      expect(filteredLogs.length).toBeGreaterThan(0);
      expect(
        filteredLogs.every(
          (entry) =>
            entry.student === null || entry.student.id === zhangId,
        ),
      ).toBe(true);

      const missing = await api(
        "GET",
        `/api/admin/students/00000000-0000-4000-8000-000000000000/grade-logs`,
        undefined,
        adminCookie,
      );
      expect(missing.status).toBe(404);
    });

    it("锁定界面只读并给出解锁入口，日志页面展示理由与动作", async () => {
      const teacherPage = await page(
        `/teacher/teaching-classes/${ids.classMain}/grades`,
        teacherACookie,
      );
      expect(teacherPage.status).toBe(200);
      const teacherHtml = await teacherPage.text();
      expect(teacherHtml).toContain("已发布并锁定");
      expect(teacherHtml).not.toContain("data-cell-row=");
      expect(teacherHtml).not.toContain("确认发布");
      expect(teacherHtml).toContain("变更日志");

      const adminPage = await page(
        `/admin/teaching-classes/${ids.classMain}/grades`,
        adminCookie,
      );
      expect(adminPage.status).toBe(200);
      const adminHtml = await adminPage.text();
      expect(adminHtml).toContain("解锁理由");
      expect(adminHtml).toContain('name="reason"');
      expect(adminHtml).toContain("确认解锁");

      const teacherLogsPage = await page(
        `/teacher/teaching-classes/${ids.classMain}/grade-logs`,
        teacherACookie,
      );
      expect(teacherLogsPage.status).toBe(200);
      const teacherLogsHtml = await teacherLogsPage.text();
      expect(teacherLogsHtml).toContain("成绩变更日志");
      expect(teacherLogsHtml).toContain("解锁");
      expect(teacherLogsHtml).toContain("期末成绩录入错误");

      const adminLogsPage = await page(
        `/admin/grade-logs?teachingClassId=${ids.classMain}`,
        adminCookie,
      );
      expect(adminLogsPage.status).toBe(200);
      const adminLogsHtml = await adminLogsPage.text();
      expect(adminLogsHtml).toContain("成绩变更日志");
      expect(adminLogsHtml).toContain("发布");
      expect(adminLogsHtml).toContain("期末成绩录入错误");

      const byStudentPage = await page(
        `/admin/grade-logs?studentId=${ids.studentZhang}`,
        adminCookie,
      );
      expect(byStudentPage.status).toBe(200);
      const byStudentHtml = await byStudentPage.text();
      expect(byStudentHtml).toContain("张三");
      expect(byStudentHtml).toContain("高二 2 班 数学（二班）");

      // 草稿页面展示发布前的二次确认文案，且仍可编辑。
      await createGradeItemOk(
        ids.classOther,
        { name: "平时", maxScore: 100, weight: 100 },
        teacherBCookie,
      );
      const draftPage = await page(
        `/teacher/teaching-classes/${ids.classOther}/grades`,
        teacherBCookie,
      );
      expect(draftPage.status).toBe(200);
      const draftHtml = await draftPage.text();
      expect(draftHtml).toContain("发布后全体学生将立即看到本次成绩");
      expect(draftHtml).toContain("需教务管理员解锁");
      expect(draftHtml).toContain("确认发布");
      expect(draftHtml).toContain("data-cell-row=");
      expect(draftHtml).toContain("当前为草稿");
    });
  });
});
