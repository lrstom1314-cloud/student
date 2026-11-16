import { getDb } from "@/db";
import type { AccountRole } from "@/db/schema";

/** 对外暴露的账号信息，永远不包含密码哈希。 */
export type AccountSummary = {
  id: string;
  loginName: string;
  displayName: string;
  role: AccountRole;
  mustChangePassword: boolean;
  disabled: boolean;
};

type AccountRow = {
  id: string;
  login_name: string;
  display_name: string;
  role: AccountRole;
  must_change_password: boolean;
  disabled: boolean;
};

type AccountWithHashRow = AccountRow & { password_hash: string };

function toSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    loginName: row.login_name,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
    disabled: row.disabled,
  };
}

const SUMMARY_COLUMNS = `
  id, login_name, display_name, role, must_change_password, disabled
`;

export async function listAccounts(): Promise<AccountSummary[]> {
  const sql = getDb();
  const rows = await sql.unsafe<AccountRow[]>(
    `select ${SUMMARY_COLUMNS} from accounts order by login_name`,
  );
  return rows.map(toSummary);
}

/** 可任教的教师账号，供组建教学班时选择。 */
export async function listTeacherAccounts(): Promise<AccountSummary[]> {
  const sql = getDb();
  const rows = await sql<AccountRow[]>`
    select id, login_name, display_name, role, must_change_password, disabled
    from accounts
    where role = 'teacher' and disabled = false
    order by login_name
  `;
  return rows.map(toSummary);
}

export async function findAccountByLoginName(
  loginName: string,
): Promise<(AccountSummary & { passwordHash: string }) | null> {
  const sql = getDb();
  const rows = await sql<AccountWithHashRow[]>`
    select id, login_name, display_name, password_hash, role,
           must_change_password, disabled
    from accounts
    where login_name = ${loginName}
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), passwordHash: row.password_hash };
}

export async function createAccount(input: {
  loginName: string;
  displayName: string;
  role: AccountRole;
  passwordHash: string;
  mustChangePassword: boolean;
}): Promise<AccountSummary> {
  const sql = getDb();
  const rows = await sql<AccountRow[]>`
    insert into accounts (
      login_name, display_name, password_hash, role,
      must_change_password, disabled
    )
    values (
      ${input.loginName}, ${input.displayName}, ${input.passwordHash},
      ${input.role}, ${input.mustChangePassword}, false
    )
    returning id, login_name, display_name, role,
              must_change_password, disabled
  `;
  return toSummary(rows[0]!);
}

export async function setAccountPassword(input: {
  accountId: string;
  passwordHash: string;
  mustChangePassword: boolean;
}): Promise<AccountSummary | null> {
  const sql = getDb();
  const rows = await sql<AccountRow[]>`
    update accounts
    set password_hash = ${input.passwordHash},
        must_change_password = ${input.mustChangePassword},
        updated_at = now()
    where id = ${input.accountId}
    returning id, login_name, display_name, role,
              must_change_password, disabled
  `;
  const row = rows[0];
  return row ? toSummary(row) : null;
}

export async function setAccountDisabled(
  accountId: string,
  disabled: boolean,
): Promise<AccountSummary | null> {
  const sql = getDb();
  const rows = await sql<AccountRow[]>`
    update accounts
    set disabled = ${disabled}, updated_at = now()
    where id = ${accountId}
    returning id, login_name, display_name, role,
              must_change_password, disabled
  `;
  const row = rows[0];
  return row ? toSummary(row) : null;
}
