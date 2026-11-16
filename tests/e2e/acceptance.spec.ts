import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { startTestApp, type TestApp } from "../support/app";
import { newSchemaName } from "../support/db";
import { databaseUrl, ROOT } from "../support/env";

/**
 * 第一版验收剧本（#15）：一条用例走真实浏览器，覆盖
 *
 * 管理员导入 2 个行政班共 20 名学生 → 建课程与教学班 → 排含单双周的课表
 * → 教师录入 3 个成绩项并发布 → 学生登录只看到自己的课表与总评
 * → 管理员在变更日志里看到本次发布。
 *
 * 只跑 happy path；测试数据全部虚构。
 */

const ADMIN = {
  loginName: "admin",
  displayName: "教务测试",
  password: "e2e-admin-pass-2026",
} as const;

const TEACHER = {
  loginName: "T2026001",
  displayName: "王老师",
  password: "e2e-teacher-pass-2026",
} as const;

const CLASS_ONE = "高二 1 班";
const CLASS_TWO = "高二 2 班";
const COURSE = "高等数学";
const TEACHING_CLASS = "高二 1 班 高等数学";
const TERM_START_YEAR = 2025;
const TERM_LABEL = `${TERM_START_YEAR}-${TERM_START_YEAR + 1} 学年上学期`;

/** 张三：导入后拿到一次性初始密码，首登强制改密。 */
const LEAD_STUDENT = { studentNumber: "20250101", name: "张三" } as const;
const OTHER_STUDENT = { studentNumber: "20250102", name: "李四" } as const;
const STUDENT_NEW_PASSWORD = "e2e-student-pass-2026";

const GRADE_ITEMS = [
  { name: "平时", maxScore: 100, weight: 30, score: 90 },
  { name: "期中", maxScore: 100, weight: 30, score: 80 },
  { name: "期末", maxScore: 100, weight: 40, score: 70 },
] as const;

/** 90×30% + 80×30% + 70×40% = 79。预期值来自规格里的加权公式，不是调用实现算出来的。 */
const EXPECTED_OVERALL = "79";

const FIXTURE_CSV = path.join(ROOT, "tests", "e2e", "fixtures", "students.csv");

let app: TestApp;

function appUrl(pathname: string): string {
  return `${app.baseUrl}${pathname}`;
}

