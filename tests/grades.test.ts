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

async function setOverall(
  teachingClassId: string,
  studentId: string,
  score: unknown,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "PUT",
    `/api/teaching-classes/${teachingClassId}/overalls/${studentId}`,
    { score },
    cookie,
  );
}

async function cancelOverall(
  teachingClassId: string,
  studentId: string,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "DELETE",
    `/api/teaching-classes/${teachingClassId}/overalls/${studentId}`,
    undefined,
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

    it("成绩网格返回全部学生 × 全部成绩项，未录入时总评为未完成", async () => {
      const sheet = await getSheet(ids.classMain);

      expect(sheet.teachingClass.id).toBe(ids.classMain);
      expect(sheet.gradeItems.map((item) => item.name)).toEqual([
        "平时",
        "期中",
        "期末",
      ]);
      expect(
        sheet.students.map((student) => student.studentNumber),
      ).toEqual(["s1001", "s1002"]);

      for (const student of sheet.students) {
        expect(student.grades).toEqual({
          [sheet.gradeItems[0]!.id]: null,
          [sheet.gradeItems[1]!.id]: null,
          [sheet.gradeItems[2]!.id]: null,
        });
        expect(student.overall).toEqual({
          computedScore: null,
          overrideScore: null,
          finalScore: null,
          finalSource: null,
          status: "incomplete",
          missingGradeItemIds: sheet.gradeItems.map((item) => item.id),
        });
      }
    });

    it("按权重计算总评 Σ(得分 ÷ 满分 × 权重)，并四舍五入到两位小数", async () => {
      const items = await getSheet(ids.classMain);
      const [daily, midterm, final] = items.gradeItems;
      const [zhang, li] = items.students;

      const saved = await saveScores(ids.classMain, [
        { studentId: zhang!.id, gradeItemId: daily!.id, score: 80 },
        { studentId: zhang!.id, gradeItemId: midterm!.id, score: 90 },
        { studentId: zhang!.id, gradeItemId: final!.id, score: 85 },
        { studentId: li!.id, gradeItemId: daily!.id, score: "100" },
        { studentId: li!.id, gradeItemId: midterm!.id, score: "100" },
        { studentId: li!.id, gradeItemId: final!.id, score: "100" },
      ]);
      expect(saved.status).toBe(200);
      const body = (await saved.json()) as { sheet: GradeSheetJson };

      const zhangSheet = body.sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;
      expect(zhangSheet.overall).toEqual({
        computedScore: 85,
        overrideScore: null,
        finalScore: 85,
        finalSource: "computed",
        status: "complete",
        missingGradeItemIds: [],
      });
      expect(zhangSheet.grades).toEqual({
        [daily!.id]: 80,
        [midterm!.id]: 90,
        [final!.id]: 85,
      });

      const liSheet = body.sheet.students.find(
        (student) => student.studentNumber === "s1002",
      )!;
      expect(liSheet.overall.computedScore).toBe(100);
      expect(liSheet.overall.status).toBe("complete");

      const rows = await queryRows<{
        student_number: string;
        computed_score: string | null;
      }>(
        app.schema!,
        `select s.student_number, go.computed_score::text as computed_score
         from grade_overalls go
         join students s on s.id = go.student_id
         where go.teaching_class_id = $1
         order by s.student_number`,
        [ids.classMain],
      );
      expect(rows).toEqual([
        { student_number: "s1001", computed_score: "85.00" },
        { student_number: "s1002", computed_score: "100.00" },
      ]);

      // 0.125 在第三位小数处为 5，必须向上进位成 0.13。
      const rounding = await getSheet(ids.classRounding);
      const rounded = await saveScores(ids.classRounding, [
        {
          studentId: rounding.students[0]!.id,
          gradeItemId: rounding.gradeItems[0]!.id,
          score: 1,
        },
      ]);
      expect(rounded.status).toBe(200);
      const roundedBody = (await rounded.json()) as { sheet: GradeSheetJson };
      expect(roundedBody.sheet.students[0]!.overall.computedScore).toBe(0.13);
    });

    it("得分留空表示缺考/未录入，不按 0 分参与计算；缺一项时总评未完成", async () => {
      const sheet = await getSheet(ids.classMain);
      const [daily, midterm, final] = sheet.gradeItems;
      const li = sheet.students.find(
        (student) => student.studentNumber === "s1002",
      )!;

      // 把李四的期末成绩清空：总评应为未完成，而不是按 80 分计算。
      const blanked = await saveScores(ids.classMain, [
        { studentId: li.id, gradeItemId: final!.id, score: null },
      ]);
      expect(blanked.status).toBe(200);
      const blankedBody = (await blanked.json()) as { sheet: GradeSheetJson };
      const blankedLi = blankedBody.sheet.students.find(
        (student) => student.studentNumber === "s1002",
      )!;
      expect(blankedLi.grades[final!.id]).toBeNull();
      expect(blankedLi.overall).toEqual({
        computedScore: null,
        overrideScore: null,
        finalScore: null,
        finalSource: null,
        status: "incomplete",
        missingGradeItemIds: [final!.id],
      });
      // 明确不退化：缺失一项时不能把空值当 0 加出 60 分或其它总和。
      expect(blankedLi.overall.computedScore).not.toBe(60);
      expect(blankedLi.overall.computedScore).not.toBe(0);

      const deleted = await queryRows<{ count: number }>(
        app.schema!,
        `select count(*)::int as count from student_grades
         where student_id = $1 and grade_item_id = $2`,
        [li.id, final!.id],
      );
      expect(deleted[0]!.count).toBe(0);

      // 重新录入后恢复为完整总评。
      const restored = await saveScores(ids.classMain, [
        { studentId: li.id, gradeItemId: final!.id, score: 100 },
      ]);
      expect(restored.status).toBe(200);
      const restoredBody = (await restored.json()) as { sheet: GradeSheetJson };
      expect(
        restoredBody.sheet.students.find(
          (student) => student.studentNumber === "s1002",
        )!.overall,
      ).toMatchObject({
        computedScore: 100,
        status: "complete",
        missingGradeItemIds: [],
      });

      // 只录一半的学生同样是未完成。
      const partial = await saveScores(ids.classMain, [
        { studentId: li.id, gradeItemId: midterm!.id, score: 90 },
        { studentId: li.id, gradeItemId: final!.id, score: null },
      ]);
      expect(partial.status).toBe(200);
      const partialBody = (await partial.json()) as { sheet: GradeSheetJson };
      const partialLi = partialBody.sheet.students.find(
        (student) => student.studentNumber === "s1002",
      )!;
      expect(partialLi.overall.computedScore).toBeNull();
      expect(partialLi.overall.status).toBe("incomplete");
      expect(partialLi.overall.missingGradeItemIds).toEqual([final!.id]);
      expect(partialLi.grades[daily!.id]).toBe(100);

      await saveScores(ids.classMain, [
        { studentId: li.id, gradeItemId: final!.id, score: 100 },
      ]);
    });

    it("得分必须在 0 到满分之间：0 分与满分本身合法，越界被拒绝并提示", async () => {
      const sheet = await getSheet(ids.classMain);
      const [daily, midterm, final] = sheet.gradeItems;
      const zhang = sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;

      const boundaries = await saveScores(ids.classMain, [
        { studentId: zhang.id, gradeItemId: daily!.id, score: 0 },
        { studentId: zhang.id, gradeItemId: midterm!.id, score: 100 },
        { studentId: zhang.id, gradeItemId: final!.id, score: "100.00" },
      ]);
      expect(boundaries.status).toBe(200);
      const boundariesBody = (await boundaries.json()) as {
        sheet: GradeSheetJson;
      };
      const zhangBoundary = boundariesBody.sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;
      expect(zhangBoundary.grades).toEqual({
        [daily!.id]: 0,
        [midterm!.id]: 100,
        [final!.id]: 100,
      });
      expect(zhangBoundary.overall.computedScore).toBe(70);

      const rejected: Array<{ score: unknown; word: string }> = [
        { score: -0.01, word: "得分" },
        { score: 100.01, word: "得分" },
        { score: 100.001, word: "两位小数" },
        { score: "abc", word: "得分" },
      ];
      for (const item of rejected) {
        const response = await saveScores(ids.classMain, [
          {
            studentId: zhang.id,
            gradeItemId: daily!.id,
            score: item.score as number,
          },
        ]);
        expect(response.status).toBe(400);
        expect(await errorOf(response)).toContain(item.word);
      }

      // 被拒绝的写入不能改动已有成绩。
      const after = await getSheet(ids.classMain);
      expect(
        after.students.find((student) => student.studentNumber === "s1001")!
          .grades[daily!.id],
      ).toBe(0);

      const notInClass = await saveScores(ids.classMain, [
        {
          studentId: ids.studentWang,
          gradeItemId: daily!.id,
          score: 50,
        },
      ]);
      expect(notInClass.status).toBe(400);
      expect(await errorOf(notInClass)).toContain("名单");

      const wrongItem = await saveScores(ids.classMain, [
        {
          studentId: zhang.id,
          gradeItemId: "00000000-0000-4000-8000-000000000000",
          score: 50,
        },
      ]);
      expect(wrongItem.status).toBe(404);
      expect(await errorOf(wrongItem)).toContain("成绩项");

      // 恢复张三的分数，便于后续用例。
      await saveScores(ids.classMain, [
        { studentId: zhang.id, gradeItemId: daily!.id, score: 80 },
        { studentId: zhang.id, gradeItemId: midterm!.id, score: 90 },
        { studentId: zhang.id, gradeItemId: final!.id, score: 85 },
      ]);
    });

    it("教师可覆盖某学生的总评，覆盖后以覆盖值为准并记录原值、新值与操作人", async () => {
      const sheet = await getSheet(ids.classMain);
      const zhang = sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;
      expect(zhang.overall.computedScore).toBe(85);

      const overridden = await setOverall(ids.classMain, zhang.id, 92);
      expect(overridden.status).toBe(200);
      const body = (await overridden.json()) as { sheet: GradeSheetJson };
      const zhangOverridden = body.sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;
      expect(zhangOverridden.overall).toEqual({
        computedScore: 85,
        overrideScore: 92,
        finalScore: 92,
        finalSource: "override",
        status: "complete",
        missingGradeItemIds: [],
      });

      const stored = await queryRows<{
        computed_score: string | null;
        override_score: string | null;
        override_updated_by: string | null;
      }>(
        app.schema!,
        `select computed_score::text as computed_score,
           override_score::text as override_score,
           override_updated_by
         from grade_overalls
         where teaching_class_id = $1 and student_id = $2`,
        [ids.classMain, zhang.id],
      );
      const teacherAId = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [TEACHER_A_LOGIN],
        )
      )[0]!.id;
      expect(stored).toEqual([
        {
          computed_score: "85.00",
          override_score: "92.00",
          override_updated_by: teacherAId,
        },
      ]);

      // 再次覆盖：原值是上一次的覆盖值。
      const again = await setOverall(ids.classMain, zhang.id, 94);
      expect(again.status).toBe(200);
      const againBody = (await again.json()) as { sheet: GradeSheetJson };
      expect(
        againBody.sheet.students.find(
          (student) => student.studentNumber === "s1001",
        )!.overall,
      ).toMatchObject({ computedScore: 85, overrideScore: 94, finalScore: 94 });

      const logs = await queryRows<{
        target: string;
        action: string;
        old_value: string | null;
        new_value: string | null;
        actor_account_id: string;
        grade_item_id: string | null;
        created_at: string;
      }>(
        app.schema!,
        `select target, action, old_value::text as old_value,
           new_value::text as new_value, actor_account_id, grade_item_id,
           created_at::text as created_at
         from grade_change_logs
         where teaching_class_id = $1 and student_id = $2 and target = 'overall'
         order by created_at, old_value`,
        [ids.classMain, zhang.id],
      );
      expect(logs).toHaveLength(2);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: "overall",
            action: "override_overall",
            old_value: "85.00",
            new_value: "92.00",
            actor_account_id: teacherAId,
            grade_item_id: null,
          }),
          expect.objectContaining({
            target: "overall",
            action: "override_overall",
            old_value: "92.00",
            new_value: "94.00",
            actor_account_id: teacherAId,
            grade_item_id: null,
          }),
        ]),
      );
      expect(logs.every((log) => log.created_at.length > 0)).toBe(true);

      // 覆盖值不合法时被拒绝，现有覆盖保持不变。
      for (const score of [-1, "abc", 1.234]) {
        const bad = await setOverall(ids.classMain, zhang.id, score);
        expect(bad.status).toBe(400);
        expect(await errorOf(bad)).toContain("总评");
      }
      const afterBad = await getSheet(ids.classMain);
      expect(
        afterBad.students.find((student) => student.studentNumber === "s1001")!
          .overall.overrideScore,
      ).toBe(94);
    });

    it("可取消覆盖，恢复为系统计算值，且这一动作同样被记录", async () => {
      const sheet = await getSheet(ids.classMain);
      const zhang = sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;

      const cancelled = await cancelOverall(ids.classMain, zhang.id);
      expect(cancelled.status).toBe(200);
      const body = (await cancelled.json()) as { sheet: GradeSheetJson };
      const zhangRestored = body.sheet.students.find(
        (student) => student.studentNumber === "s1001",
      )!;
      expect(zhangRestored.overall).toEqual({
        computedScore: 85,
        overrideScore: null,
        finalScore: 85,
        finalSource: "computed",
        status: "complete",
        missingGradeItemIds: [],
      });

      const stored = await queryRows<{ override_score: string | null }>(
        app.schema!,
        `select override_score::text as override_score
         from grade_overalls
         where teaching_class_id = $1 and student_id = $2`,
        [ids.classMain, zhang.id],
      );
      expect(stored).toEqual([{ override_score: null }]);

      const logs = await queryRows<{
        action: string;
        old_value: string | null;
        new_value: string | null;
      }>(
        app.schema!,
        `select action, old_value::text as old_value,
           new_value::text as new_value
         from grade_change_logs
         where teaching_class_id = $1 and student_id = $2
           and target = 'overall' and action = 'cancel_override'`,
        [ids.classMain, zhang.id],
      );
      expect(logs).toEqual([
        {
          action: "cancel_override",
          old_value: "94.00",
          new_value: "85.00",
        },
      ]);

      const again = await cancelOverall(ids.classMain, zhang.id);
      expect(again.status).toBe(409);
      expect(await errorOf(again)).toContain("没有");

      // 他人与学生的覆盖写入同样被拒绝。
      const byForeign = await setOverall(
        ids.classMain,
        zhang.id,
        90,
        teacherBCookie,
      );
      expect(byForeign.status).toBe(403);
      const byStudent = await setOverall(
        ids.classMain,
        zhang.id,
        90,
        studentCookie,
      );
      expect(byStudent.status).toBe(403);
    });

    it("成绩项的录入、修改与清空都写入变更日志", async () => {
      await createGradeItemOk(
        ids.classValidation,
        { name: "记录项", maxScore: 100, weight: 10 },
        adminCookie,
      );
      const sheet = await getSheet(ids.classValidation);
      const item = sheet.gradeItems[0]!;
      const student = sheet.students[0]!;

      expect(
        (
          await saveScores(ids.classValidation, [
            { studentId: student.id, gradeItemId: item.id, score: 10 },
          ])
        ).status,
      ).toBe(200);
      expect(
        (
          await saveScores(ids.classValidation, [
            { studentId: student.id, gradeItemId: item.id, score: 20 },
          ])
        ).status,
      ).toBe(200);
      expect(
        (
          await saveScores(ids.classValidation, [
            { studentId: student.id, gradeItemId: item.id, score: null },
          ])
        ).status,
      ).toBe(200);

      const logs = await queryRows<{
        target: string;
        action: string;
        old_value: string | null;
        new_value: string | null;
        grade_item_id: string;
      }>(
        app.schema!,
        `select target, action, old_value::text as old_value,
           new_value::text as new_value, grade_item_id
         from grade_change_logs
         where teaching_class_id = $1 and student_id = $2
           and target = 'grade_item'`,
        [ids.classValidation, student.id],
      );

      expect(logs).toHaveLength(3);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: "grade_item",
            action: "record",
            old_value: null,
            new_value: "10.00",
            grade_item_id: item.id,
          }),
          expect.objectContaining({
            target: "grade_item",
            action: "update",
            old_value: "10.00",
            new_value: "20.00",
            grade_item_id: item.id,
          }),
          expect.objectContaining({
            target: "grade_item",
            action: "update",
            old_value: "20.00",
            new_value: null,
            grade_item_id: item.id,
          }),
        ]),
      );
    });

    it("教师对他人教学班的成绩写入返回 403，管理员可写全部", async () => {
      const sheet = await getSheet(ids.classMain);
      const item = sheet.gradeItems[0]!;
      const zhang = sheet.students[0]!;

      const byForeignTeacher = await saveScores(
        ids.classMain,
        [{ studentId: zhang.id, gradeItemId: item.id, score: 60 }],
        teacherBCookie,
      );
      expect(byForeignTeacher.status).toBe(403);
      expect(await errorOf(byForeignTeacher)).toBe("无权访问。");

      const byStudent = await saveScores(
        ids.classMain,
        [{ studentId: zhang.id, gradeItemId: item.id, score: 60 }],
        studentCookie,
      );
      expect(byStudent.status).toBe(403);

      await createGradeItemOk(
        ids.classOther,
        { name: "平时", maxScore: 100, weight: 10 },
        teacherBCookie,
      );
      const otherSheet = await getSheet(ids.classOther, adminCookie);
      const adminWrite = await saveScores(
        ids.classOther,
        [
          {
            studentId: otherSheet.students[0]!.id,
            gradeItemId: otherSheet.gradeItems[0]!.id,
            score: 50,
          },
        ],
        adminCookie,
      );
      expect(adminWrite.status).toBe(200);
      const adminBody = (await adminWrite.json()) as { sheet: GradeSheetJson };
      expect(adminBody.sheet.students[0]!.overall.computedScore).toBe(5);

      const teacherOnForeign = await saveScores(
        ids.classOther,
        [
          {
            studentId: otherSheet.students[0]!.id,
            gradeItemId: otherSheet.gradeItems[0]!.id,
            score: 70,
          },
        ],
        teacherACookie,
      );
      expect(teacherOnForeign.status).toBe(403);
    });

    it("成绩变更日志的动作枚举预留发布与解锁", async () => {
      const rows = await queryRows<{ label: string }>(
        app.schema!,
        `select e.enumlabel as label
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         where t.typname = 'grade_change_action'
         order by e.enumsortorder`,
      );
      expect(rows.map((row) => row.label)).toEqual([
        "record",
        "update",
        "override_overall",
        "cancel_override",
        "publish",
        "unlock",
      ]);
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
