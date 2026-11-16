import type { EnrollmentStatus } from "@/db/schema";

/** 学籍状态的界面名称。术语见 GLOSSARY.md。 */
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  enrolled: "在读",
  suspended: "休学",
  transferred: "转出",
  graduated: "毕业",
};
