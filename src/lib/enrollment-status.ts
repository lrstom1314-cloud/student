/**
 * 学籍状态：在读 / 休学 / 转出 / 毕业。只有「在读」的学生可以登录。
 * 这里是唯一的事实来源，数据库枚举与界面标签都从它派生。
 */
export const ENROLLMENT_STATUSES = [
  "enrolled",
  "suspended",
  "transferred",
  "graduated",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** 学籍状态的界面名称。术语见 GLOSSARY.md。 */
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  enrolled: "在读",
  suspended: "休学",
  transferred: "转出",
  graduated: "毕业",
};
