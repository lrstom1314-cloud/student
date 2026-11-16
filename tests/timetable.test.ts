import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";

const ADMIN_LOGIN = "admin01";
const ADMIN_PASSWORD = "管理员密码123";
const ACCOUNT_PASSWORD = "初始密码1234";

const TEACHER_A_LOGIN = "t8001";
const TEACHER_B_LOGIN = "t8002";

let app: TestApp;
let adminCookie = "";
let teacherACookie = "";
let teacherBCookie = "";
let studentCookie = "";

type Json = Record<string, unknown>;

type TermJson = { id: string; label: string };

type TeachingClassJson = {
  id: string;
  displayName: string;
  term: TermJson;
};

type EntryJson = {
  id: string;
  teachingClassId: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  startWeek: number;
  endWeek: number;
  weekParity: "every" | "odd" | "even";
  classroom: string;
  acknowledgedAt: string | null;
};

type ConflictJson = {
  entryId: string;
  conflictingEntryId: string;
  reasons: string[];
  conflictingTeachingClass: { id: string; displayName: string };
  message: string;
};

type TimetableJson = {
  entries: EntryJson[];
  conflicts: ConflictJson[];
};

const ids = {
  termFirst: "",
  termSecond: "",
  tcA1: "",
  tcA2: "",
  tcB1: "",
  tcAOtherTerm: "",
  courseMath: "",
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

function entryBody(overrides: Json = {}): Json {
  return {
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    startWeek: 1,
    endWeek: 16,
    weekParity: "every",
    classroom: "教学楼 A101",
    ...overrides,
  };
}

function timetableRoute(teachingClassId: string): string {
  return `/api/teaching-classes/${teachingClassId}/timetable`;
}

function entryRoute(teachingClassId: string, entryId: string): string {
  return `${timetableRoute(teachingClassId)}/${entryId}`;
}

async function createEntry(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<Response> {
  return api("POST", timetableRoute(teachingClassId), body, cookie);
}

async function createEntryOk(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<{ entry: EntryJson; conflicts: ConflictJson[] }> {
  const response = await createEntry(teachingClassId, body, cookie);
  expect(response.status).toBe(201);
  return (await response.json()) as {
    entry: EntryJson;
    conflicts: ConflictJson[];
  };
}

async function listTimetable(
  teachingClassId: string,
  cookie: string = teacherACookie,
): Promise<TimetableJson> {
  const response = await api(
    "GET",
    timetableRoute(teachingClassId),
    undefined,
    cookie,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as TimetableJson;
}

async function teachingClassIdOf(loginName: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    app.schema!,
    "select id from accounts where login_name = $1",
    [loginName],
  );
  return rows[0]!.id;
}

async function createTeachingClass(input: {
  termId: string;
  teacherAccountId: string;
  displayName: string;
}): Promise<string> {
  const response = await api(
    "POST",
    "/api/admin/teaching-classes",
    {
      termId: input.termId,
      courseId: ids.courseMath,
      teacherAccountId: input.teacherAccountId,
      displayName: input.displayName,
    },
    adminCookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { teachingClass: TeachingClassJson })
    .teachingClass.id;
}

describe("课表录入与冲突告警", () => {
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
    bootstrapAccount({
      loginName: "s8001",
      displayName: "张三",
      role: "student",
      password: ACCOUNT_PASSWORD,
    });

    adminCookie = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
    teacherACookie = await login(TEACHER_A_LOGIN, ACCOUNT_PASSWORD);
    teacherBCookie = await login(TEACHER_B_LOGIN, ACCOUNT_PASSWORD);
    studentCookie = await login("s8001", ACCOUNT_PASSWORD);

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

    const math = await api(
      "POST",
      "/api/admin/courses",
      { name: "高等数学", credits: 3 },
      adminCookie,
    );
    expect(math.status).toBe(201);
    ids.courseMath = ((await math.json()) as { course: { id: string } }).course
      .id;

    const teacherA = await teachingClassIdOf(TEACHER_A_LOGIN);
    const teacherB = await teachingClassIdOf(TEACHER_B_LOGIN);

    ids.tcA1 = await createTeachingClass({
      termId: ids.termFirst,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 高等数学",
    });
    ids.tcA2 = await createTeachingClass({
      termId: ids.termFirst,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 高等数学（辅导）",
    });
    ids.tcB1 = await createTeachingClass({
      termId: ids.termFirst,
      teacherAccountId: teacherB,
      displayName: "高二 2 班 高等数学",
    });
    ids.tcAOtherTerm = await createTeachingClass({
      termId: ids.termSecond,
      teacherAccountId: teacherA,
      displayName: "高二 1 班 高等数学（下学期）",
    });
  }, 180_000);

  afterAll(async () => {
    await app.stop();
  });

  describe("录入与警告", () => {
    it("教师可为自己任教的教学班添加课表条目：星期、节次、周次、单双周与教室名", async () => {
      const { entry, conflicts } = await createEntryOk(ids.tcA1, entryBody());
      expect(conflicts).toEqual([]);
      expect(entry).toMatchObject({
        teachingClassId: ids.tcA1,
        weekday: 1,
        startPeriod: 1,
        endPeriod: 2,
        startWeek: 1,
        endWeek: 16,
        weekParity: "every",
        classroom: "教学楼 A101",
        acknowledgedAt: null,
      });

      const list = await listTimetable(ids.tcA1);
      expect(list.entries.map((item) => item.id)).toEqual([entry.id]);
      expect(list.conflicts).toEqual([]);

      const adminList = await listTimetable(ids.tcA1, adminCookie);
      expect(adminList.entries.map((item) => item.id)).toEqual([entry.id]);

      const rows = await queryRows<{
        weekday: number;
        start_period: number;
        end_period: number;
        start_week: number;
        end_week: number;
        week_parity: string;
        classroom: string;
      }>(
        app.schema!,
        `select weekday, start_period, end_period, start_week, end_week,
           week_parity, classroom
         from timetable_entries where id = $1`,
        [entry.id],
      );
      expect(rows).toEqual([
        {
          weekday: 1,
          start_period: 1,
          end_period: 2,
          start_week: 1,
          end_week: 16,
          week_parity: "every",
          classroom: "教学楼 A101",
        },
      ]);
    });

    it("同教师的不同教学班时间重叠时返回警告，且仍然保存成功", async () => {
      const body = entryBody({ classroom: "教学楼 B202" });
      const { entry, conflicts } = await createEntryOk(ids.tcA2, body);
      expect(conflicts).toHaveLength(1);
      const conflict = conflicts[0]!;
      expect(conflict).toMatchObject({
        entryId: entry.id,
        reasons: ["teacher"],
        conflictingTeachingClass: {
          id: ids.tcA1,
          displayName: "高二 1 班 高等数学",
        },
      });
      expect(conflict.message).toContain("高二 1 班 高等数学");
      expect(conflict.message).toContain("同一教师");

      // 警告不阻塞保存：条目确实落库，并在双方列表里互相可见。
      const saved = await listTimetable(ids.tcA2);
      expect(saved.entries.map((item) => item.id)).toContain(entry.id);
      expect(saved.conflicts).toHaveLength(1);

      const other = await listTimetable(ids.tcA1);
      expect(other.conflicts).toHaveLength(1);
      expect(other.conflicts[0]!.conflictingTeachingClass.id).toBe(ids.tcA2);

      expect(
        (
          await queryRows<{ count: number }>(
            app.schema!,
            "select count(*)::int as count from timetable_entries",
          )
        )[0]!.count,
      ).toBe(2);
    });

    it("同一教室名的不同教学班时间重叠时返回警告，不同教师的课不会被判为教师冲突", async () => {
      const { entry, conflicts } = await createEntryOk(
        ids.tcB1,
        entryBody({ classroom: "教学楼 A101" }),
        teacherBCookie,
      );
      expect(conflicts).toHaveLength(1);
      const conflict = conflicts[0]!;
      expect(conflict.entryId).toBe(entry.id);
      expect(conflict.conflictingTeachingClass.id).toBe(ids.tcA1);
      expect(conflict.reasons).toEqual(["classroom"]);
      expect(conflict.message).toContain("同一教室");
      expect(conflict.message).not.toContain("同一教师");
      // 教师乙与教师甲不冲突，与 B202 那间教室也不冲突。
      expect(conflicts.map((item) => item.conflictingTeachingClass.id)).toEqual([
        ids.tcA1,
      ]);
    });

    it("单周与双周不冲突；二者与「每周」都冲突", async () => {
      const odd = await createEntryOk(
        ids.tcA2,
        entryBody({
          weekday: 3,
          startPeriod: 5,
          endPeriod: 6,
          weekParity: "odd",
          classroom: "实验楼 C303",
        }),
      );
      expect(odd.conflicts).toEqual([]);

      const even = await createEntryOk(
        ids.tcB1,
        entryBody({
          weekday: 3,
          startPeriod: 5,
          endPeriod: 6,
          weekParity: "even",
          classroom: "实验楼 C303",
        }),
        teacherBCookie,
      );
      // 教师不同、教室相同，但单周与双周从不落在同一周，因此不冲突。
      expect(even.conflicts).toEqual([]);

      const every = await createEntryOk(
        ids.tcA1,
        entryBody({
          weekday: 3,
          startPeriod: 5,
          endPeriod: 6,
          weekParity: "every",
          classroom: "实验楼 C303",
        }),
      );
      expect(every.conflicts).toHaveLength(2);
      expect(
        every.conflicts
          .map((item) => item.conflictingEntryId)
          .sort(),
      ).toEqual([odd.entry.id, even.entry.id].sort());
      expect(
        every.conflicts.every((item) => item.reasons.includes("classroom")),
      ).toBe(true);

      // 两个单周条目之间仍然冲突（教师与教室都相同）。
      await createEntryOk(
        ids.tcA1,
        entryBody({
          weekday: 3,
          startPeriod: 7,
          endPeriod: 8,
          weekParity: "odd",
          classroom: "实验楼 D404",
        }),
      );
      const oddSame = await createEntryOk(
        ids.tcB1,
        entryBody({
          weekday: 3,
          startPeriod: 7,
          endPeriod: 8,
          weekParity: "odd",
          classroom: "实验楼 D404",
        }),
        teacherBCookie,
      );
      expect(oddSame.conflicts).toHaveLength(1);
      expect(oddSame.conflicts[0]!.reasons).toEqual(["classroom"]);
    });

    it("节次区间只相接不算冲突，真正相交才算", async () => {
      await createEntryOk(
        ids.tcA1,
        entryBody({
          weekday: 4,
          startPeriod: 1,
          endPeriod: 2,
          classroom: "教学楼 E505",
        }),
      );

      const adjacent = await createEntryOk(
        ids.tcA2,
        entryBody({
          weekday: 4,
          startPeriod: 3,
          endPeriod: 4,
          classroom: "教学楼 E505",
        }),
      );
      expect(adjacent.conflicts).toEqual([]);

      const overlapping = await api(
        "PATCH",
        entryRoute(ids.tcA2, adjacent.entry.id),
        entryBody({
          weekday: 4,
          startPeriod: 2,
          endPeriod: 4,
          classroom: "教学楼 E505",
        }),
        teacherACookie,
      );
      expect(overlapping.status).toBe(200);
      const body = (await overlapping.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(body.entry.startPeriod).toBe(2);
      expect(body.conflicts).toHaveLength(1);
      expect(body.conflicts[0]!.conflictingEntryId).not.toBe(body.entry.id);
      expect(body.conflicts[0]!.reasons).toContain("teacher");
    });
  });
});
