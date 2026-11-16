import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin01";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t7001";
const TEACHER_B_LOGIN = "t7002";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentCookie = "";

type Json = Record<string, unknown>;

type CourseJson = {
  id: string;
  name: string;
  credits: number | null;
  hours: number | null;
  description: string | null;
};

type TeachingClassJson = {
  id: string;
  displayName: string;
  studentCount: number;
  term: { id: string; label: string };
  course: CourseJson;
  teacher: { id: string; loginName: string; displayName: string };
};

type TeachingClassDetailJson = TeachingClassJson & {
  students: Array<{
    id: string;
    studentNumber: string;
    name: string;
    enrollmentStatus: string;
    source: string;
    administrativeClass: { id: string; name: string };
  }>;
};

type EnrollmentJson = {
  addedCount: number;
  alreadyInClassCount: number;
  notEnrolledCount: number;
};

const ids = {
  termFirst: "",
  termSecond: "",
  classA: "",
  classB: "",
  courseMath: "",
  studentZhang: "",
  studentLi: "",
  studentWang: "",
  studentZhao: "",
  studentSun: "",
  studentZhou: "",
  teachingClassA: "",
  teachingClassB: "",
  teachingClassWhole: "",
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

async function createCourse(
  body: Json,
  cookie: string = adminCookie,
): Promise<Response> {
  return api("POST", "/api/admin/courses", body, cookie);
}

async function createTeachingClass(
  body: Json,
  cookie: string = adminCookie,
): Promise<Response> {
  return api("POST", "/api/admin/teaching-classes", body, cookie);
}

async function createTeachingClassOk(body: Json): Promise<TeachingClassJson> {
  const response = await createTeachingClass(body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { teachingClass: TeachingClassJson })
    .teachingClass;
}

async function detailOf(
  id: string,
  cookie: string = adminCookie,
): Promise<TeachingClassDetailJson> {
  const response = await api(
    "GET",
    `/api/teaching-classes/${id}`,
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { teachingClass: TeachingClassDetailJson })
    .teachingClass;
}

async function addStudent(
  teachingClassId: string,
  studentId: string,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "POST",
    `/api/admin/teaching-classes/${teachingClassId}/students`,
    { studentId },
    cookie,
  );
}

async function removeStudent(
  teachingClassId: string,
  studentId: string,
  cookie: string = adminCookie,
): Promise<Response> {
  return api(
    "DELETE",
    `/api/admin/teaching-classes/${teachingClassId}/students/${studentId}`,
    undefined,
    cookie,
  );
}

async function enrollAdministrativeClass(
  teachingClassId: string,
  administrativeClassId: string,
): Promise<Response> {
  return api(
    "POST",
    `/api/admin/teaching-classes/${teachingClassId}/enroll-administrative-class`,
    { administrativeClassId },
    adminCookie,
  );
}