function runAccountScript(
  schema: string,
  args: readonly string[],
): void {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/create-account.mjs"), ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(),
        DATABASE_SCHEMA: schema,
      },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `创建测试账号失败（${args.join(" ")}）：\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

/** 页面里的某个二级区块（h2 标题所在的 section），避免同名输入框互相干扰。 */
function panel(page: Page, heading: string): ReturnType<Page["locator"]> {
  return page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { level: 2, name: heading, exact: true }),
    })
    .first();
}

async function login(page: Page, loginName: string, password: string) {
  await page.goto(appUrl("/login"));
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login")),
    page.getByRole("button", { name: "登录", exact: true }).click(),
  ]);
}

/**
 * 表单提交成功后页面会 `window.location.reload()`；必须等整页导航完成，
 * 否则紧接着的 goto 会与仍在进行的刷新抢占，出现 net::ERR_ABORTED。
 */
async function clickExpectingReload(page: Page, trigger: Locator) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    trigger.click(),
  ]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间下「今天」的 UTC 零点，避免运行机器的时区影响教学周计算。 */
function beijingTodayUtcMs(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return Date.UTC(value("year"), value("month") - 1, value("day"));
}

/**
 * 取「两周前的周一」作为开学日期，这样运行时无论哪天，当前都恰好是第 3 周（单周）。
 * 于是单周课显示「本周要上」、双周课显示「本周不上」，断言不会随日期漂移。
 */
function termStartsOn(): string {
  const today = beijingTodayUtcMs();
  const weekday = new Date(today).getUTCDay(); // 0 = 周日
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(today - (daysSinceMonday + 14) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

type TimetableEntryInput = {
  weekday: string;
  startPeriod: number;
  endPeriod: number;
  weekParity: string;
  classroom: string;
};

async function addTimetableEntry(page: Page, entry: TimetableEntryInput) {
  await page.getByRole("button", { name: "添加课表条目" }).click();
  const form = page.locator("form").filter({ has: page.getByLabel("教室名") });

  await form.getByLabel("星期").selectOption({ label: entry.weekday });
  await form.getByLabel("起始节次").fill(String(entry.startPeriod));
  await form.getByLabel("结束节次").fill(String(entry.endPeriod));
  await form.getByLabel("起始周").fill("1");
  await form.getByLabel("结束周").fill("8");
  await form.getByLabel("单双周").selectOption({ label: entry.weekParity });
  await form.getByLabel("教室名").fill(entry.classroom);

  await clickExpectingReload(
    page,
    form.getByRole("button", { name: "保存课表" }),
  );
  // 保存成功后页面会重新加载；等表格里出现这条教室，避免与 reload 抢跑。
  await expect(
    page.getByRole("cell", { name: entry.classroom, exact: true }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  app = await startTestApp({ schema: newSchemaName("e2e") });

  if (app.schema === null) {
    throw new Error("e2e 需要独占 schema，但测试应用没有创建。");
  }

  // 首个管理员与教师账号属于环境准备，不是验收剧本的一步；
  // 学生账号则必须由管理员通过 CSV 导入真实产生。
  runAccountScript(app.schema, [
    "--login",
    ADMIN.loginName,
    "--name",
    ADMIN.displayName,
    "--role",
    "administrator",
    "--password",
    ADMIN.password,
    "--no-force-change",
  ]);
  runAccountScript(app.schema, [
    "--login",
    TEACHER.loginName,
    "--name",
    TEACHER.displayName,
    "--role",
    "teacher",
    "--password",
    TEACHER.password,
    "--no-force-change",
  ]);
});

test.afterAll(async () => {
  await app.stop();
});

test("验收剧本：导入名单 → 排课 → 录入并发布成绩 → 学生查询 → 变更日志", async ({
  browser,
}) => {
  const startsOn = termStartsOn();
  let leadStudentInitialPassword = "";

  const adminContext = await browser.newContext();
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();

  try {
    const admin = await adminContext.newPage();
    const teacher = await teacherContext.newPage();
    const student = await studentContext.newPage();

    await test.step("1. 教务管理员登录", async () => {
      await login(admin, ADMIN.loginName, ADMIN.password);
      await expect(
        admin.getByRole("heading", { name: "账号管理" }),
      ).toBeVisible();
    });

    await test.step("2. 建两个行政班", async () => {
      await admin.goto(appUrl("/admin/students"));
      for (const className of [CLASS_ONE, CLASS_TWO]) {
        await admin.getByLabel("行政班名称").fill(className);
        await clickExpectingReload(
          admin,
          admin.getByRole("button", { name: "创建行政班" }),
        );
        await expect(
          admin.getByRole("link", { name: className, exact: true }),
        ).toBeVisible();
      }
    });

    await test.step("3. CSV 导入 2 个行政班共 20 名学生", async () => {
      await admin
        .getByLabel("CSV 文件")
        .setInputFiles(FIXTURE_CSV);
      await admin.getByRole("button", { name: "上传并导入" }).click();

      const result = admin.getByRole("region", { name: "导入结果" });
      await expect(result).toBeVisible();
      await expect(result.getByText(/新建 20 人/)).toBeVisible();
      await expect(result.getByText(/更新 0 人/)).toBeVisible();
      await expect(result.getByText(/失败 0 行/)).toBeVisible();
      await expect(result.locator("tbody tr")).toHaveCount(20);
      await expect(
        result.locator("tbody tr").filter({ hasText: LEAD_STUDENT.name }),
      ).toContainText(LEAD_STUDENT.studentNumber);
      await expect(
        result.locator("tbody tr").filter({ hasText: OTHER_STUDENT.name }),
      ).toContainText(OTHER_STUDENT.studentNumber);

      // 一次性初始密码只显示这一次，学生登录时要用。
      leadStudentInitialPassword = (
        await result
          .locator("tbody tr")
          .filter({ hasText: LEAD_STUDENT.studentNumber })
          .locator("td")
          .nth(5)
          .innerText()
      ).trim();
      expect(leadStudentInitialPassword.length).toBeGreaterThanOrEqual(8);
    });

    await test.step("4. 建学年、学期并设为当前学期，设置开学日期", async () => {
      await admin.goto(appUrl("/admin/terms"));
      await admin.getByLabel("起始年份").fill(String(TERM_START_YEAR));
      await clickExpectingReload(
        admin,
        admin.getByRole("button", { name: "创建学年" }),
      );
      await expect(
        admin.getByRole("heading", {
          name: `${TERM_START_YEAR}-${TERM_START_YEAR + 1} 学年`,
        }),
      ).toBeVisible();

      await clickExpectingReload(
        admin,
        admin.getByRole("button", { name: "创建学期" }),
      );
      const termRow = admin.locator("tr").filter({ hasText: TERM_LABEL });
      await expect(termRow).toBeVisible();

      const currentControl = termRow.locator("details");
      await currentControl.locator("summary").click();
      await clickExpectingReload(
        admin,
        currentControl.getByRole("button", { name: "确认切换" }),
      );
      await expect(
        admin.getByText(`当前学期：${TERM_LABEL}`),
      ).toBeVisible();

      await admin.locator('input[type="date"]').fill(startsOn);
      await clickExpectingReload(
        admin,
        admin.getByRole("button", { name: "保存开学日期" }),
      );
      await expect(admin.locator('input[type="date"]')).toHaveValue(startsOn);
    });

    await test.step("5. 建课程", async () => {
      await admin.goto(appUrl("/admin/courses"));
      await admin.getByLabel("课程名称").fill(COURSE);
      await admin.getByLabel("学分", { exact: true }).fill("3");
      await clickExpectingReload(
        admin,
        admin.getByRole("button", { name: "创建课程" }),
      );
      await expect(
        admin.getByRole("cell", { name: COURSE, exact: true }),
      ).toBeVisible();
    });

    await test.step("6. 建教学班，整班加入两个行政班共 20 人", async () => {
      await admin.goto(appUrl("/admin/teaching-classes"));
      const createForm = panel(admin, "开设教学班");
      await createForm
        .getByLabel("课程")
        .selectOption({ label: `${COURSE}（3 学分）` });
      await createForm
        .getByLabel("任课教师")
        .selectOption({ label: `${TEACHER.displayName}（${TEACHER.loginName}）` });
      await createForm.getByLabel("教学班显示名").fill(TEACHING_CLASS);
      await createForm.getByLabel("整班加入（可选）").selectOption({
        label: CLASS_ONE,
      });
      await clickExpectingReload(
        admin,
        createForm.getByRole("button", { name: "开设教学班" }),
      );

      await admin.waitForURL(/\/admin\/teaching-classes\/[0-9a-f-]{36}$/);
      await expect(
        admin.getByRole("heading", { name: TEACHING_CLASS }),
      ).toBeVisible();

      const enrollForm = panel(admin, "加入学生");
      await enrollForm.getByLabel("整班加入").selectOption({ label: CLASS_TWO });
      await clickExpectingReload(
        admin,
        enrollForm.getByRole("button", { name: "把行政班在读学生加入" }),
      );

      const info = panel(admin, "基本信息").locator("table");
      await expect(info).toContainText("20");

      const roster = panel(admin, "学生名单").locator("tbody tr");
      await expect(roster).toHaveCount(20);
      await expect(
        admin.getByRole("cell", {
          name: LEAD_STUDENT.studentNumber,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        admin.getByRole("cell", {
          name: OTHER_STUDENT.studentNumber,
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step("7. 排一张含单双周变化的课表", async () => {
      await addTimetableEntry(admin, {
        weekday: "周一",
        startPeriod: 1,
        endPeriod: 2,
        weekParity: "单周",
        classroom: "教学楼 A101",
      });
      await addTimetableEntry(admin, {
        weekday: "周三",
        startPeriod: 3,
        endPeriod: 4,
        weekParity: "双周",
        classroom: "教学楼 B202",
      });

      await expect(
        admin.getByRole("cell", { name: "第 1-8 周 单周", exact: true }),
      ).toBeVisible();
      await expect(
        admin.getByRole("cell", { name: "第 1-8 周 双周", exact: true }),
      ).toBeVisible();
    });

    await test.step("8. 教师登录，录入 3 个成绩项与全班分数", async () => {
      await login(teacher, TEACHER.loginName, TEACHER.password);
      await teacher.goto(appUrl("/teacher/teaching-classes"));

      const classRow = teacher
        .getByRole("row")
        .filter({ hasText: TEACHING_CLASS });
      await expect(classRow).toContainText("20");
      await classRow.getByRole("link", { name: "课表与名单" }).click();

      // 教师视角也能看到同一条单双周课表。
      await expect(
        teacher.getByRole("cell", { name: "第 1-8 周 单周", exact: true }),
      ).toBeVisible();
      await expect(
        teacher.getByRole("cell", { name: "第 1-8 周 双周", exact: true }),
      ).toBeVisible();

      await teacher.getByRole("link", { name: "录入成绩" }).click();
      await expect(
        teacher.getByRole("heading", { name: `成绩录入 · ${TEACHING_CLASS}` }),
      ).toBeVisible();

      const itemsPanel = panel(teacher, "成绩项");
      for (const item of GRADE_ITEMS) {
        await itemsPanel.getByLabel("名称").fill(item.name);
        await itemsPanel.getByLabel("满分").fill(String(item.maxScore));
        await itemsPanel.getByLabel("权重（%）").fill(String(item.weight));
        await itemsPanel
          .getByRole("button", { name: "添加成绩项" })
          .click();
        await expect(
          itemsPanel.getByRole("cell", { name: item.name, exact: true }),
        ).toBeVisible();
      }
      await expect(teacher.getByText(/权重合计 100%/)).toBeVisible();

      for (let row = 0; row < 20; row += 1) {
        for (const [column, item] of GRADE_ITEMS.entries()) {
          await teacher
            .locator(
              `input[data-cell-row="${row}"][data-cell-col="${column}"]`,
            )
            .fill(String(item.score));
        }
      }

      await teacher.getByRole("button", { name: "保存成绩" }).click();
      await expect(teacher.getByText(/已保存 60 处成绩/)).toBeVisible();

      const leadRow = teacher
        .getByRole("row")
        .filter({ hasText: LEAD_STUDENT.studentNumber });
      await expect(leadRow).toContainText(EXPECTED_OVERALL);
    });

    await test.step("9. 教师发布成绩并锁定", async () => {
      await teacher.getByText("发布成绩", { exact: true }).click();
      await teacher.getByRole("button", { name: "确认发布" }).click();
      await expect(
        teacher.getByText(/成绩已发布并锁定/),
      ).toBeVisible();
    });

    await test.step("10. 学生首登改密，只看到自己的课表与总评", async () => {
      await login(student, LEAD_STUDENT.studentNumber, leadStudentInitialPassword);
      await student.waitForURL(/\/change-password/);
      await expect(
        student.getByText(/首次登录，请先修改初始密码/),
      ).toBeVisible();

      await student.getByLabel("当前密码").fill(leadStudentInitialPassword);
      await student.getByLabel("新密码", { exact: true }).fill(
        STUDENT_NEW_PASSWORD,
      );
      await student
        .getByLabel("再次输入新密码")
        .fill(STUDENT_NEW_PASSWORD);
      await student.getByRole("button", { name: "修改密码" }).click();
      await student.waitForURL(/\/student$/);

      await expect(
        student.getByRole("heading", { name: "我的课表与成绩" }),
      ).toBeVisible();
      await expect(
        student.getByText(
          new RegExp(`${LEAD_STUDENT.name}（${LEAD_STUDENT.studentNumber}）`),
        ),
      ).toBeVisible();
      await expect(
        student.getByText(`当前学期：${TERM_LABEL}`),
      ).toBeVisible();
      await expect(student.getByText(/第 3 周（单周）/)).toBeVisible();

      const monday = student.locator('section[aria-label="周一"]');
      await expect(monday.locator(".timetable-entry")).toHaveCount(1);
      await expect(monday).toContainText(COURSE);
      await expect(monday).toContainText("教学楼 A101");
      await expect(monday.getByText("本周要上")).toBeVisible();

      const wednesday = student.locator('section[aria-label="周三"]');
      await expect(wednesday.locator(".timetable-entry")).toHaveCount(1);
      await expect(wednesday).toContainText(COURSE);
      await expect(wednesday).toContainText("教学楼 B202");
      await expect(wednesday.getByText("本周不上")).toBeVisible();

      const gradeCard = student
        .locator("article.grade-course")
        .filter({ hasText: COURSE });
      await expect(gradeCard.getByText("总评")).toBeVisible();
      await expect(gradeCard.locator(".grade-score strong")).toHaveText(
        EXPECTED_OVERALL,
      );

      await gradeCard.getByText("成绩明细").click();
      const gradeItems = gradeCard.locator("li.grade-item:not(.grade-item-head)");
      await expect(gradeItems).toHaveCount(3);
      for (const item of GRADE_ITEMS) {
        const itemRow = gradeItems.filter({ hasText: item.name });
        await expect(itemRow).toContainText(String(item.score));
        await expect(itemRow).toContainText(`${item.weight}%`);
      }

      // 只看到自己的：同学的数据、排名与班级平均都不应出现。
      await expect(student.getByText(OTHER_STUDENT.name)).toHaveCount(0);
      await expect(
        student.getByText(OTHER_STUDENT.studentNumber),
      ).toHaveCount(0);
      await expect(student.getByText(/排名|班级平均/)).toHaveCount(0);
    });

    await test.step("11. 教务管理员在变更日志中看到本次发布", async () => {
      await admin.goto(appUrl("/admin/grade-logs"));
      await admin
        .getByLabel("按教学班查询")
        .selectOption({ label: `${TERM_LABEL} · ${TEACHING_CLASS}` });
      await admin.getByRole("button", { name: "查询教学班" }).click();
      await admin.waitForURL(/teachingClassId=/);

      const publishRow = admin.locator('tr[data-action="publish"]');
      await expect(publishRow).toHaveCount(1);
      await expect(publishRow).toContainText(TEACHER.displayName);
      await expect(publishRow).toContainText(TEACHER.loginName);
      await expect(publishRow).toContainText(TEACHING_CLASS);
      await expect(publishRow).toContainText("发布");
    });
  } finally {
    await Promise.all([
      adminContext.close(),
      teacherContext.close(),
      studentContext.close(),
    ]);
  }
});
