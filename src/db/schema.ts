import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
export const enrollmentStatus = pgEnum("enrollment_status", [
  "enrolled",
  "suspended",
  "transferred",
  "graduated",
]);

export type EnrollmentStatus = (typeof enrollmentStatus.enumValues)[number];

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
