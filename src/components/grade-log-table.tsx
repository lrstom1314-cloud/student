import type { GradeChangeLogEntry } from "@/lib/grade-logs";
import {
  formatLogTime,
  GRADE_ACTION_LABELS,
  GRADE_TARGET_LABELS,
} from "@/lib/grade-log-labels";

function targetLabel(entry: GradeChangeLogEntry): string {
  if (entry.target === "grade_item") {
    return `成绩项 · ${entry.gradeItem?.name ?? "（已删除）"}`;
  }
  return GRADE_TARGET_LABELS[entry.target];
}

function valueLabel(value: number | null): string {
  return value === null ? "—" : String(value);
}

/**
 * 成绩变更日志表格：谁、何时、哪个学生、哪一项、旧值→新值、动作。
 * 发布与解锁是教学班动作，学生列显示「—」。
 */
export function GradeLogTable({ entries }: { entries: GradeChangeLogEntry[] }) {
  if (entries.length === 0) {
    return <p>暂无变更记录。</p>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>时间</th>
          <th>操作人</th>
          <th>学生</th>
          <th>教学班</th>
          <th>目标</th>
          <th>旧值</th>
          <th>新值</th>
          <th>动作</th>
          <th>理由</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} data-action={entry.action}>
            <td>{formatLogTime(entry.createdAt)}</td>
            <td>
              {entry.actor.displayName}
              <br />
              <span className="hint">{entry.actor.loginName}</span>
            </td>
            <td>
              {entry.student
                ? `${entry.student.studentNumber} ${entry.student.name}`
                : "—"}
            </td>
            <td>{entry.teachingClass.displayName}</td>
            <td>{targetLabel(entry)}</td>
            <td>{valueLabel(entry.oldValue)}</td>
            <td>{valueLabel(entry.newValue)}</td>
            <td>{GRADE_ACTION_LABELS[entry.action]}</td>
            <td>{entry.reason ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
