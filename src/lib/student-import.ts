import { getDb } from "@/db";

import { listAdministrativeClasses } from "./administrative-classes";
import { parseCsv } from "./csv";
import {
  ENROLLMENT_STATUS_LABELS,
  type EnrollmentStatus,
} from "./enrollment-status";
import { isUniqueViolation } from "./http";
import {
  displayNameProblem,
  generateInitialPassword,
  hashPassword,
} from "./password";
import {
  createStudent,
  isEnrollmentStatus,
  studentNumberProblem,
  updateStudent,
} from "./students";

/** 表头必须包含的列（「行政班名称」是「行政班」的等价写法）。 */
export const IMPORT_COLUMNS = ["学号", "姓名", "行政班", "学籍状态"] as const;

export const IMPORT_COLUMNS_HINT =
  "CSV 第一行必须是表头，且至少包含：学号、姓名、行政班、学籍状态。";

type ImportColumns = {
  studentNumber: number;
  name: number;
  className: number;
  enrollmentStatus: number;
};

export type ImportRowResult = {
  /** 该行在 CSV 文件中的物理行号（表头是第 1 行）。 */
  line: number;
  studentNumber: string;
  name: string;
  status: "created" | "updated" | "error";
  /** 失败原因；成功时不出现。 */
  message?: string;
  /** 仅新建账号时返回一次；已存在的学生绝不返回、绝不改密。 */
  initialPassword?: string;
};

export type ImportResult = {
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
};

export type CsvImportResult =
  | { ok: true; result: ImportResult }
  | { ok: false; error: string };

const ALIASES: Record<keyof ImportColumns, readonly string[]> = {
  studentNumber: ["学号"],
  name: ["姓名"],
  className: ["行政班", "行政班名称"],
  enrollmentStatus: ["学籍状态"],
};

function resolveHeader(cells: string[]): {
  ok: true;
  columns: ImportColumns;
} | { ok: false; error: string } {
  const headers = cells.map((cell) => cell.trim());
  const indexes = {} as ImportColumns;
  const problems: string[] = [];

  for (const key of Object.keys(ALIASES) as Array<keyof ImportColumns>) {
    const hits = headers.flatMap((header, index) =>
      ALIASES[key].includes(header) ? [index] : [],
    );
    if (hits.length === 0) {
      problems.push(`缺少「${ALIASES[key][0]}」列`);
      continue;
    }
    if (hits.length > 1) {
      problems.push(`「${ALIASES[key][0]}」列出现了多次`);
      continue;
    }
    indexes[key] = hits[0]!;
  }

  if (problems.length > 0) {
    return {
      ok: false,
      error: `表头不匹配：${problems.join("；")}。${IMPORT_COLUMNS_HINT}`,
    };
  }
  return { ok: true, columns: indexes };
}

function parseEnrollmentStatus(value: string): EnrollmentStatus | null {
  const matched = (
    Object.entries(ENROLLMENT_STATUS_LABELS) as Array<[EnrollmentStatus, string]>
  ).find(([, label]) => label === value);
  if (matched) return matched[0];
  return isEnrollmentStatus(value) ? value : null;
}

function cell(record: { cells: string[] }, index: number): string {
  return (record.cells[index] ?? "").trim();
}

type ImportEntry = {
  line: number;
  studentNumber: string;
  name: string;
  className: string;
  enrollmentStatusText: string;
};

type ExistingStudent = { id: string; student_number: string };

/**
 * 按行导入学生：以学号为唯一键做 upsert，任何一行失败都不影响其它行。
 *
 * - 新建学生时生成一次性初始密码并随该行结果返回，账号首登强制改密；
 * - 已存在的学生只更新姓名 / 行政班 / 学籍状态，绝不触碰密码；
 * - 文件内重复学号的所有出现都判为错误，避免只写入其中一半；
 * - 行政班必须事先存在，本函数绝不创建行政班。
 */
