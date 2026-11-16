/**
 * Playwright 全局准备：与 HTTP 测试共用同一套「先生产构建，再启动真实进程」的做法。
 * 迭代时可先 `npm run build`，再 `SKIP_BUILD=1 npm run test:e2e` 复用构建产物。
 */
import buildOnce from "../support/global-setup";

export default buildOnce;
