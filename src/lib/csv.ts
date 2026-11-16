/**
 * 极简 CSV 解析：只依赖 RFC 4180 的核心规则，不引入第三方库。
 *
 * - 自动去掉文件开头的 UTF-8 BOM；
 * - 支持 CRLF、LF 与单独的 CR；
 * - 支持双引号包裹的字段，字段内可含逗号、换行与转义的双引号（""）；
 * - 返回每条记录在文件中的起始物理行号，方便逐行报错。
 */
export type CsvRecord = {
  /** 该记录第一条物理行的行号（1 起，表头是第 1 行）。 */
  line: number;
  cells: string[];
};

export function parseCsv(text: string): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  const pushRecord = () => {
    cells.push(field);
    records.push({ line: recordLine, cells });
    cells = [];
    field = "";
  };

  while (index < source.length) {
    const char = source[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && source[index + 1] === "\n") {
          index += 2;
        } else {
          index += 1;
        }
        line += 1;
        field += "\n";
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      cells.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      pushRecord();
      if (char === "\r" && source[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      line += 1;
      recordLine = line;
      continue;
    }

    field += char;
    index += 1;
  }

  // 文件末尾没有换行时，最后一条记录仍在缓冲里。
  if (field.length > 0 || cells.length > 0) {
    pushRecord();
  }

  return records;
}
