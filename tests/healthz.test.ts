import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestApp, type TestApp } from "./support/app";

type HealthBody = {
  status: string;
  checks: { database: string };
  schema?: string | null;
  message?: string;
  latencyMs: number;
};

describe("GET /healthz", () => {
  describe("数据库连通时", () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await startTestApp();
    });

    afterAll(async () => {
      await app.stop();
    });

    it("返回 200，并报告数据库可用与当前 schema", async () => {
      const response = await fetch(`${app.baseUrl}/healthz`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toContain("no-store");

      const body = (await response.json()) as HealthBody;
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.schema).toBe(app.schema);
      expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("数据库不可用时", () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await startTestApp({
        databaseUrl: "postgres://nobody:nobody@127.0.0.1:1/student",
        schema: null,
        migrate: false,
      });
    });

    afterAll(async () => {
      await app.stop();
    });

    it("返回 503，报告数据库不可用且不泄露连接细节", async () => {
      const response = await fetch(`${app.baseUrl}/healthz`);

      expect(response.status).toBe(503);

      const body = (await response.json()) as HealthBody;
      expect(body.status).toBe("error");
      expect(body.checks.database).toBe("error");
      expect(body.message).toBe("数据库不可用");

      const raw = JSON.stringify(body);
      expect(raw).not.toContain("nobody");
      expect(raw).not.toContain("127.0.0.1");
    });
  });
});
