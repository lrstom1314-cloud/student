"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ImportRow = {
  line: number;
  studentNumber: string;
  name: string;
  status: "created" | "updated" | "error";
  message?: string;
  initialPassword?: string;
};

type ImportResult = {
  created: number;
  updated: number;
  failed: number;
  rows: ImportRow[];
};

const STATUS_LABELS: Record<ImportRow["status"], string> = {
  created: "新建",
  updated: "更新",
  error: "失败",
};

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** 生成可下载/可复制的导入结果 CSV（UTF-8 带 BOM，Excel 直接打开不乱码）。 */
export function importResultCsv(rows: ImportRow[]): string {
  const header = ["行号", "学号", "姓名", "结果", "原因", "初始密码"];
  const lines = [
    header.map(escapeCsv).join(","),
    ...rows.map((row) =>
      [
        String(row.line),
        row.studentNumber,
        row.name,
        STATUS_LABELS[row.status],
        row.message ?? "",
        row.initialPassword ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    ),
  ];
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

export function StudentImportForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/admin/students/import", {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        let message = "导入失败，请稍后再试。";
        try {
          const body = (await response.json()) as { error?: string };
          message = body.error ?? message;
        } catch {
          // 保留兜底文案。
        }
        setError(message);
        setPending(false);
        return;
      }

      setResult((await response.json()) as ImportResult);
      setPending(false);
      // 保留本组件的导入结果（含一次性密码），同时刷新服务端渲染的名单。
      router.refresh();
    } catch {
      setError("网络异常，请稍后再试。");
      setPending(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const blob = new Blob([importResultCsv(result.rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replaceAll(":", "")
      .replace("T", "-");
    link.href = url;
    link.download = `学生导入结果-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(importResultCsv(result.rows));
      setNotice("导入结果已复制到剪贴板。");
    } catch {
      setNotice("复制失败，请改用「下载导入结果」。");
    }
  }

  const hasPasswords = result?.rows.some((row) => row.initialPassword);

  return (
    <div>
      <form className="form form-inline" onSubmit={onSubmit}>
        <label className="form-field">
          <span>CSV 文件</span>
          <input name="file" type="file" accept=".csv,text/csv" required />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "导入中…" : "上传并导入"}
        </button>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <section aria-label="导入结果">
          <p className="notice">
            新建 {result.created} 人，更新 {result.updated} 人，失败{" "}
            {result.failed} 行。
          </p>
          {hasPasswords ? (
            <p className="form-error" role="alert">
              初始密码只显示这一次，请立即下载或复制结果并分发给学生；离开本页后无法再查看。
            </p>
          ) : null}
          <p className="actions">
            <button type="button" onClick={downloadResult} className="secondary">
              下载导入结果
            </button>
            <button type="button" onClick={copyResult} className="secondary">
              复制导入结果
            </button>
            {notice ? <span className="form-notice">{notice}</span> : null}
          </p>

          {result.rows.length === 0 ? (
            <p>文件里没有数据行。</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>行号</th>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>结果</th>
                  <th>原因</th>
                  <th>初始密码</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.line}-${row.studentNumber}`}>
                    <td>{row.line}</td>
                    <td>{row.studentNumber}</td>
                    <td>{row.name}</td>
                    <td>{STATUS_LABELS[row.status]}</td>
                    <td>{row.message ?? ""}</td>
                    <td>{row.initialPassword ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
}
