import type { GradeChangeAction, GradeChangeTarget } from "@/db/schema";

export const GRADE_ACTION_LABELS: Record<GradeChangeAction, string> = {
  record: "录入",
  update: "修改",
  override_overall: "覆盖总评",
  cancel_override: "取消覆盖",
  publish: "发布",
  unlock: "解锁",
};

export const GRADE_TARGET_LABELS: Record<GradeChangeTarget, string> = {
  grade_item: "成绩项",
  overall: "总评",
  teaching_class: "教学班",
};

/** 变更日志的时间统一按北京时间展示，避免服务器时区影响阅读。 */
export function formatLogTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
