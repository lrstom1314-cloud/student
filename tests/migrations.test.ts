import { describe, expect, it } from "vitest";

import {
  appliedMigrationCount,
  createSchema,
  dropSchema,
  newSchemaName,
  runMigrations,
  schemaExists,
} from "./support/db";

describe("版本化数据库迁移", () => {
  it("能从空 schema 迁移到最新，且重复执行不会重复应用", async () => {
    const schema = newSchemaName("migrate");

    await createSchema(schema);
    try {
      await runMigrations(schema);
      expect(await appliedMigrationCount(schema)).toBe(1);

      // 第二次执行必须是幂等的：不报错、不重复记账。
      await runMigrations(schema);
      expect(await appliedMigrationCount(schema)).toBe(1);
    } finally {
      await dropSchema(schema);
    }

    expect(await schemaExists(schema)).toBe(false);
  });
});
