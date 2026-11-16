import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin13";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t13001";
const TEACHER_B_LOGIN = "t13002";
const STUDENT_ZHANG_LOGIN = "s1301";
const STUDENT_LI_LOGIN = "s1302";
const STUDENT_WANG_LOGIN = "s1303";
const STUDENT_ZHAO_LOGIN = "s1304";

const TERM_LABEL = "2026-2027 学年上学期";
const PUBLISHED_CLASS_NAME = "高三 1 班 数学";
const DRAFT_CLASS_NAME = "高二 2 班 数学（草稿）";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentZhangCookie = "";
let studentLiCookie = "";

type Json = Record<string, unknown>;

type GradeItemJson = { id: string; name: string; maxScore: number; weight: number };

const ids = {
  term: "",
  classPublished: "",
  classDraft: "",
  studentZhang: "",
  studentLi: "",
  studentWang: "",
  studentZhao: "",
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

async function saveScores(
  teachingClassId: string,
  scores: Array<{
    studentId: string;
    gradeItemId: string;
    score: number | null;
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
  cookie: string = teacherACookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/teaching-classes/${teachingClassId}/publish`,
    { confirmed: true },
    cookie,
  );
}

function exportUrl(teachingClassId: string): string {
  return `/api/teaching-classes/${teachingClassId}/grades/export`;
}

type CsvExport = {
  response: Response;
  bytes: Uint8Array;
  /** 已去掉 BOM 的文本，按 CRLF 分好行。 */
  lines: string[];
  contentType: string;
  disposition: string;
  decodedFilename: string;
};

/** 读取导出响应体的原始字节与头，所有断言都基于真实响应，而不是内部函数。 */
async function readCsv(response: Response): Promise<CsvExport> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const decodedFilename = filenameMatch
    ? decodeURIComponent(filenameMatch[1]!)
    : "";
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return {
    response,
    bytes,
    lines: body.split("\r\n").filter((line) => line.length > 0),
    contentType,
    disposition,
    decodedFilename,
  };
}

describe("成绩导出与成绩单打印", () => {
  beforeAll(async () => {
    app = await startTestApp();

    bootstrapAccount({
      loginName: ADMIN_LOGIN,
      displayName: "教务丁",
      role: "administrator",
      password: ADMIN_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_A_LOGIN,
      displayName: "教师庚",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    bootstrapAccount({
      loginName: TEACHER_B_LOGIN,
      displayName: "教师辛",
      role: "teacher",
      password: ACCOUNT_PASSWORD,
    });
    for (const [loginName, displayName] of [
      [STUDENT_ZHANG_LOGIN, "张三"],
      [STUDENT_LI_LOGIN, "李四"],
      [STUDENT_WANG_LOGIN, "王五"],
      [STUDENT_ZHAO_LOGIN, "赵六"],
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

    const year = await api(
      "POST",
      "/api/admin/academic-years",
      { startYear: 2026 },
      adminCookie,
    );
    expect(year.status).toBe(201);
    const yearId = ((await year.json()) as { academicYear: { id: string } })
      .academicYear.id;

    const term = await api(
      "POST",
      "/api/admin/terms",
      { academicYearId: yearId, half: "first" },
      adminCookie,
    );
    expect(term.status).toBe(201);
    ids.term = ((await term.json()) as { term: { id: string } }).term.id;

    const adminClass = await api(
      "POST",
      "/api/admin/administrative-classes",
      { name: "高三 1 班" },
      adminCookie,
    );
    expect(adminClass.status).toBe(201);
    const adminClassId = (
      (await adminClass.json()) as { administrativeClass: { id: string } }
    ).administrativeClass.id;

    ids.studentZhang = await createStudent({
      studentNumber: STUDENT_ZHANG_LOGIN,
      name: "张三",
      administrativeClassId: adminClassId,
    });
    ids.studentLi = await createStudent({
      studentNumber: STUDENT_LI_LOGIN,
      name: "李四",
      administrativeClassId: adminClassId,
    });
    ids.studentWang = await createStudent({
      studentNumber: STUDENT_WANG_LOGIN,
      name: "王五",
      administrativeClassId: adminClassId,
    });
    ids.studentZhao = await createStudent({
      studentNumber: STUDENT_ZHAO_LOGIN,
      name: "赵六",
      administrativeClassId: adminClassId,
    });

    const course = await api(
      "POST",
      "/api/admin/courses",
      { name: "数学", credits: 3 },
      adminCookie,
    );
    expect(course.status).toBe(201);
    const courseId = ((await course.json()) as { course: { id: string } })
      .course.id;

    const teacherA = await accountIdOf(TEACHER_A_LOGIN);
    const teacherB = await accountIdOf(TEACHER_B_LOGIN);

    ids.classPublished = await createTeachingClass({
      termId: ids.term,
      courseId,
      teacherAccountId: teacherA,
      displayName: PUBLISHED_CLASS_NAME,
      studentIds: [ids.studentZhang, ids.studentLi, ids.studentWang],
    });
    ids.classDraft = await createTeachingClass({
      termId: ids.term,
      courseId,
      teacherAccountId: teacherB,
      displayName: DRAFT_CLASS_NAME,
      studentIds: [ids.studentZhao],
    });

    const daily = await createGradeItem(ids.classPublished, {
      name: "平时",
      maxScore: 100,
      weight: 30,
    });
    const midterm = await createGradeItem(ids.classPublished, {
      name: "期中",
      maxScore: 100,
      weight: 30,
    });
    const finalExam = await createGradeItem(ids.classPublished, {
      name: "期末",
      maxScore: 100,
      weight: 40,
    });

    expect(
      (
        await saveScores(ids.classPublished, [
          { studentId: ids.studentZhang, gradeItemId: daily.id, score: 80 },
          { studentId: ids.studentZhang, gradeItemId: midterm.id, score: 90 },
          { studentId: ids.studentZhang, gradeItemId: finalExam.id, score: 85 },
          { studentId: ids.studentLi, gradeItemId: daily.id, score: 100 },
          { studentId: ids.studentLi, gradeItemId: midterm.id, score: 100 },
          { studentId: ids.studentLi, gradeItemId: finalExam.id, score: 100 },
          // 王五缺「平时」，缺考不能被写成 0 分。
          { studentId: ids.studentWang, gradeItemId: midterm.id, score: 60 },
          { studentId: ids.studentWang, gradeItemId: finalExam.id, score: 70 },
        ])
      ).status,
    ).toBe(200);

    // 李四的总评被教师覆盖为 98，导出的总评必须是覆盖后的值。
    expect(
      (
        await api(
          "PUT",
          `/api/teaching-classes/${ids.classPublished}/overalls/${ids.studentLi}`,
          { score: 98 },
          teacherACookie,
        )
      ).status,
    ).toBe(200);

    expect((await publish(ids.classPublished)).status).toBe(200);

    // 教师 B 的草稿教学班：有成绩项与实时得分，但从未发布。
    const draftItem = await createGradeItem(
      ids.classDraft,
      { name: "平时", maxScore: 100, weight: 100 },
      teacherBCookie,
    );
    expect(
      (
        await saveScores(
          ids.classDraft,
          [{ studentId: ids.studentZhao, gradeItemId: draftItem.id, score: 70 }],
          teacherBCookie,
        )
      ).status,
    ).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await app.stop();
  });

  it("任课教师导出的已发布成绩表带 BOM、中文文件名与规定的列顺序", async () => {
    const response = await api(
      "GET",
      exportUrl(ids.classPublished),
      undefined,
      teacherACookie,
    );
    expect(response.status).toBe(200);

    const csv = await readCsv(response);
    expect(csv.contentType.toLowerCase()).toContain("text/csv");
    expect(csv.contentType.toLowerCase()).toContain("charset=utf-8");
    expect(csv.disposition.toLowerCase()).toContain("attachment");
    expect(csv.disposition).toMatch(/filename\*=UTF-8''/i);

    // BOM 必须是响应体的前三个字节，而不是「设置了 header」。
    expect([...csv.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    // 中文文件名按 RFC 5987 编码后，解码结果应可直接落到磁盘。
    expect(csv.decodedFilename).toBe(
      `${TERM_LABEL} ${PUBLISHED_CLASS_NAME} 成绩表.csv`,
    );

    // 列顺序：学号、姓名、各成绩项（按教学班中的顺序）、总评。
    expect(csv.lines[0]).toBe("学号,姓名,平时,期中,期末,总评");

    // 学生按学号排序；总评取覆盖值；缺考单元格是「未录入」而不是 0。
    expect(csv.lines.slice(1)).toEqual([
      `${STUDENT_ZHANG_LOGIN},张三,80,90,85,85`,
      `${STUDENT_LI_LOGIN},李四,100,100,100,98`,
      `${STUDENT_WANG_LOGIN},王五,未录入,60,70,未录入`,
    ]);
    expect(csv.lines.join("\n")).not.toContain(STUDENT_ZHAO_LOGIN);
  });

  it("教务管理员可导出；非任课教师、学生被拒绝，未登录与不存在分别返回 401/404", async () => {
    const adminCsv = await readCsv(
      await api(
        "GET",
        exportUrl(ids.classPublished),
        undefined,
        adminCookie,
      ),
    );
    expect(adminCsv.response.status).toBe(200);
    expect(adminCsv.lines[0]).toBe("学号,姓名,平时,期中,期末,总评");
    expect(adminCsv.lines[1]).toBe(
      `${STUDENT_ZHANG_LOGIN},张三,80,90,85,85`,
    );

    const otherTeacher = await api(
      "GET",
      exportUrl(ids.classPublished),
      undefined,
      teacherBCookie,
    );
    expect(otherTeacher.status).toBe(403);
    expect(await errorOf(otherTeacher)).toBe("无权访问。");

    const student = await api(
      "GET",
      exportUrl(ids.classPublished),
      undefined,
      studentZhangCookie,
    );
    expect(student.status).toBe(403);
    expect(await errorOf(student)).toBe("无权访问。");

    const anonymous = await api("GET", exportUrl(ids.classPublished));
    expect(anonymous.status).toBe(401);
    expect(await errorOf(anonymous)).toBe("请先登录。");

    const missing = await api(
      "GET",
      exportUrl("00000000-0000-4000-8000-000000000000"),
      undefined,
      teacherACookie,
    );
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toBe("教学班不存在。");
  });

  it("解锁期间改分不影响导出：仍取最后一次发布的快照", async () => {
    const unlocked = await api(
      "POST",
      `/api/teaching-classes/${ids.classPublished}/unlock`,
      { reason: "期末成绩录入错误，需更正后重新发布" },
      adminCookie,
    );
    expect(unlocked.status).toBe(200);

    const sheetResponse = await api(
      "GET",
      `/api/teaching-classes/${ids.classPublished}/grades`,
      undefined,
      teacherACookie,
    );
    expect(sheetResponse.status).toBe(200);
    const sheet = (await sheetResponse.json()) as {
      sheet: { gradeItems: GradeItemJson[] };
    };
    const daily = sheet.sheet.gradeItems.find((item) => item.name === "平时")!;

    // 解锁后把张三的「平时」从 80 改成 50，实时总评变为 76。
    expect(
      (
        await saveScores(ids.classPublished, [
          { studentId: ids.studentZhang, gradeItemId: daily.id, score: 50 },
        ])
      ).status,
    ).toBe(200);

    const live = await api(
      "GET",
      `/api/teaching-classes/${ids.classPublished}/grades`,
      undefined,
      teacherACookie,
    );
    const liveSheet = (await live.json()) as {
      sheet: {
        students: Array<{ studentNumber: string; overall: { finalScore: number | null } }>;
      };
    };
    expect(
      liveSheet.sheet.students.find(
        (student) => student.studentNumber === STUDENT_ZHANG_LOGIN,
      )!.overall.finalScore,
    ).toBe(76);

    const csv = await readCsv(
      await api(
        "GET",
        exportUrl(ids.classPublished),
        undefined,
        teacherACookie,
      ),
    );
    expect(csv.response.status).toBe(200);
    // 导出的仍应是发布版本：平时 80、总评 85，而不是草稿里的 50/76。
    expect(csv.lines[1]).toBe(`${STUDENT_ZHANG_LOGIN},张三,80,90,85,85`);
    expect(csv.decodedFilename).not.toContain("未发布");
    expect(csv.lines.join("\n")).not.toMatch(
      new RegExp(`${STUDENT_ZHANG_LOGIN},张三,50,`),
    );
  });

  it("从未发布的教学班允许导出，但文件名与首行都明确标注「未发布」", async () => {
    const csv = await readCsv(
      await api("GET", exportUrl(ids.classDraft), undefined, teacherBCookie),
    );
    expect(csv.response.status).toBe(200);
    expect([...csv.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    expect(csv.decodedFilename).toContain("未发布");
    expect(csv.decodedFilename).toContain(DRAFT_CLASS_NAME);
    expect(csv.decodedFilename.endsWith(".csv")).toBe(true);

    // 首行说明不是正式成绩，第二行才是表头，避免把草稿伪装成正式成绩。
    expect(csv.lines[0]).toContain("未发布");
    expect(csv.lines[0]).toContain("不是正式成绩");
    expect(csv.lines[1]).toBe("学号,姓名,平时,总评");
    expect(csv.lines[2]).toBe(`${STUDENT_ZHAO_LOGIN},赵六,70,70`);
  });
});
