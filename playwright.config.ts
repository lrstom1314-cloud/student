import { defineConfig, devices } from "@playwright/test";

/**
 * 唯一一条 UI 级测试：真实浏览器走完第一版验收剧本。
 *
 * - 用例自己启动 `next start`（随机端口）并创建独占 schema，跑完丢弃；
 * - 失败时保留 trace、整页截图与录像，便于定位是哪一步断了；
 * - 与 `npm test`（Vitest）互不相干：这里只收 tests/e2e 下的 *.spec.ts。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: { mode: "only-on-failure", fullPage: true },
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
