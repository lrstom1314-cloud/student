import { getDb } from "@/db";

/** 对外暴露的行政班信息。 */
export type AdministrativeClassSummary = {
  id: string;
  name: string;
};

type AdministrativeClassRow = {
  id: string;
  name: string;
};

export function administrativeClassNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "请输入行政班名称。";
  }
  const name = value.trim();
  if (name.length > 64) {
    return "行政班名称不能超过 64 个字符。";
  }
  return null;
}

function toSummary(row: AdministrativeClassRow): AdministrativeClassSummary {
  return { id: row.id, name: row.name };
}

export async function listAdministrativeClasses(): Promise<
  AdministrativeClassSummary[]
> {
  const sql = getDb();
  const rows = await sql<AdministrativeClassRow[]>`
    select id, name from administrative_classes order by name
  `;
  return rows.map(toSummary);
}

export async function createAdministrativeClass(
  name: string,
): Promise<AdministrativeClassSummary> {
  const sql = getDb();
  const rows = await sql<AdministrativeClassRow[]>`
    insert into administrative_classes (name)
    values (${name})
    returning id, name
  `;
  return toSummary(rows[0]!);
}

export async function renameAdministrativeClass(
  id: string,
  name: string,
): Promise<AdministrativeClassSummary | null> {
  const sql = getDb();
  const rows = await sql<AdministrativeClassRow[]>`
    update administrative_classes
    set name = ${name}, updated_at = now()
    where id = ${id}
    returning id, name
  `;
  const row = rows[0];
  return row ? toSummary(row) : null;
}
