# 实现者简报

每个实现工单的子代理开工前读这一份。目的是不让人重复发现同一件事、重复踩同一个坑。

## 环境事实

- **本机可能没有 Docker。** `docker compose up` 无法执行时，只能做 `docker compose config` 静态校验；容器内的构建与启动属于**未验证**，报告里要如实标注，不要写成已验证。
- **本机可能没有 `pg_dump` / `pg_restore`。** 涉及备份恢复的验收项同样只能标注未验证，并给出人工执行命令。
- **测试需要一个真实 PostgreSQL**，连接串通过 `DATABASE_URL` 传入。有 Docker 时用 `docker compose up -d db`；没有 Docker 时可以用 `embedded-postgres` 在临时目录起一个（仅本机便利，不入库）：

  ```sh
  mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm init -y >/dev/null && npm i embedded-postgres
  # 用一段 node 脚本 initialise() 后 start()，监听 55432，用户/密码 postgres，建库 student
  DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/student' npm test
  ```

- 测试缝只有一条：HTTP 边界。`tests/support/app.ts` 会为每个测试文件建独立 schema、跑迁移、用随机端口起 `next start`。**不要**给内部函数或 React 组件写单测。
- 构建一次后可用 `SKIP_BUILD=1` 复用 `.next`，加快迭代。

## 工作边界（每次都适用）

- 只在分配给你的工作树里改文件，**不要碰主工作区**。
- **不 push**，**不关闭或修改任何 issue**。
- 提交信息用中文。
- 完成前 `git merge integration/student-v1`（或本次指定的集成分支），确认无冲突且测试全绿。

## 加迁移时

- 并行工单会撞编号。撞了就**删掉自己那份迁移与快照**，重新 `npm run db:generate` 顺延，**绝不改别人的迁移**。
- `npm run check:migrations` 会把这类问题挡下来。
- 生成后确认文件名是语义化的中文拼音英文名（如 `0007_term_starts_on`），不是 drizzle 随机生成的名字。

## 写界面文案时

- 用 `GLOSSARY.md` 的词汇，不要用 `_Avoid_` 里的词。`npm run check:glossary` 会扫 `src/` 并拦截；测试目录不扫，因为测试需要写出作废词来断言其不存在。

## 完成标准

- 工单的**每一条**验收标准都要有可复现证据：测试或命令输出。
- 规格里没写死、需要产品决策的地方，**停下来写「阻塞：…」**，不要自行发明产品行为。
- 报告里必须包含：分支与提交数、测试命令与实际输出、每条验收标准的证据、偏离说明、遗留风险。
