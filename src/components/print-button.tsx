"use client";

/** 打印按钮只在屏幕上出现；打印样式会把包含它的 no-print 区域整体隐藏。 */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      打印成绩单
    </button>
  );
}
