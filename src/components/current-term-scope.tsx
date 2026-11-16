import { getCurrentTerm } from "@/lib/terms";

/**
 * 依赖学期范围的页面（学生课表、教师教学班）共用这一块提示：
 * 没有当前学期时给出可操作的中文提示，而不是让页面报错或显示空数据。
 */
export async function CurrentTermScope() {
  const currentTerm = await getCurrentTerm();

  if (!currentTerm) {
    return (
      <p className="notice" role="status">
        尚未设置当前学期，暂时无法确定课表与成绩的范围。请联系教务管理员在「学年与学期」中设置当前学期。
      </p>
    );
  }

  return <p className="notice">{`当前学期：${currentTerm.label}`}</p>;
}