export async function importStudentsCsv(text: string): Promise<CsvImportResult> {
  const records = parseCsv(text);
  if (records.length === 0) {
    return { ok: false, error: `文件为空。${IMPORT_COLUMNS_HINT}` };
  }

  const header = resolveHeader(records[0]!.cells);
  if (!header.ok) return header;

  const entries: ImportEntry[] = records
    .slice(1)
    .filter((record) => record.cells.some((value) => value.trim() !== ""))
    .map((record) => ({
      line: record.line,
      studentNumber: cell(record, header.columns.studentNumber),
      name: cell(record, header.columns.name),
      className: cell(record, header.columns.className),
      enrollmentStatusText: cell(record, header.columns.enrollmentStatus),
    }));

  if (entries.length === 0) {
    return { ok: true, result: { created: 0, updated: 0, failed: 0, rows: [] } };
  }

  // 同一文件内重复学号：所有出现都判错，确保不产生半截数据。
  const linesByNumber = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.studentNumber === "") continue;
    const lines = linesByNumber.get(entry.studentNumber) ?? [];
    lines.push(entry.line);
    linesByNumber.set(entry.studentNumber, lines);
  }
  const duplicateLines = new Map<string, number[]>();
  for (const [studentNumber, lines] of linesByNumber) {
    if (lines.length > 1) duplicateLines.set(studentNumber, lines);
  }

  const administrativeClasses = await listAdministrativeClasses();
  const classByName = new Map(
    administrativeClasses.map((administrativeClass) => [
      administrativeClass.name,
      administrativeClass,
    ]),
  );

  const numbers = [
    ...new Set(entries.map((entry) => entry.studentNumber).filter(Boolean)),
  ];
  const sql = getDb();
  const existingRows =
    numbers.length === 0
      ? []
      : await sql<ExistingStudent[]>`
          select id, student_number from students
          where student_number = any(${numbers}::text[])
        `;
  const existingByNumber = new Map(
    existingRows.map((row) => [row.student_number, row]),
  );

  const accountRows =
    numbers.length === 0
      ? []
      : await sql<{ login_name: string; role: string }[]>`
          select login_name, role from accounts
          where login_name = any(${numbers}::text[])
        `;
  const accountByLogin = new Map(
    accountRows.map((row) => [row.login_name, row]),
  );

  const rows: ImportRowResult[] = [];

  for (const entry of entries) {
    const errors: string[] = [];

    const duplicate = duplicateLines.get(entry.studentNumber);
    if (duplicate) {
      errors.push(
        `学号 ${entry.studentNumber} 在文件内重复出现（第 ${duplicate.join("、")} 行），请修正后重新上传。`,
      );
    } else {
      const numberProblem = studentNumberProblem(entry.studentNumber);
      if (numberProblem) errors.push(numberProblem);

      const nameProblem = displayNameProblem(entry.name);
      if (nameProblem) errors.push(nameProblem);

      if (entry.className === "") {
        errors.push("请填写行政班名称。");
      } else if (!classByName.has(entry.className)) {
        errors.push(
          `行政班「${entry.className}」不存在，请先在行政班列表中创建。`,
        );
      }

      const enrollmentStatus = parseEnrollmentStatus(
        entry.enrollmentStatusText,
      );
      if (!enrollmentStatus) {
        errors.push(
          `学籍状态「${entry.enrollmentStatusText || "（空）"}」无效，只能填写：在读、休学、转出、毕业。`,
        );
      }

      const account = accountByLogin.get(entry.studentNumber);
      if (account && account.role !== "student") {
        errors.push(
          `登录名 ${entry.studentNumber} 已被非学生账号占用，请先处理该账号。`,
        );
      }

      if (errors.length === 0) {
        const administrativeClass = classByName.get(entry.className)!;
        const existing = existingByNumber.get(entry.studentNumber);

        if (existing) {
          const updated = await updateStudent(existing.id, {
            name: entry.name,
            administrativeClassId: administrativeClass.id,
            enrollmentStatus: enrollmentStatus!,
          });
          if (!updated.ok) {
            errors.push(updated.error);
          } else {
            rows.push({
              line: entry.line,
              studentNumber: entry.studentNumber,
              name: entry.name,
              status: "updated",
            });
            continue;
          }
        } else {
          const isNewAccount = !account;
          const initialPassword = isNewAccount
            ? generateInitialPassword()
            : undefined;

          try {
            const created = await createStudent({
              studentNumber: entry.studentNumber,
              name: entry.name,
              administrativeClassId: administrativeClass.id,
              enrollmentStatus: enrollmentStatus!,
              initialPasswordHash: initialPassword
                ? await hashPassword(initialPassword)
                : undefined,
            });

            if (!created.ok) {
              errors.push(created.error);
            } else {
              rows.push({
                line: entry.line,
                studentNumber: entry.studentNumber,
                name: entry.name,
                status: "created",
                ...(initialPassword ? { initialPassword } : {}),
              });
              continue;
            }
          } catch (error) {
            if (isUniqueViolation(error)) {
              errors.push(
                `学号 ${entry.studentNumber} 已存在，请勿重复录入。`,
              );
            } else {
              console.error("导入学生时发生意外错误：", error);
              errors.push("该行处理失败，请稍后再试。");
            }
          }
        }
      }
    }

    rows.push({
      line: entry.line,
      studentNumber: entry.studentNumber,
      name: entry.name,
      status: "error",
      message: `第 ${entry.line} 行：${errors.join(" ")}`,
    });
  }

  return {
    ok: true,
    result: {
      created: rows.filter((row) => row.status === "created").length,
      updated: rows.filter((row) => row.status === "updated").length,
      failed: rows.filter((row) => row.status === "error").length,
      rows,
    },
  };
}
