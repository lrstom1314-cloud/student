import type { AccountRole } from "@/db/schema";

export const ROLE_LABELS: Record<AccountRole, string> = {
  student: "学生",
  teacher: "教师",
  administrator: "教务管理员",
};
