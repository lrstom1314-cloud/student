import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ENROLLMENT_STATUSES,
  type EnrollmentStatus,
} from "../lib/enrollment-status";

/**
 * 账号角色。术语见 GLOSSARY.md：学生 / 教师 / 教务管理员。
 * 代码里使用稳定的英文枚举值，界面统一显示中文。
 */
export const accountRole = pgEnum("account_role", [
  "student",
  "teacher",
  "administrator",
]);

export type AccountRole = (typeof accountRole.enumValues)[number];

/**
 * 账号：三个角色共用一张表与一个登录入口。
 * 学生用学号、教师用工号作为登录名；密码只存 Argon2id 哈希。
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginName: text("login_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: accountRole("role").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 服务端会话。cookie 里只放随机令牌，数据库里只存令牌的 SHA-256 哈希，
 * 过期时间决定会话绝对寿命。
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_account_id_idx").on(table.accountId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * 学籍状态：在读 / 休学 / 转出 / 毕业。
 * 只有「在读」的学生可以登录；状态不存在其他含义。
 */
export const enrollmentStatus = pgEnum(
  "enrollment_status",
  ENROLLMENT_STATUSES,
);

export type { EnrollmentStatus };

/**
 * 行政班：名称本身含年级（如「高二 3 班」），不设年级实体。
 */
export const administrativeClasses = pgTable("administrative_classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 学生学籍：学号全局唯一，与账号 1:1（账号登录名即学号）。
 * 只存当前行政班，不存转班历史；不收集身份证号、手机号、生日、住址。
 */
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentNumber: text("student_number").notNull().unique(),
    name: text("name").notNull(),
    administrativeClassId: uuid("administrative_class_id")
      .notNull()
      .references(() => administrativeClasses.id, { onDelete: "restrict" }),
    enrollmentStatus: enrollmentStatus("enrollment_status")
      .notNull()
      .default("enrolled"),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("students_administrative_class_id_idx").on(
      table.administrativeClassId,
    ),
    uniqueIndex("students_account_id_unique").on(table.accountId),
  ],
);

/**
 * 学期在学年内的半程。术语见 GLOSSARY.md：上 / 下。
 */
export const termHalf = pgEnum("term_half", ["first", "second"]);

export type TermHalf = (typeof termHalf.enumValues)[number];

/**
 * 学年：容纳两个学期的容器，以起始年份标识（2025 表示 2025-2026 学年）。
 */
export const academicYears = pgTable("academic_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  startYear: integer("start_year").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 学期：必须属于某个学年，同一学年下只能有一个上学期、一个下学期。
 */
export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "restrict" }),
    half: termHalf("half").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("terms_academic_year_id_half_unique").on(
      table.academicYearId,
      table.half,
    ),
    index("terms_academic_year_id_idx").on(table.academicYearId),
  ],
);

/**
 * 全局唯一的系统设置行，只保存「当前学期」的指针。
 * 当前学期不是学期表上的一行标记：单行 + 单列使「全局只有一个」由结构保证。
 */
export const termSettings = pgTable(
  "term_settings",
  {
    id: text("id").primaryKey().default("singleton"),
    currentTermId: uuid("current_term_id").references(() => terms.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("term_settings_singleton", sql`${table.id} = 'singleton'`)],
);

/**
 * 课程：一门学科的静态定义，跨学期复用。名称唯一，避免同一门课被重复建模。
 * 学分与课时至少填一项；学时口径不同，因此分成两列而不是一个含义模糊的数字。
 */
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  credits: numeric("credits", { precision: 4, scale: 1 }),
  hours: integer("hours"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 教学班：某学期由一位教师开设的一门课程。
 * 同一学期同一课程可以开多个教学班，因此三者之间不设唯一约束。
 */
export const teachingClasses = pgTable(
  "teaching_classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    teacherAccountId: uuid("teacher_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("teaching_classes_term_id_idx").on(table.termId),
    index("teaching_classes_course_id_idx").on(table.courseId),
    index("teaching_classes_teacher_account_id_idx").on(table.teacherAccountId),
  ],
);

/**
 * 教学班学生名单：教学班与学生的多对多关联，记录加入来源。
 * 名单是组建时的快照：学籍状态随后变化不会自动同步进已存在的行。
 */
export const teachingClassStudentSource = pgEnum(
  "teaching_class_student_source",
  ["whole_class", "manual"],
);

export type TeachingClassStudentSource =
  (typeof teachingClassStudentSource.enumValues)[number];

export const teachingClassStudents = pgTable(
  "teaching_class_students",
  {
    teachingClassId: uuid("teaching_class_id")
      .notNull()
      .references(() => teachingClasses.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    source: teachingClassStudentSource("source").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teachingClassId, table.studentId] }),
    index("teaching_class_students_student_id_idx").on(table.studentId),
  ],
);

/**
 * 单双周标记：每周 / 单周 / 双周。
 * 术语见 GLOSSARY.md：课表由星期、节次、周次范围与单双周构成。
 */
export const weekParity = pgEnum("week_parity", ["every", "odd", "even"]);

export type WeekParity = (typeof weekParity.enumValues)[number];

/**
 * 课表条目：一节连续的上课安排。教室名是自由文本，不建教室实体。
 * 星期用 1（周一）到 7（周日），节次与周次都用闭区间。
 *
 * 冲突不落库：它由当前所有条目实时算出，因此删掉一条后相关警告自然消失。
 * 只有「教师已确认冲突」的痕迹留在条目上，作为这次排课的记录。
 */
