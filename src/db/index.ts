import postgres, { type Sql } from "postgres";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

type DbCache = {
  defaultClient?: Sql;
  schemaClients?: Map<string, Sql>;
};

const globalForDb = globalThis as typeof globalThis & { __studentDb?: DbCache };
const cache: DbCache = (globalForDb.__studentDb ??= { schemaClients: new Map() });

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少环境变量 DATABASE_URL，应用无法连接数据库。");
  }
  return url;
}

function createClient(schema: string | undefined): Sql {
  if (schema !== undefined && !SCHEMA_NAME.test(schema)) {
    throw new Error("DATABASE_SCHEMA 不是合法的 schema 名称。");
  }

  return postgres(databaseUrl(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: false,
    connection:
      schema === undefined ? undefined : { search_path: `"${schema}"` },
  });
}

/**
 * 取得数据库连接。连接池按 schema 缓存：生产环境使用 public，
 * 测试脚手架通过 DATABASE_SCHEMA 为每个测试文件指定独立 schema。
 */
export function getDb(): Sql {
  const schema = process.env.DATABASE_SCHEMA || undefined;

  if (schema === undefined) {
    return (cache.defaultClient ??= createClient(undefined));
  }

  const clients = (cache.schemaClients ??= new Map());
  let client = clients.get(schema);
  if (!client) {
    client = createClient(schema);
    clients.set(schema, client);
  }
  return client;
}
