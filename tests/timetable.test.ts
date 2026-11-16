import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { queryRows } from "./support/db";
import { databaseUrl, ROOT } from "./support/env";
import { loginCookie } from "./support/login";

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

/** 保存前判定冲突：未带确认标志时必须是 409，且响应里带完整的冲突详情。 */
async function createEntryRejected(
  teachingClassId: string,
  body: Json,
  cookie: string = teacherACookie,
): Promise<{ error: string; conflicts: ConflictJson[] }> {
  const response = await createEntry(teachingClassId, body, cookie);
  expect(response.status).toBe(409);
  const payload = (await response.json()) as {
    error?: unknown;
    conflicts?: unknown;
  };
  expect(typeof payload.error).toBe("string");
  expect(Array.isArray(payload.conflicts)).toBe(true);
  return payload as { error: string; conflicts: ConflictJson[] };
}

async function entryCount(): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    app.schema!,
    "select count(*)::int as count from timetable_entries",
  );
  return rows[0]!.count;
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

async function page(route: string, cookie?: string): Promise<Response> {
  return fetch(`${app.baseUrl}${route}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
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

    it("同教师的不同教学班时间重叠时先返回 409 且不落库，确认后才保存", async () => {
      const body = entryBody({ classroom: "教学楼 B202" });
      const before = await entryCount();

      const blocked = await createEntryRejected(ids.tcA2, body);
      expect(blocked.error).toContain("冲突");
      expect(blocked.error).toContain("未保存");
      expect(blocked.conflicts).toHaveLength(1);
      const conflict = blocked.conflicts[0]!;
      expect(conflict).toMatchObject({
        reasons: ["teacher"],
        conflictingTeachingClass: {
          id: ids.tcA1,
          displayName: "高二 1 班 高等数学",
        },
      });
      expect(conflict.message).toContain("高二 1 班 高等数学");
      expect(conflict.message).toContain("同一教师");

      // 未确认的冲突不落库：条目数与列表都没有变化。
      expect(await entryCount()).toBe(before);
      const untouched = await listTimetable(ids.tcA2);
      expect(untouched.entries).toEqual([]);
      expect(untouched.conflicts).toEqual([]);

      // 确认后才写入，并把「已确认冲突」的痕迹留在条目上。
      const { entry, conflicts } = await createEntryOk(ids.tcA2, {
        ...body,
        acknowledgeConflicts: true,
      });
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.conflictingTeachingClass.id).toBe(ids.tcA1);
      expect(entry.acknowledgedAt).not.toBeNull();
      expect(await entryCount()).toBe(before + 1);

      const saved = await listTimetable(ids.tcA2);
      expect(saved.entries.map((item) => item.id)).toEqual([entry.id]);
      expect(saved.conflicts).toHaveLength(1);

      const other = await listTimetable(ids.tcA1);
      expect(other.conflicts).toHaveLength(1);
      expect(other.conflicts[0]!.conflictingTeachingClass.id).toBe(ids.tcA2);
    });

    it("同一教室名的不同教学班时间重叠时先提示冲突，确认后可保存；不同教师的课不会被判为教师冲突", async () => {
      const body = entryBody({ classroom: "教学楼 A101" });
      const blocked = await createEntryRejected(ids.tcB1, body, teacherBCookie);
      expect(blocked.conflicts).toHaveLength(1);
      const conflict = blocked.conflicts[0]!;
      expect(conflict.reasons).toEqual(["classroom"]);
      expect(conflict.conflictingTeachingClass.id).toBe(ids.tcA1);
      expect(conflict.message).toContain("同一教室");
      expect(conflict.message).not.toContain("同一教师");
      expect((await listTimetable(ids.tcB1, teacherBCookie)).entries).toEqual([]);

      const { conflicts } = await createEntryOk(
        ids.tcB1,
        { ...body, acknowledgeConflicts: true },
        teacherBCookie,
      );
      expect(conflicts).toHaveLength(1);
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

      const everyBody = entryBody({
        weekday: 3,
        startPeriod: 5,
        endPeriod: 6,
        weekParity: "every",
        classroom: "实验楼 C303",
      });
      const everyBlocked = await createEntryRejected(ids.tcA1, everyBody);
      expect(everyBlocked.conflicts).toHaveLength(2);
      expect(
        everyBlocked.conflicts
          .map((item) => item.conflictingEntryId)
          .sort(),
      ).toEqual([odd.entry.id, even.entry.id].sort());
      expect(
        everyBlocked.conflicts.every((item) => item.reasons.includes("classroom")),
      ).toBe(true);

      const every = await createEntryOk(ids.tcA1, {
        ...everyBody,
        acknowledgeConflicts: true,
      });
      expect(every.conflicts).toHaveLength(2);
      expect(every.entry.acknowledgedAt).not.toBeNull();

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
      const oddSameBody = entryBody({
        weekday: 3,
        startPeriod: 7,
        endPeriod: 8,
        weekParity: "odd",
        classroom: "实验楼 D404",
      });
      const oddSameBlocked = await createEntryRejected(
        ids.tcB1,
        oddSameBody,
        teacherBCookie,
      );
      expect(oddSameBlocked.conflicts).toHaveLength(1);
      expect(oddSameBlocked.conflicts[0]!.reasons).toEqual(["classroom"]);
      const oddSame = await createEntryOk(
        ids.tcB1,
        { ...oddSameBody, acknowledgeConflicts: true },
        teacherBCookie,
      );
      expect(oddSame.conflicts).toHaveLength(1);
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

      const overlappingBody = entryBody({
        weekday: 4,
        startPeriod: 2,
        endPeriod: 4,
        classroom: "教学楼 E505",
      });
      const overlappingResponse = await api(
        "PATCH",
        entryRoute(ids.tcA2, adjacent.entry.id),
        overlappingBody,
        teacherACookie,
      );
      expect(overlappingResponse.status).toBe(409);
      const overlapping = (await overlappingResponse.json()) as {
        error: string;
        conflicts: ConflictJson[];
      };
      expect(overlapping.error).toContain("尚未保存");
      expect(overlapping.conflicts).toHaveLength(1);
      expect(overlapping.conflicts[0]!.conflictingEntryId).not.toBe(
        adjacent.entry.id,
      );
      expect(overlapping.conflicts[0]!.reasons).toContain("teacher");

      // 未确认的 PATCH 不落库，原条目保持 3-4 节。
      const untouched = (await listTimetable(ids.tcA2)).entries.find(
        (item) => item.id === adjacent.entry.id,
      )!;
      expect(untouched).toMatchObject({ startPeriod: 3, endPeriod: 4 });

      const confirmed = await api(
        "PATCH",
        entryRoute(ids.tcA2, adjacent.entry.id),
        { ...overlappingBody, acknowledgeConflicts: true },
        teacherACookie,
      );
      expect(confirmed.status).toBe(200);
      const body = (await confirmed.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(body.entry.startPeriod).toBe(2);
      expect(body.entry.acknowledgedAt).not.toBeNull();
      expect(body.conflicts).toHaveLength(1);
      expect(body.conflicts[0]!.conflictingEntryId).not.toBe(body.entry.id);
      expect(body.conflicts[0]!.reasons).toContain("teacher");
    });
  });

  describe("冲突边界", () => {
    it("周次区间只相接不算冲突，真正相交才算；跨学期同一时段不冲突", async () => {
      const first = await createEntryOk(
        ids.tcA1,
        entryBody({
          weekday: 5,
          startWeek: 1,
          endWeek: 8,
          weekParity: "odd",
          classroom: "教学楼 F606",
        }),
      );
      expect(first.conflicts).toEqual([]);

      const second = await createEntryOk(
        ids.tcA2,
        entryBody({
          weekday: 5,
          startWeek: 9,
          endWeek: 16,
          weekParity: "odd",
          classroom: "教学楼 F606",
        }),
      );
      // 第 8 周与第 9 周不相交；同教师、同教室也不构成重叠。
      expect(second.conflicts).toEqual([]);

      const overlappingBody = entryBody({
        weekday: 5,
        startWeek: 8,
        endWeek: 16,
        weekParity: "odd",
        classroom: "教学楼 F606",
      });
      const overlappingResponse = await api(
        "PATCH",
        entryRoute(ids.tcA2, second.entry.id),
        overlappingBody,
        teacherACookie,
      );
      expect(overlappingResponse.status).toBe(409);
      const overlapping = (await overlappingResponse.json()) as {
        error: string;
        conflicts: ConflictJson[];
      };
      expect(overlapping.conflicts).toHaveLength(1);
      expect(overlapping.conflicts[0]!.conflictingEntryId).toBe(first.entry.id);
      expect(overlapping.conflicts[0]!.reasons).toEqual(["teacher", "classroom"]);

      const unchanged = (await listTimetable(ids.tcA2)).entries.find(
        (item) => item.id === second.entry.id,
      )!;
      expect(unchanged.startWeek).toBe(9);

      const confirmed = await api(
        "PATCH",
        entryRoute(ids.tcA2, second.entry.id),
        { ...overlappingBody, acknowledgeConflicts: true },
        teacherACookie,
      );
      expect(confirmed.status).toBe(200);
      const body = (await confirmed.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(body.entry.startWeek).toBe(8);
      expect(body.conflicts).toHaveLength(1);
      expect(body.conflicts[0]!.conflictingEntryId).toBe(first.entry.id);
      expect(body.conflicts[0]!.reasons).toEqual(["teacher", "classroom"]);

      // 换一个学期后，同一教师、同一教室、同一时间也不算冲突。
      const otherTerm = await createEntryOk(
        ids.tcAOtherTerm,
        entryBody({ classroom: "教学楼 A101" }),
      );
      expect(otherTerm.conflicts).toEqual([]);
    });

    it("同一教学班内部时间重叠也算冲突：先 409 不落库，确认后才保存", async () => {
      const body = entryBody({
        weekday: 6,
        startPeriod: 1,
        endPeriod: 2,
        classroom: "教学楼 G707",
      });
      const first = await createEntryOk(ids.tcA1, body);
      expect(first.conflicts).toEqual([]);

      const before = await entryCount();
      const blocked = await createEntryRejected(ids.tcA1, body);
      expect(blocked.error).toContain("冲突");
      expect(blocked.conflicts).toHaveLength(1);
      expect(blocked.conflicts[0]).toMatchObject({
        reasons: ["same_teaching_class"],
        conflictingEntryId: first.entry.id,
        conflictingTeachingClass: { id: ids.tcA1 },
      });
      expect(blocked.conflicts[0]!.message).toContain("同一教学班");
      expect(await entryCount()).toBe(before);

      const list = await listTimetable(ids.tcA1);
      expect(list.entries.filter((item) => item.weekday === 6)).toHaveLength(1);

      const second = await createEntryOk(ids.tcA1, {
        ...body,
        acknowledgeConflicts: true,
      });
      expect(second.conflicts).toHaveLength(1);
      expect(second.entry.acknowledgedAt).not.toBeNull();
      expect(await entryCount()).toBe(before + 1);

      // 同一个教学班里只相接不算相交：第 3-4 节与第 1-2 节可以共存。
      const adjacent = await createEntryOk(
        ids.tcA1,
        entryBody({
          weekday: 6,
          startPeriod: 3,
          endPeriod: 4,
          classroom: "教学楼 G707",
        }),
      );
      expect(adjacent.conflicts).toEqual([]);

      // 班内冲突在列表里对双方各报一次。
      const after = await listTimetable(ids.tcA1);
      expect(
        after.conflicts.filter((item) => item.entryId === first.entry.id),
      ).toHaveLength(1);
      expect(
        after.conflicts.filter((item) => item.entryId === second.entry.id),
      ).toHaveLength(1);
    });
  });

  describe("确认冲突与增删改", () => {
    it("保存时显式确认冲突会留下「已确认冲突」的痕迹，之后未确认的修改不生效", async () => {
      const base = entryBody({
        weekday: 7,
        startPeriod: 1,
        endPeriod: 2,
        classroom: "教学楼 H808",
      });

      await createEntryOk(ids.tcA1, base);

      // 与 tcA1 同教师、同教室、同时间：未确认时被拒绝，条目根本不存在。
      const before = await entryCount();
      const unconfirmed = await createEntryRejected(ids.tcA2, base);
      expect(unconfirmed.conflicts).toHaveLength(1);
      expect(await entryCount()).toBe(before);

      const a2 = await createEntryOk(ids.tcA2, {
        ...base,
        acknowledgeConflicts: true,
      });
      expect(a2.conflicts).toHaveLength(1);
      expect(a2.entry.acknowledgedAt).not.toBeNull();

      // 同教室、不同教师：与两个班都冲突；创建时就确认。
      const confirmed = await createEntryOk(
        ids.tcB1,
        { ...base, acknowledgeConflicts: true },
        teacherBCookie,
      );
      expect(confirmed.conflicts).toHaveLength(2);
      expect(typeof confirmed.entry.acknowledgedAt).toBe("string");
      expect(
        Number.isNaN(Date.parse(confirmed.entry.acknowledgedAt!)),
      ).toBe(false);

      const saved = await listTimetable(ids.tcB1, teacherBCookie);
      expect(
        saved.entries.find((item) => item.id === confirmed.entry.id)
          ?.acknowledgedAt,
      ).toBe(confirmed.entry.acknowledgedAt);

      // 未确认的修改请求不会清掉已确认的痕迹：条目保持原值。
      const rejectedPatch = await api(
        "PATCH",
        entryRoute(ids.tcB1, confirmed.entry.id),
        base,
        teacherBCookie,
      );
      expect(rejectedPatch.status).toBe(409);
      const stillAcknowledged = (
        await listTimetable(ids.tcB1, teacherBCookie)
      ).entries.find((item) => item.id === confirmed.entry.id)!;
      expect(stillAcknowledged.acknowledgedAt).toBe(
        confirmed.entry.acknowledgedAt,
      );
      expect(stillAcknowledged).toMatchObject({
        weekday: 7,
        startPeriod: 1,
        endPeriod: 2,
        classroom: "教学楼 H808",
      });

      // 改成无冲突的时间后正常保存，并清空确认痕迹。
      const moved = await api(
        "PATCH",
        entryRoute(ids.tcB1, confirmed.entry.id),
        entryBody({
          weekday: 7,
          startPeriod: 3,
          endPeriod: 4,
          classroom: "教学楼 H808",
        }),
        teacherBCookie,
      );
      expect(moved.status).toBe(200);
      const movedBody = (await moved.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(movedBody.conflicts).toEqual([]);
      expect(movedBody.entry.acknowledgedAt).toBeNull();
    });

    it("删除条目后相关警告随之消失", async () => {
      const anchor = await createEntryOk(
        ids.tcB1,
        entryBody({
          weekday: 6,
          startPeriod: 5,
          endPeriod: 6,
          classroom: "教学楼 K909",
        }),
        teacherBCookie,
      );
      const extraBody = entryBody({
        weekday: 6,
        startPeriod: 5,
        endPeriod: 6,
        classroom: "教学楼 K909",
      });
      const blocked = await createEntryRejected(ids.tcA2, extraBody);
      expect(blocked.conflicts).toHaveLength(1);
      expect(blocked.conflicts[0]!.conflictingEntryId).toBe(anchor.entry.id);

      const extra = await createEntryOk(ids.tcA2, {
        ...extraBody,
        acknowledgeConflicts: true,
      });
      expect(extra.conflicts).toHaveLength(1);
      expect(extra.conflicts[0]!.conflictingEntryId).toBe(anchor.entry.id);

      const before = await listTimetable(ids.tcB1, teacherBCookie);
      expect(
        before.conflicts.some(
          (item) => item.conflictingEntryId === extra.entry.id,
        ),
      ).toBe(true);

      const removed = await api(
        "DELETE",
        entryRoute(ids.tcA2, extra.entry.id),
        undefined,
        teacherACookie,
      );
      expect(removed.status).toBe(204);

      const after = await listTimetable(ids.tcB1, teacherBCookie);
      expect(
        after.conflicts.some(
          (item) => item.conflictingEntryId === extra.entry.id,
        ),
      ).toBe(false);
      expect(after.entries.map((item) => item.id)).toContain(anchor.entry.id);

      const afterA = await listTimetable(ids.tcA2);
      expect(
        afterA.entries.some((item) => item.id === extra.entry.id),
      ).toBe(false);

      const again = await api(
        "DELETE",
        entryRoute(ids.tcA2, extra.entry.id),
        undefined,
        teacherACookie,
      );
      expect(again.status).toBe(404);
      expect(await errorOf(again)).toContain("课表条目");
    });

    it("修改条目后旧警告消失；改到冲突时间则先 409，确认后才保存", async () => {
      const thursday = await listTimetable(ids.tcA2);
      const entry = thursday.entries.find((item) => item.weekday === 4)!;

      const freeBody = entryBody({
        weekday: 4,
        startPeriod: 3,
        endPeriod: 4,
        classroom: "教学楼 E505",
      });
      const moved = await api(
        "PATCH",
        entryRoute(ids.tcA2, entry.id),
        freeBody,
        teacherACookie,
      );
      expect(moved.status).toBe(200);
      const movedBody = (await moved.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(movedBody.entry).toMatchObject({
        startPeriod: 3,
        endPeriod: 4,
        classroom: "教学楼 E505",
      });
      expect(movedBody.conflicts).toEqual([]);
      expect(movedBody.entry.acknowledgedAt).toBeNull();

      const list = await listTimetable(ids.tcA2);
      expect(
        list.conflicts.filter((item) => item.entryId === entry.id),
      ).toEqual([]);

      // 再改回与 tcA1 重叠的时间：未确认时不生效。
      const conflictingBody = entryBody({
        weekday: 4,
        startPeriod: 2,
        endPeriod: 4,
        classroom: "教学楼 E505",
      });
      const blockedResponse = await api(
        "PATCH",
        entryRoute(ids.tcA2, entry.id),
        conflictingBody,
        teacherACookie,
      );
      expect(blockedResponse.status).toBe(409);
      const blocked = (await blockedResponse.json()) as {
        error: string;
        conflicts: ConflictJson[];
      };
      expect(blocked.conflicts).toHaveLength(1);
      const unchanged = (await listTimetable(ids.tcA2)).entries.find(
        (item) => item.id === entry.id,
      )!;
      expect(unchanged.startPeriod).toBe(3);

      const confirmed = await api(
        "PATCH",
        entryRoute(ids.tcA2, entry.id),
        { ...conflictingBody, acknowledgeConflicts: true },
        teacherACookie,
      );
      expect(confirmed.status).toBe(200);
      const confirmedBody = (await confirmed.json()) as {
        entry: EntryJson;
        conflicts: ConflictJson[];
      };
      expect(confirmedBody.conflicts).toHaveLength(1);
      expect(confirmedBody.entry.acknowledgedAt).not.toBeNull();
    });
  });

  describe("权限与校验", () => {
    it("教师只能写自己任教的教学班，学生与未登录用户被拒绝", async () => {
      const entry = (await listTimetable(ids.tcA1)).entries[0]!;

      const foreignCreate = await createEntry(
        ids.tcA1,
        entryBody({ weekday: 2, startPeriod: 9, endPeriod: 10 }),
        teacherBCookie,
      );
      expect(foreignCreate.status).toBe(403);
      expect(await errorOf(foreignCreate)).toBe("无权访问。");

      const ownOther = await createEntry(
        ids.tcB1,
        entryBody({ weekday: 2, startPeriod: 9, endPeriod: 10 }),
        teacherACookie,
      );
      expect(ownOther.status).toBe(403);

      for (const request of [
        api(
          "PATCH",
          entryRoute(ids.tcA1, entry.id),
          entryBody({ weekday: 2, startPeriod: 9, endPeriod: 10 }),
          teacherBCookie,
        ),
        api(
          "DELETE",
          entryRoute(ids.tcA1, entry.id),
          undefined,
          teacherBCookie,
        ),
        api(
          "GET",
          timetableRoute(ids.tcA1),
          undefined,
          teacherBCookie,
        ),
      ]) {
        const response = await request;
        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe("无权访问。");
      }

      const byStudent = await createEntry(
        ids.tcA1,
        entryBody({ weekday: 2, startPeriod: 9, endPeriod: 10 }),
        studentCookie,
      );
      expect(byStudent.status).toBe(403);

      const anonymous = await createEntry(
        ids.tcA1,
        entryBody({ weekday: 2, startPeriod: 9, endPeriod: 10 }),
        "",
      );
      expect(anonymous.status).toBe(401);
      expect(await errorOf(anonymous)).toBe("请先登录。");

      // 教务管理员可写全部，也仍然会在冲突时收到警告。
      const byAdmin = await createEntry(
        ids.tcA1,
        entryBody({
          weekday: 2,
          startPeriod: 9,
          endPeriod: 10,
          classroom: "教学楼 A101",
        }),
        adminCookie,
      );
      expect(byAdmin.status).toBe(201);
      const adminEntry = ((await byAdmin.json()) as { entry: EntryJson }).entry;

      const adminUpdate = await api(
        "PATCH",
        entryRoute(ids.tcA1, adminEntry.id),
        entryBody({
          weekday: 2,
          startPeriod: 9,
          endPeriod: 10,
          classroom: "教学楼 A101",
        }),
        adminCookie,
      );
      expect(adminUpdate.status).toBe(200);

      const adminDelete = await api(
        "DELETE",
        entryRoute(ids.tcA1, adminEntry.id),
        undefined,
        adminCookie,
      );
      expect(adminDelete.status).toBe(204);
    });

    it("不存在的教学班与条目返回可读的 404", async () => {
      const missingClass = "00000000-0000-4000-8000-000000000000";

      const asTeacher = await api(
        "GET",
        timetableRoute(missingClass),
        undefined,
        teacherACookie,
      );
      expect(asTeacher.status).toBe(404);
      expect(await errorOf(asTeacher)).toContain("教学班");

      const asAdmin = await createEntry(
        missingClass,
        entryBody(),
        adminCookie,
      );
      expect(asAdmin.status).toBe(404);

      const malformed = await api(
        "GET",
        "/api/teaching-classes/not-a-uuid/timetable",
        undefined,
        adminCookie,
      );
      expect(malformed.status).toBe(404);

      const entry = (await listTimetable(ids.tcA2)).entries[0]!;
      const crossClassPatch = await api(
        "PATCH",
        entryRoute(ids.tcA1, entry.id),
        entryBody(),
        adminCookie,
      );
      expect(crossClassPatch.status).toBe(404);

      const crossClassDelete = await api(
        "DELETE",
        entryRoute(ids.tcA1, entry.id),
        undefined,
        adminCookie,
      );
      expect(crossClassDelete.status).toBe(404);

      const unknownEntry = await api(
        "DELETE",
        entryRoute(ids.tcA1, missingClass),
        undefined,
        adminCookie,
      );
      expect(unknownEntry.status).toBe(404);
    });

    it("结束节次早于起始、结束周早于起始等非法区间被拒绝并提示", async () => {
      const before = (
        await queryRows<{ count: number }>(
          app.schema!,
          "select count(*)::int as count from timetable_entries",
        )
      )[0]!.count;

      const cases: Array<{ body: Json; word: string }> = [
        {
          body: entryBody({ startPeriod: 5, endPeriod: 4 }),
          word: "结束节次",
        },
        {
          body: entryBody({ startWeek: 9, endWeek: 8 }),
          word: "结束周",
        },
        { body: entryBody({ weekday: 0 }), word: "星期" },
        { body: entryBody({ weekday: 8 }), word: "星期" },
        { body: entryBody({ weekday: "周一" }), word: "星期" },
        { body: entryBody({ startPeriod: 1.5 }), word: "节次" },
        { body: entryBody({ startPeriod: 0 }), word: "节次" },
        { body: entryBody({ endPeriod: 21 }), word: "节次" },
        { body: entryBody({ startWeek: 0 }), word: "周次" },
        { body: entryBody({ endWeek: 31 }), word: "周次" },
        { body: entryBody({ weekParity: "biweekly" }), word: "单双周" },
        { body: entryBody({ weekParity: undefined }), word: "单双周" },
        { body: entryBody({ classroom: "   " }), word: "教室名" },
        { body: entryBody({ classroom: "教".repeat(65) }), word: "教室名" },
        {
          body: {
            startPeriod: 1,
            endPeriod: 2,
            startWeek: 1,
            endWeek: 16,
            weekParity: "every",
            classroom: "教学楼 A101",
          },
          word: "星期",
        },
        {
          body: {
            weekday: 1,
            startWeek: 1,
            endWeek: 16,
            weekParity: "every",
            classroom: "教学楼 A101",
          },
          word: "节次",
        },
        {
          body: {
            weekday: 1,
            startPeriod: 1,
            endPeriod: 2,
            weekParity: "every",
            classroom: "教学楼 A101",
          },
          word: "起始周",
        },
      ];

      for (const item of cases) {
        const response = await createEntry(ids.tcA1, item.body);
        expect(response.status).toBe(400);
        expect(await errorOf(response)).toContain(item.word);
      }

      const after = (
        await queryRows<{ count: number }>(
          app.schema!,
          "select count(*)::int as count from timetable_entries",
        )
      )[0]!.count;
      expect(after).toBe(before);

      // 修改时同样拒绝非法区间，且原条目保持不变。
      const entry = (await listTimetable(ids.tcA1)).entries.find(
        (item) => item.weekday === 4,
      )!;
      const invalidPatch = await api(
        "PATCH",
        entryRoute(ids.tcA1, entry.id),
        entryBody({
          weekday: 4,
          startPeriod: 3,
          endPeriod: 1,
          classroom: "教学楼 E505",
        }),
        teacherACookie,
      );
      expect(invalidPatch.status).toBe(400);
      expect(await errorOf(invalidPatch)).toContain("结束节次");

      const unchanged = await listTimetable(ids.tcA1);
      expect(unchanged.entries.find((item) => item.id === entry.id)).toEqual(
        entry,
      );
    });
  });

  describe("课表页面", () => {
    it("教师端教学班详情页展示课表、冲突警告与「已确认冲突」痕迹", async () => {
      const own = await page(
        `/teacher/teaching-classes/${ids.tcA1}`,
        teacherACookie,
      );
      expect(own.status).toBe(200);
      const html = await own.text();
      expect(html).toContain("课表");
      expect(html).toContain("周一");
      expect(html).toContain("第 1-2 节");
      expect(html).toContain("第 1-16 周");
      expect(html).toContain("每周");
      expect(html).toContain("教学楼 A101");
      expect(html).toContain("已确认冲突");
      expect(html).toContain("当前有");
      expect(html).toContain("同一教师");
      expect(html).toContain("同一教室");
      expect(html).toContain("保存前会检查冲突");
      expect(html).toContain("添加课表条目");
      expect(html).toContain("单双周");
      expect(html).not.toContain("Internal Server Error");

      const acknowledgedPage = await page(
        `/teacher/teaching-classes/${ids.tcA2}`,
        teacherACookie,
      );
      expect(acknowledgedPage.status).toBe(200);
      expect(await acknowledgedPage.text()).toContain("已确认冲突");

      const byTeacherB = await page(
        `/teacher/teaching-classes/${ids.tcA1}`,
        teacherBCookie,
      );
      expect(byTeacherB.status).toBe(403);

      const byStudent = await page(
        `/teacher/teaching-classes/${ids.tcA1}`,
        studentCookie,
      );
      expect(byStudent.status).toBe(403);
    });

    it("教务管理员在教学班详情页也能看到并维护课表", async () => {
      const response = await page(
        `/admin/teaching-classes/${ids.tcA1}`,
        adminCookie,
      );
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("课表");
      expect(html).toContain("周一");
      expect(html).toContain("教学楼 A101");
      expect(html).toContain("添加课表条目");
      expect(html).not.toContain("服务暂时不可用");
    });

    it("尚未排课的教学班给出明确的空状态", async () => {
      const teacherA = await teachingClassIdOf(TEACHER_A_LOGIN);
      const emptyId = await createTeachingClass({
        termId: ids.termFirst,
        teacherAccountId: teacherA,
        displayName: "高二 3 班 高等数学（未排课）",
      });

      const response = await page(
        `/teacher/teaching-classes/${emptyId}`,
        teacherACookie,
      );
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("还没有课表");
      expect(html).toContain("添加课表条目");
    });
  });
});