export const timetableEntries = pgTable(
  "timetable_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teachingClassId: uuid("teaching_class_id")
      .notNull()
      .references(() => teachingClasses.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startPeriod: integer("start_period").notNull(),
    endPeriod: integer("end_period").notNull(),
    startWeek: integer("start_week").notNull(),
    endWeek: integer("end_week").notNull(),
    weekParity: weekParity("week_parity").notNull(),
    classroom: text("classroom").notNull(),
    conflictAcknowledgedAt: timestamp("conflict_acknowledged_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("timetable_entries_teaching_class_id_idx").on(table.teachingClassId),
    index("timetable_entries_weekday_idx").on(table.weekday),
    check(
      "timetable_entries_weekday_range",
      sql`${table.weekday} between 1 and 7`,
    ),
    check(
      "timetable_entries_period_range",
      sql`${table.startPeriod} >= 1 and ${table.endPeriod} >= ${table.startPeriod} and ${table.endPeriod} <= 20`,
    ),
    check(
      "timetable_entries_week_range",
      sql`${table.startWeek} >= 1 and ${table.endWeek} >= ${table.startWeek} and ${table.endWeek} <= 30`,
    ),
    check(
      "timetable_entries_classroom_not_blank",
      sql`length(btrim(${table.classroom})) > 0`,
    ),
  ],
);

/**
 * 成绩项：教学班内针对全体学生的一次计分，带满分与权重（百分比）。
 * 同一教学班内名称唯一；权重合计不强制为 100，由界面提示。
 */
export const gradeItems = pgTable(
  "grade_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teachingClassId: uuid("teaching_class_id")
      .notNull()
      .references(() => teachingClasses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull(),
    weight: numeric("weight", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("grade_items_teaching_class_id_name_unique").on(
      table.teachingClassId,
      table.name,
    ),
    index("grade_items_teaching_class_id_idx").on(table.teachingClassId),
    check("grade_items_max_score_positive", sql`${table.maxScore} > 0`),
    check(
      "grade_items_weight_range",
      sql`${table.weight} > 0 and ${table.weight} <= 100`,
    ),
  ],
);

/**
 * 成绩：成绩项 × 学生 × 得分。得分留空表示缺考/未录入，
 * 因此空白不写行，而不是写入 0 分。
 */
export const studentGrades = pgTable(
  "student_grades",
  {
    gradeItemId: uuid("grade_item_id")
      .notNull()
      .references(() => gradeItems.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    score: numeric("score", { precision: 6, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.gradeItemId, table.studentId] }),
    index("student_grades_student_id_idx").on(table.studentId),
    check("student_grades_score_non_negative", sql`${table.score} >= 0`),
  ],
);

/**
 * 总评：教学班 × 学生。系统计算值与教师覆盖值分开存放；
 * 有覆盖值时以覆盖值为准，取消覆盖后自然回落到计算值。
 */
export const gradeOveralls = pgTable(
  "grade_overalls",
  {
    teachingClassId: uuid("teaching_class_id")
      .notNull()
      .references(() => teachingClasses.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    computedScore: numeric("computed_score", { precision: 8, scale: 2 }),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    overrideScore: numeric("override_score", { precision: 8, scale: 2 }),
    overrideUpdatedAt: timestamp("override_updated_at", {
      withTimezone: true,
    }),
    overrideUpdatedBy: uuid("override_updated_by").references(
      () => accounts.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    primaryKey({ columns: [table.teachingClassId, table.studentId] }),
    index("grade_overalls_student_id_idx").on(table.studentId),
    check(
      "grade_overalls_scores_non_negative",
      sql`(${table.computedScore} is null or ${table.computedScore} >= 0)
        and (${table.overrideScore} is null or ${table.overrideScore} >= 0)`,
    ),
  ],
);

/**
 * 成绩变更日志：谁、何时、对哪个教学班的哪个学生做了什么。
 * 目标既可以是某个成绩项的得分，也可以是总评覆盖。
 */
export const gradeChangeTarget = pgEnum("grade_change_target", [
  "grade_item",
  "overall",
]);

export type GradeChangeTarget = (typeof gradeChangeTarget.enumValues)[number];

/**
 * record / update 覆盖成绩项录入与修改；override_overall / cancel_override
 * 覆盖总评的人工覆盖与取消；publish / unlock 为发布与解锁预留（工单 #11）。
 */
export const gradeChangeAction = pgEnum("grade_change_action", [
  "record",
  "update",
  "override_overall",
  "cancel_override",
  "publish",
  "unlock",
]);

export type GradeChangeAction = (typeof gradeChangeAction.enumValues)[number];

export const gradeChangeLogs = pgTable(
  "grade_change_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teachingClassId: uuid("teaching_class_id")
      .notNull()
      .references(() => teachingClasses.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    gradeItemId: uuid("grade_item_id").references(() => gradeItems.id, {
      onDelete: "set null",
    }),
    target: gradeChangeTarget("target").notNull(),
    action: gradeChangeAction("action").notNull(),
    actorAccountId: uuid("actor_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    oldValue: numeric("old_value", { precision: 8, scale: 2 }),
    newValue: numeric("new_value", { precision: 8, scale: 2 }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("grade_change_logs_teaching_class_id_idx").on(
      table.teachingClassId,
      table.createdAt,
    ),
    index("grade_change_logs_student_id_idx").on(table.studentId),
    index("grade_change_logs_actor_account_id_idx").on(table.actorAccountId),
    check(
      "grade_change_logs_target_item",
      sql`${table.target} = 'grade_item' or ${table.gradeItemId} is null`,
    ),
  ],
);