async function createStudent(input: {
  studentNumber: string;
  name: string;
  administrativeClassId: string;
  enrollmentStatus?: string;
  initialPassword?: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/students",
    {
      studentNumber: input.studentNumber,
      name: input.name,
      administrativeClassId: input.administrativeClassId,
      enrollmentStatus: input.enrollmentStatus ?? "enrolled",
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

async function setEnrollmentStatus(
  studentId: string,
  enrollmentStatus: string,
): Promise<void> {
  const response = await api(
    "PATCH",
    `/api/admin/students/${studentId}`,
    { enrollmentStatus },
    adminCookie,
  );
  expect(response.status).toBe(200);
}

async function listTeachingClasses(
  route: string,
  cookie: string = adminCookie,
): Promise<{
  currentTerm: { id: string } | null;
  term: { id: string; label: string } | null;
  teachingClasses: TeachingClassJson[];
}> {
  const response = await api("GET", route, undefined, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    currentTerm: { id: string } | null;
    term: { id: string; label: string } | null;
    teachingClasses: TeachingClassJson[];
  };
}

describe("课程与教学班", () => {
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
      ["s7001", "张三"],
      ["s7002", "李四"],
      ["s7003", "王五"],
      ["s7004", "赵六"],
      ["s7005", "孙七"],
      ["s7006", "周八"],
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
    studentCookie = await login("s7001", ACCOUNT_PASSWORD);

    // 学年与学期：本文件绝大多数用例显式指定学期，不依赖当前学期。
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
      const term = (await response.json()) as { term: { id: string } };
      if (half === "first") ids.termFirst = term.term.id;
      else ids.termSecond = term.term.id;
    }

    ids.classA = await createAdministrativeClass("高二 1 班");
    ids.classB = await createAdministrativeClass("高二 2 班");

    ids.studentZhang = await createStudent({
      studentNumber: "s7001",
      name: "张三",
      administrativeClassId: ids.classA,
    });
    ids.studentLi = await createStudent({
      studentNumber: "s7002",
      name: "李四",
      administrativeClassId: ids.classA,
    });
    ids.studentWang = await createStudent({
      studentNumber: "s7003",
      name: "王五",
      administrativeClassId: ids.classA,
      enrollmentStatus: "suspended",
    });
    ids.studentZhao = await createStudent({
      studentNumber: "s7004",
      name: "赵六",
      administrativeClassId: ids.classB,
    });
    ids.studentSun = await createStudent({
      studentNumber: "s7005",
      name: "孙七",
      administrativeClassId: ids.classB,
    });
    ids.studentZhou = await createStudent({
      studentNumber: "s7006",
      name: "周八",
      administrativeClassId: ids.classB,
      enrollmentStatus: "graduated",
    });

    const math = await createCourse({
      name: "高等数学",
      credits: 3,
      description: "微积分基础",
    });
    expect(math.status).toBe(201);
    ids.courseMath = ((await math.json()) as { course: CourseJson }).course.id;
  }, 180_000);

  afterAll(async () => {
    await app.stop();
  });

  describe("课程", () => {
    it("教务管理员可创建课程：名称、学分或课时、可选说明", async () => {
      const created = await createCourse({
        name: "大学物理",
        hours: 48,
        description: "力学与电磁学",
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { course: CourseJson };
      expect(body.course).toMatchObject({
        name: "大学物理",
        credits: null,
        hours: 48,
        description: "力学与电磁学",
      });

      const list = await api("GET", "/api/courses", undefined, adminCookie);
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as { courses: CourseJson[] };
      expect(
        listBody.courses.map((course) => course.name).sort(),
      ).toEqual(["大学物理", "高等数学"]);
      const math = listBody.courses.find(
        (course) => course.name === "高等数学",
      )!;
      expect(math.credits).toBe(3);
      expect(math.hours).toBeNull();
      expect(math.description).toBe("微积分基础");

      const rows = await queryRows<{
        name: string;
        credits: string | null;
        hours: number | null;
      }>(
        app.schema!,
        "select name, credits::text as credits, hours from courses order by name",
      );
      expect(rows).toEqual([
        { name: "大学物理", credits: null, hours: 48 },
        { name: "高等数学", credits: "3.0", hours: null },
      ]);
    });

    it("课程参数不合法时返回可读的中文错误，且不写入课程", async () => {
      const cases: Array<{ body: Json; word: string }> = [
        { body: { name: "  ", credits: 2 }, word: "课程名称" },
        { body: { name: "没有学分与课时" }, word: "学分或课时" },
        {
          body: { name: "负学分", credits: -1 },
          word: "学分",
        },
        { body: { name: "小数课时", hours: 1.5 }, word: "课时" },
        { body: { name: "零学分", credits: 0 }, word: "学分" },
        {
          body: { name: "说明过长", credits: 1, description: "说".repeat(501) },
          word: "说明",
        },
      ];

      for (const item of cases) {
        const response = await createCourse(item.body);
        expect(response.status).toBe(400);
        expect(await errorOf(response)).toContain(item.word);
      }

      const duplicate = await createCourse({ name: "高等数学", credits: 4 });
      expect(duplicate.status).toBe(409);
      const duplicateError = await errorOf(duplicate);
      expect(duplicateError).toContain("课程名称");
      expect(duplicateError).not.toContain("constraint");
      expect(duplicateError).not.toContain("duplicate");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from courses",
      );
      expect(rows[0]!.count).toBe(2);
    });
  });

  describe("教学班的组建", () => {
    it("可在某学期下开设教学班：选择课程、指定一位任课教师、填写显示名", async () => {
      const response = await createTeachingClass({
        termId: ids.termFirst,
        courseId: ids.courseMath,
        teacherAccountId: (
          await queryRows<{ id: string }>(
            app.schema!,
            "select id from accounts where login_name = $1",
            [TEACHER_A_LOGIN],
          )
        )[0]!.id,
        displayName: "高二 1 班 高等数学",
      });
      expect(response.status).toBe(201);

      const { teachingClass } = (await response.json()) as {
        teachingClass: TeachingClassJson;
      };
      ids.teachingClassA = teachingClass.id;
      expect(teachingClass).toMatchObject({
        displayName: "高二 1 班 高等数学",
        studentCount: 0,
        term: { id: ids.termFirst, label: "2025-2026 学年上学期" },
        course: { id: ids.courseMath, name: "高等数学", credits: 3 },
        teacher: {
          loginName: TEACHER_A_LOGIN,
          displayName: "教师甲",
        },
      });

      const detail = await detailOf(teachingClass.id);
      expect(detail.students).toEqual([]);
      expect(detail.term.label).toBe("2025-2026 学年上学期");
      expect(detail.course.name).toBe("高等数学");
      expect(detail.teacher.displayName).toBe("教师甲");
    });

    it("同一学期同一课程可开设多个教学班，名单互不干扰", async () => {
      const teacherB = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [TEACHER_B_LOGIN],
        )
      )[0]!.id;

      const second = await createTeachingClassOk({
        termId: ids.termFirst,
        courseId: ids.courseMath,
        teacherAccountId: teacherB,
        displayName: "高二 2 班 高等数学",
      });
      ids.teachingClassB = second.id;
      expect(second.id).not.toBe(ids.teachingClassA);
      expect(second.course.id).toBe(ids.courseMath);
      expect(second.term.id).toBe(ids.termFirst);

      expect((await addStudent(second.id, ids.studentZhao)).status).toBe(200);
      expect((await addStudent(ids.teachingClassA, ids.studentZhang)).status).toBe(
        200,
      );

      const firstDetail = await detailOf(ids.teachingClassA);
      const secondDetail = await detailOf(second.id);
      expect(firstDetail.students.map((student) => student.studentNumber)).toEqual(
        ["s7001"],
      );
      expect(
        secondDetail.students.map((student) => student.studentNumber),
      ).toEqual(["s7004"]);

      const rows = await queryRows<{
        teaching_class_id: string;
        student_number: string;
      }>(
        app.schema!,
        `select tcs.teaching_class_id, s.student_number
         from teaching_class_students tcs
         join students s on s.id = tcs.student_id
         order by s.student_number`,
      );
      expect(rows).toEqual([
        {
          teaching_class_id: ids.teachingClassA,
          student_number: "s7001",
        },
        {
          teaching_class_id: second.id,
          student_number: "s7004",
        },
      ]);
    });

    it("教学班参数不合法时返回可读的中文错误", async () => {
      const teacherA = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [TEACHER_A_LOGIN],
        )
      )[0]!.id;
      const adminId = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [ADMIN_LOGIN],
        )
      )[0]!.id;

      const cases: Array<{ body: Json; word: string }> = [
        {
          body: {
            termId: "00000000-0000-4000-8000-000000000000",
            courseId: ids.courseMath,
            teacherAccountId: teacherA,
            displayName: "缺学期",
          },
          word: "学期",
        },
        {
          body: {
            termId: ids.termFirst,
            courseId: "00000000-0000-4000-8000-000000000000",
            teacherAccountId: teacherA,
            displayName: "缺课程",
          },
          word: "课程",
        },
        {
          body: {
            termId: ids.termFirst,
            courseId: ids.courseMath,
            teacherAccountId: adminId,
            displayName: "教师是管理员",
          },
          word: "教师",
        },
        {
          body: {
            termId: ids.termFirst,
            courseId: ids.courseMath,
            teacherAccountId: "00000000-0000-4000-8000-000000000000",
            displayName: "缺教师",
          },
          word: "教师",
        },
        {
          body: {
            termId: ids.termFirst,
            courseId: ids.courseMath,
            teacherAccountId: teacherA,
            displayName: "   ",
          },
          word: "显示名",
        },
      ];

      for (const item of cases) {
        const response = await createTeachingClass(item.body);
        expect(response.status).toBe(400);
        expect(await errorOf(response)).toContain(item.word);
      }

      // 非法 UUID 也不能把数据库错误泄露给用户。
      const malformed = await createTeachingClass({
        termId: "not-a-uuid",
        courseId: ids.courseMath,
        teacherAccountId: teacherA,
        displayName: "非法学期",
      });
      expect(malformed.status).toBe(400);
      expect(await errorOf(malformed)).toContain("学期");

      const rows = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from teaching_classes",
      );
      expect(rows[0]!.count).toBe(2);
    });

    it("开设教学班时选择行政班整班加入，只纳入当前在读学生", async () => {
      const response = await createTeachingClass({
        termId: ids.termFirst,
        courseId: ids.courseMath,
        teacherAccountId: (
          await queryRows<{ id: string }>(
            app.schema!,
            "select id from accounts where login_name = $1",
            [TEACHER_A_LOGIN],
          )
        )[0]!.id,
        displayName: "高二 1 班 高等数学（整班）",
        administrativeClassId: ids.classA,
      });
      expect(response.status).toBe(201);

      const body = (await response.json()) as {
        teachingClass: TeachingClassJson;
        enrollment: EnrollmentJson;
      };
      ids.teachingClassWhole = body.teachingClass.id;
      expect(body.enrollment).toEqual({
        addedCount: 2,
        alreadyInClassCount: 0,
        notEnrolledCount: 1,
      });
      expect(body.teachingClass.studentCount).toBe(2);

      const detail = await detailOf(body.teachingClass.id);
      expect(
        detail.students.map((student) => student.studentNumber).sort(),
      ).toEqual(["s7001", "s7002"]);
      expect(detail.students.map((student) => student.source)).toEqual([
        "whole_class",
        "whole_class",
      ]);
      // 休学的王五不在名单里。
      expect(
        detail.students.some((student) => student.studentNumber === "s7003"),
      ).toBe(false);

      const rows = await queryRows<{
        student_number: string;
        source: string;
      }>(
        app.schema!,
        `select s.student_number, tcs.source
         from teaching_class_students tcs
         join students s on s.id = tcs.student_id
         where tcs.teaching_class_id = $1
         order by s.student_number`,
        [ids.teachingClassWhole],
      );
      expect(rows).toEqual([
        { student_number: "s7001", source: "whole_class" },
        { student_number: "s7002", source: "whole_class" },
      ]);
    });

    it("整班加入是快照：之后学籍变化不自动同步到已组建的名单", async () => {
      // 李四在名单里；改为休学后名单不应自动剔除。
      await setEnrollmentStatus(ids.studentLi, "suspended");

      const again = await enrollAdministrativeClass(
        ids.teachingClassWhole,
        ids.classA,
      );
      expect(again.status).toBe(200);
      const body = (await again.json()) as {
        teachingClass: TeachingClassJson;
        enrollment: EnrollmentJson;
      };
      expect(body.enrollment).toEqual({
        addedCount: 0,
        alreadyInClassCount: 2,
        notEnrolledCount: 2,
      });

      const detail = await detailOf(ids.teachingClassWhole);
      expect(
        detail.students.map((student) => student.studentNumber).sort(),
      ).toEqual(["s7001", "s7002"]);
      const li = detail.students.find(
        (student) => student.studentNumber === "s7002",
      )!;
      expect(li.enrollmentStatus).toBe("suspended");

      // 恢复在读，后续用例继续使用。
      await setEnrollmentStatus(ids.studentLi, "enrolled");

      // 整班加入后新转入该行政班的学生也不会自动进入旧名单。
      const late = await createStudent({
        studentNumber: "s7007",
        name: "迟到生",
        administrativeClassId: ids.classA,
        initialPassword: ACCOUNT_PASSWORD,
      });
      const afterLate = await detailOf(ids.teachingClassWhole);
      expect(afterLate.students.map((student) => student.id)).not.toContain(late);
      expect(afterLate.students).toHaveLength(2);
    });

    it("可手工添加与移除个别学生，非在读学生被拒绝", async () => {
      const added = await addStudent(ids.teachingClassA, ids.studentLi);
      expect(added.status).toBe(200);
      const addedBody = (await added.json()) as {
        teachingClass: TeachingClassDetailJson;
      };
      expect(
        addedBody.teachingClass.students.map((student) => student.studentNumber),
      ).toEqual(["s7001", "s7002"]);
      expect(
        addedBody.teachingClass.students.find(
          (student) => student.studentNumber === "s7002",
        )!.source,
      ).toBe("manual");

      const duplicate = await addStudent(ids.teachingClassA, ids.studentLi);
      expect(duplicate.status).toBe(409);
      expect(await errorOf(duplicate)).toContain("已在该教学班");

      // 休学学生不能手工加入。
      const suspended = await addStudent(ids.teachingClassA, ids.studentWang);
      expect(suspended.status).toBe(409);
      expect(await errorOf(suspended)).toContain("在读");

      const missing = await addStudent(
        ids.teachingClassA,
        "00000000-0000-4000-8000-000000000000",
      );
      expect(missing.status).toBe(404);
      expect(await errorOf(missing)).toContain("学生");

      const removed = await removeStudent(ids.teachingClassA, ids.studentLi);
      expect(removed.status).toBe(200);
      const removedBody = (await removed.json()) as {
        teachingClass: TeachingClassDetailJson;
      };
      expect(
        removedBody.teachingClass.students.map(
          (student) => student.studentNumber,
        ),
      ).toEqual(["s7001"]);

      const removeAgain = await removeStudent(
        ids.teachingClassA,
        ids.studentLi,
      );
      expect(removeAgain.status).toBe(404);
      expect(await errorOf(removeAgain)).toContain("名单");

      // 只有教务管理员能增删名单。
      const byTeacher = await addStudent(
        ids.teachingClassA,
        ids.studentLi,
        teacherACookie,
      );
      expect(byTeacher.status).toBe(403);
      expect(await errorOf(byTeacher)).toBe("无权访问。");
    });

    it("不存在的行政班不能整班加入", async () => {
      const response = await enrollAdministrativeClass(
        ids.teachingClassA,
        "00000000-0000-4000-8000-000000000000",
      );
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toContain("行政班");
    });
  });

  describe("教师与学生视角", () => {
    it("教师只能看到自己任教的教学班，直接请求他人的教学班返回 403", async () => {
      const teacherAList = await listTeachingClasses(
        `/api/teacher/teaching-classes?termId=${ids.termFirst}`,
        teacherACookie,
      );
      expect(teacherAList.teachingClasses.map((item) => item.id).sort()).toEqual(
        [ids.teachingClassA, ids.teachingClassWhole].sort(),
      );
      expect(
        teacherAList.teachingClasses.every(
          (item) => item.teacher.loginName === TEACHER_A_LOGIN,
        ),
      ).toBe(true);

      const teacherBList = await listTeachingClasses(
        `/api/teacher/teaching-classes?termId=${ids.termFirst}`,
        teacherBCookie,
      );
      expect(teacherBList.teachingClasses.map((item) => item.id)).toEqual([
        ids.teachingClassB,
      ]);

      const own = await api(
        "GET",
        `/api/teaching-classes/${ids.teachingClassA}`,
        undefined,
        teacherACookie,
      );
      expect(own.status).toBe(200);

      const foreign = await api(
        "GET",
        `/api/teaching-classes/${ids.teachingClassA}`,
        undefined,
        teacherBCookie,
      );
      expect(foreign.status).toBe(403);
      expect(await errorOf(foreign)).toBe("无权访问。");

      const foreignOtherWay = await api(
        "GET",
        `/api/teaching-classes/${ids.teachingClassB}`,
        undefined,
        teacherACookie,
      );
      expect(foreignOtherWay.status).toBe(403);

      const adminView = await api(
        "GET",
        `/api/teaching-classes/${ids.teachingClassB}`,
        undefined,
        adminCookie,
      );
      expect(adminView.status).toBe(200);

      const studentView = await api(
        "GET",
        `/api/teaching-classes/${ids.teachingClassA}`,
        undefined,
        studentCookie,
      );
      expect(studentView.status).toBe(403);
    });

    it("学生被加入教学班后，该关系立即可用于后续课表与成绩", async () => {
      // 张三通过整班加入已在两个教学班里。
      const own = await listTeachingClasses(
        `/api/student/teaching-classes?termId=${ids.termFirst}`,
        studentCookie,
      );
      expect(own.teachingClasses.map((item) => item.id).sort()).toEqual(
        [ids.teachingClassA, ids.teachingClassWhole].sort(),
      );
      const math = own.teachingClasses.find(
        (item) => item.id === ids.teachingClassA,
      )!;
      expect(math.course.name).toBe("高等数学");
      expect(math.teacher.displayName).toBe("教师甲");

      // 移除后立刻从学生的列表里消失，再添加又立刻出现。
      const removed = await removeStudent(
        ids.teachingClassWhole,
        ids.studentZhang,
      );
      expect(removed.status).toBe(200);
      const afterRemove = await listTeachingClasses(
        `/api/student/teaching-classes?termId=${ids.termFirst}`,
        studentCookie,
      );
      expect(afterRemove.teachingClasses.map((item) => item.id)).toEqual([
        ids.teachingClassA,
      ]);

      const readded = await addStudent(
        ids.teachingClassWhole,
        ids.studentZhang,
      );
      expect(readded.status).toBe(200);
      const afterReadd = await listTeachingClasses(
        `/api/student/teaching-classes?termId=${ids.termFirst}`,
        studentCookie,
      );
      expect(afterReadd.teachingClasses.map((item) => item.id).sort()).toEqual(
        [ids.teachingClassA, ids.teachingClassWhole].sort(),
      );

      // 学生只能看到自己的教学班。
      expect(
        afterReadd.teachingClasses.some(
          (item) => item.id === ids.teachingClassB,
        ),
      ).toBe(false);
    });
  });

  describe("按学期查看与权限", () => {
    it("教务管理员可按学期查看全部教学班及其任课教师", async () => {
      const secondTermClass = await createTeachingClassOk({
        termId: ids.termSecond,
        courseId: ids.courseMath,
        teacherAccountId: (
          await queryRows<{ id: string }>(
            app.schema!,
            "select id from accounts where login_name = $1",
            [TEACHER_A_LOGIN],
          )
        )[0]!.id,
        displayName: "高二 1 班 高等数学（下学期）",
      });

      const first = await listTeachingClasses(
        `/api/admin/teaching-classes?termId=${ids.termFirst}`,
      );
      expect(first.term).toMatchObject({
        id: ids.termFirst,
        label: "2025-2026 学年上学期",
      });
      expect(first.teachingClasses.map((item) => item.id).sort()).toEqual(
        [ids.teachingClassA, ids.teachingClassB, ids.teachingClassWhole].sort(),
      );
      const teacherNames = new Set(
        first.teachingClasses.map((item) => item.teacher.displayName),
      );
      expect(teacherNames).toEqual(new Set(["教师甲", "教师乙"]));
      expect(
        first.teachingClasses.every(
          (item) => item.term.label === "2025-2026 学年上学期",
        ),
      ).toBe(true);

      const second = await listTeachingClasses(
        `/api/admin/teaching-classes?termId=${ids.termSecond}`,
      );
      expect(second.teachingClasses.map((item) => item.id)).toEqual([
        secondTermClass.id,
      ]);
      expect(second.teachingClasses[0]!.teacher.displayName).toBe("教师甲");

      const badTerm = await api(
        "GET",
        "/api/admin/teaching-classes?termId=not-a-uuid",
        undefined,
        adminCookie,
      );
      expect(badTerm.status).toBe(400);
      expect(await errorOf(badTerm)).toContain("学期");

      const missingTerm = await api(
        "GET",
        "/api/admin/teaching-classes?termId=00000000-0000-4000-8000-000000000000",
        undefined,
        adminCookie,
      );
      expect(missingTerm.status).toBe(400);
      expect(await errorOf(missingTerm)).toContain("学期");
    });

    it("尚未设置当前学期时，教学班页面与接口给出提示而不是报错", async () => {
      const adminPage = await page("/admin/teaching-classes", adminCookie);
      expect(adminPage.status).toBe(200);
      const adminHtml = await adminPage.text();
      expect(adminHtml).toContain("尚未设置当前学期");
      expect(adminHtml).not.toContain("服务暂时不可用");
      expect(adminHtml).not.toContain("Internal Server Error");

      const teacherPage = await page("/teacher/teaching-classes", teacherACookie);
      expect(teacherPage.status).toBe(200);
      const teacherHtml = await teacherPage.text();
      expect(teacherHtml).toContain("尚未设置当前学期");
      expect(teacherHtml).not.toContain("服务暂时不可用");
      expect(teacherHtml).not.toContain("Internal Server Error");

      const teacherList = await listTeachingClasses(
        "/api/teacher/teaching-classes",
        teacherACookie,
      );
      expect(teacherList.currentTerm).toBeNull();
      expect(teacherList.teachingClasses).toEqual([]);

      const studentList = await listTeachingClasses(
        "/api/student/teaching-classes",
        studentCookie,
      );
      expect(studentList.currentTerm).toBeNull();
      expect(studentList.teachingClasses).toEqual([]);

      // 未设置当前学期时，管理员仍可显式按学期查看。
      const explicit = await listTeachingClasses(
        `/api/admin/teaching-classes?termId=${ids.termFirst}`,
      );
      expect(explicit.teachingClasses).toHaveLength(3);
    });

    it("设置当前学期后，教学班列表默认按当前学期", async () => {
      const setCurrent = await api(
        "POST",
        "/api/admin/current-term",
        { termId: ids.termFirst, confirmed: true },
        adminCookie,
      );
      expect(setCurrent.status).toBe(200);

      const adminDefault = await listTeachingClasses(
        "/api/admin/teaching-classes",
      );
      expect(adminDefault.currentTerm).toMatchObject({
        id: ids.termFirst,
        label: "2025-2026 学年上学期",
      });
      expect(adminDefault.teachingClasses.map((item) => item.id).sort()).toEqual(
        [ids.teachingClassA, ids.teachingClassB, ids.teachingClassWhole].sort(),
      );

      const teacherDefault = await listTeachingClasses(
        "/api/teacher/teaching-classes",
        teacherACookie,
      );
      expect(
        teacherDefault.teachingClasses.map((item) => item.id).sort(),
      ).toEqual([ids.teachingClassA, ids.teachingClassWhole].sort());

      const pageResponse = await page("/admin/teaching-classes", adminCookie);
      expect(pageResponse.status).toBe(200);
      const html = await pageResponse.text();
      expect(html).toContain("当前学期：2025-2026 学年上学期");
      expect(html).not.toContain("尚未设置当前学期");
    });

    it("教师与学生不能管理课程与教学班", async () => {
      const teacherA = (
        await queryRows<{ id: string }>(
          app.schema!,
          "select id from accounts where login_name = $1",
          [TEACHER_A_LOGIN],
        )
      )[0]!.id;

      for (const cookie of [teacherACookie, studentCookie]) {
        const course = await createCourse(
          { name: "越权课程", credits: 1 },
          cookie,
        );
        expect(course.status).toBe(403);

        const created = await createTeachingClass(
          {
            termId: ids.termFirst,
            courseId: ids.courseMath,
            teacherAccountId: teacherA,
            displayName: "越权教学班",
          },
          cookie,
        );
        expect(created.status).toBe(403);

        const list = await api(
          "GET",
          "/api/admin/teaching-classes",
          undefined,
          cookie,
        );
        expect(list.status).toBe(403);
        expect(await errorOf(list)).toBe("无权访问。");

        const enroll = await api(
          "POST",
          `/api/admin/teaching-classes/${ids.teachingClassA}/enroll-administrative-class`,
          { administrativeClassId: ids.classA },
          cookie,
        );
        expect(enroll.status).toBe(403);

        const remove = await removeStudent(
          ids.teachingClassA,
          ids.studentZhang,
          cookie,
        );
        expect(remove.status).toBe(403);
      }

      const courses = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from courses where name = '越权课程'",
      );
      expect(courses[0]!.count).toBe(0);
      const classes = await queryRows<{ count: number }>(
        app.schema!,
        "select count(*)::int as count from teaching_classes where display_name = '越权教学班'",
      );
      expect(classes[0]!.count).toBe(0);
    });

    it("未登录调用课程与教学班接口返回 401", async () => {
      const cases: Array<["GET" | "POST", string, Json | undefined]> = [
        ["GET", "/api/courses", undefined],
        ["POST", "/api/admin/courses", { name: "匿名课程", credits: 1 }],
        ["GET", "/api/admin/teaching-classes", undefined],
        ["GET", "/api/teacher/teaching-classes", undefined],
        ["GET", "/api/student/teaching-classes", undefined],
        ["GET", `/api/teaching-classes/${ids.teachingClassA}`, undefined],
        [
          "POST",
          `/api/admin/teaching-classes/${ids.teachingClassA}/students`,
          { studentId: ids.studentZhang },
        ],
      ];

      for (const [method, route, body] of cases) {
        const response = await api(method, route, body);
        expect(response.status).toBe(401);
        expect(await errorOf(response)).toBe("请先登录。");
      }
    });
  });

  describe("管理页面", () => {
    it("教务管理员课程与教学班页面展示课程、学期、教师与名单", async () => {
      const courses = await page("/admin/courses", adminCookie);
      expect(courses.status).toBe(200);
      const coursesHtml = await courses.text();
      expect(coursesHtml).toContain("课程");
      expect(coursesHtml).toContain("高等数学");
      expect(coursesHtml).toContain("大学物理");
      expect(coursesHtml).toContain("学分");
      expect(coursesHtml).toContain("课时");

      const list = await page("/admin/teaching-classes", adminCookie);
      expect(list.status).toBe(200);
      const listHtml = await list.text();
      expect(listHtml).toContain("教学班");
      expect(listHtml).toContain("高二 1 班 高等数学");
      expect(listHtml).toContain("高二 2 班 高等数学");
      expect(listHtml).toContain("教师甲");
      expect(listHtml).toContain("教师乙");
      expect(listHtml).toContain("2025-2026 学年上学期");
      expect(listHtml).not.toContain("开课");
      expect(listHtml).not.toContain("教学任务");

      const detail = await page(
        `/admin/teaching-classes/${ids.teachingClassWhole}`,
        adminCookie,
      );
      expect(detail.status).toBe(200);
      const detailHtml = await detail.text();
      expect(detailHtml).toContain("高二 1 班 高等数学（整班）");
      expect(detailHtml).toContain("高等数学");
      expect(detailHtml).toContain("教师甲");
      expect(detailHtml).toContain("2025-2026 学年上学期");
      expect(detailHtml).toContain("张三");
      expect(detailHtml).toContain("李四");
      expect(detailHtml).toContain("学号");
      expect(detailHtml).not.toContain("王五");

      // 学期切换入口按学期过滤。
      const filtered = await page(
        `/admin/teaching-classes?termId=${ids.termSecond}`,
        adminCookie,
      );
      expect(filtered.status).toBe(200);
      const filteredHtml = await filtered.text();
      expect(filteredHtml).toContain("高二 1 班 高等数学（下学期）");
      expect(filteredHtml).not.toContain("高二 2 班 高等数学<");
    });

    it("教师端教学班列表只显示自己的班，访问他人的详情页返回 403", async () => {
      const own = await page("/teacher/teaching-classes", teacherACookie);
      expect(own.status).toBe(200);
      const ownHtml = await own.text();
      expect(ownHtml).toContain("高二 1 班 高等数学");
      expect(ownHtml).toContain("高等数学");
      expect(ownHtml).not.toContain("高二 2 班 高等数学");

      const ownDetail = await page(
        `/teacher/teaching-classes/${ids.teachingClassA}`,
        teacherACookie,
      );
      expect(ownDetail.status).toBe(200);
      expect(await ownDetail.text()).toContain("张三");

      const foreignDetail = await page(
        `/teacher/teaching-classes/${ids.teachingClassB}`,
        teacherACookie,
      );
      expect(foreignDetail.status).toBe(403);
      expect(await foreignDetail.text()).toContain("无权访问");

      const byStudent = await page("/teacher/teaching-classes", studentCookie);
      expect(byStudent.status).toBe(403);

      for (const cookie of [teacherACookie, studentCookie]) {
        for (const route of [
          "/admin/courses",
          "/admin/teaching-classes",
          `/admin/teaching-classes/${ids.teachingClassA}`,
        ]) {
          const response = await page(route, cookie);
          expect(response.status).toBe(403);
          expect(await response.text()).toContain("无权访问");
        }
      }

      const anonymous = await page("/admin/teaching-classes");
      expect([303, 307, 308]).toContain(anonymous.status);
      expect(anonymous.headers.get("location")).toBe(
        "/login?next=%2Fadmin%2Fteaching-classes",
      );
    });
  });
});
