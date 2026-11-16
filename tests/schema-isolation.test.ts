import { afterEach, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";
import { schemaExists } from "./support/db";

let app: TestApp | null = null;

afterEach(async () => {
  await app?.stop();
  app = null;
});

describe("测试 schema 隔离", () => {
  it("应用连接本文件独占的 schema，并在测试结束后清理", async () => {
    app = await startTestApp();
    const schema = app.schema;

    expect(schema).toMatch(/^test_[a-z0-9_]+$/);
    expect(schema).not.toBe("public");
    expect(await schemaExists(schema!)).toBe(true);

    const response = await fetch(`${app.baseUrl}/healthz`);
    const body = (await response.json()) as { schema: string };

    expect(response.status).toBe(200);
    expect(body.schema).toBe(schema);

    await app.stop();
    app = null;

    expect(await schemaExists(schema!)).toBe(false);
  });
});
