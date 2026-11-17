# 学生系统

单机构教务系统。领域词汇以 [`GLOSSARY.md`](./GLOSSARY.md) 为准，架构决策见 [`docs/adr/`](./docs/adr/)。

当前已具备账号与会话、行政班与学籍：三种角色共用一个登录入口，密码以 Argon2id 哈希存储，会话由服务端签发并保存在 PostgreSQL；学生与教师账号由教务管理员创建，首次登录必须改密。教务管理员在 `/admin/students` 维护行政班与学生的学籍状态；学籍状态不是「在读」的学生不能登录。课程、课表与成绩由后续工单加入。

## 环境要求

- Node.js 22 及以上（开发与测试使用）
- Docker 与 Docker Compose（启动应用与数据库）

## 配置

所有配置与密钥都来自环境变量。仓库只提交 `.env.example`，真实 `.env` 被 `.gitignore` 忽略。

```sh
cp .env.example .env
```

至少填写 `POSTGRES_PASSWORD`（请使用足够长的随机值：`openssl rand -base64 32 | tr -d '\n'`）。`DATABASE_URL` 用于在本机直接运行应用或测试，密码需与 `POSTGRES_PASSWORD` 一致。部署、备份与恢复的完整说明见 [`docs/operations.md`](./docs/operations.md)。

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose 中 PostgreSQL 的账号与库名 |
| `POSTGRES_PORT` / `APP_PORT` | 映射到宿主机的端口 |
| `DATABASE_URL` | 应用与测试使用的 PostgreSQL 连接串 |
| `DATABASE_SCHEMA` | 可选。把连接固定到某个 schema；生产留空（`public`），测试脚手架会自动注入 |
| `BACKUP_RETENTION_DAYS` / `BACKUP_SCHEDULE` | 每日备份的保留天数与 cron 计划（容器时区为 UTC） |
| `BACKUP_OFFSITE_HOST_DIR` | 异地/对象存储挂载点；生产必须指向真实异地路径，默认值只是同盘占位 |

会话不依赖签名密钥：登录令牌是随机值，数据库只存其 SHA-256 哈希，因此没有 `SESSION_SECRET` 之类的变量。

## 账号与会话

三个角色（学生 / 教师 / 教务管理员）共用 `/login` 一个入口，登录后分别进入
`/student`、`/teacher`、`/admin`。账号不能自助注册。

- 教务管理员在 `/admin` 创建账号、重置任意账号密码、启用或停用账号。
- 新建账号与重置后的账号都带「需强制改密」标记：登录后只能访问 `/change-password`，
  改密完成前其它页面会重定向到改密页，其它接口返回 403。
- 未登录访问受保护页面会跳到 `/login?next=原路径`，登录后回到原目标页。
- 角色不符由服务端返回 403；前端隐藏不作为授权手段。
- 空密码、错误密码、不存在的账号与已停用账号统一返回「登录名或密码错误。」，
  不区分原因；不存在的账号也会执行一次等价的 Argon2id 校验。

## 行政班与学籍

教务管理员在 `/admin/students` 维护行政班与学生学籍：

- 行政班名称直接含年级（如「高二 3 班」），可随时重命名，名单不变。
- 逐个新建学生：学号、姓名、当前行政班、学籍状态。学号全局唯一，重复录入返回
  「学号 … 已存在，请勿重复录入。」。
- 学籍状态为在读、休学、转出、毕业；可按行政班浏览名单并看到每人当前状态。
- 学生可转到另一个行政班，归属立即更新；系统只保存当前行政班，不记录转班历史。
- 只收集学号、姓名、行政班与学籍状态，不收集身份证号、手机号、生日、住址。

学生与账号 1:1，以学号为键：

- 新建学生时，若该学号还没有账号，则同时创建学生账号：登录名即学号、角色固定为学生、
  初始密码由教务管理员设置，并要求首次登录改密。
- 若该学号已有学生账号，则只建立关联，**不会改动其密码**；已有账号不是学生角色时拒绝关联。
- 登录时读取学生**当前**学籍状态：非「在读」一律拒绝，已登录的会话也会立即失效。
  拒绝提示与密码错误完全相同（「登录名或密码错误。」），不泄露具体学籍状态。

### 会话

- 会话令牌是 32 字节随机值，放在 `student_session` cookie 中：`HttpOnly`、
  `SameSite=Lax`、`Path=/`，生产环境（`NODE_ENV=production`）加 `Secure`。
- cookie 只放令牌，会话数据存在 `sessions` 表，数据库里只存令牌的 SHA-256 哈希。
- 会话为**绝对过期**：签发后 7 天失效，不随访问续期；过期后服务端直接拒绝。
- 登录、改密都会轮换会话；改密、重置密码、停用账号会吊销该账号的全部会话，
  退出登录会删除当前会话。
- 密码使用 Argon2id（19 MiB、2 次迭代、1 路并行），数据库与任何接口响应中
  都不会出现明文或哈希。密码长度要求 8–128 位，登录名最长 64 个字符。

### 创建第一个教务管理员

系统不提供公开的教务管理员注册入口。首次部署、迁移完成后，用脚本创建：

```sh
DATABASE_URL='postgres://...' npm run account:create -- \
  --login admin --name 教务甲 --role administrator \
  --password '换成足够长的密码' --no-force-change
```

容器中执行：

```sh
docker compose exec app node scripts/create-account.mjs \
  --login admin --name 教务甲 --password '...' --no-force-change
```

之后的学生、教师与其它管理员账号都在 `/admin` 界面创建，初始密码由教务管理员设置，
对方首次登录必须修改。脚本也用于本机排障，参数含义见 `scripts/create-account.mjs`。

## 用 Docker Compose 启动

```sh
cp .env.example .env
# 把 .env 中的 POSTGRES_PASSWORD 换成随机值，例如：
#   openssl rand -base64 32 | tr -d '\n'
docker compose up -d --build
```

应用容器启动时会先执行数据库迁移（幂等），再启动 Next.js。数据库数据保存在命名卷 `student-db-data` 中。

若数据库不可达，启动会在迁移前置检查处**立即失败并打印中文原因**，不会无限重试：
容器退出码为 1，应用不会半启动。修正 `DATABASE_URL` / `POSTGRES_PASSWORD` 或等数据库就绪后重启即可。

`backup` 服务在启动时立即备份一次，之后每天按 `BACKUP_SCHEDULE` 用 `pg_dump` 备份，
默认保留 30 天，并复制到 `BACKUP_OFFSITE_HOST_DIR`。备份文件在 `./backups/`，
失败会写进容器日志并让 `docker compose ps` 中的 backup 显示 unhealthy。
恢复步骤与验证点见 [`docs/operations.md`](./docs/operations.md)。
整份恢复演练已做成向导，在装有 Docker 的机器上跑一条命令即可：

```sh
bash scripts/wizard-restore-drill.sh
```

它会生成 `.env`、启动服务、引导造一份最小数据、立即备份、恢复到临时库并逐表比对行数，
最后提示你把结果填进 `docs/operations.md` 的演练记录表。

启动后访问：

- 应用：<http://localhost:3000>
- 健康检查：<http://localhost:3000/healthz>，数据库可用时返回 200

## 本机开发

```sh
docker compose up -d db        # 只启动数据库
npm ci
npm run db:migrate             # 从空库迁移到最新
npm run dev
```

## 数据库迁移

迁移是版本化的 SQL 文件，位于 `drizzle/`，由 [drizzle-kit](https://orm.drizzle.team/docs/kit-overview) 生成；应用与测试通过 `drizzle-orm` 的 migrator 执行。

```sh
npm run db:generate -- --name=添加学生表   # 根据 src/db/schema.ts 生成下一版迁移
npm run db:migrate                         # 应用到 DATABASE_URL 指向的数据库
```

- `drizzle/0000_baseline.sql` 是空基线，只用于建立迁移记账。
- `drizzle/0001_accounts_and_sessions.sql` 建立账号与会话表，是第一个业务迁移。
- `drizzle/0002_academic_years_and_terms.sql` 建立学年与学期表。
- `drizzle/0003_administrative_classes_and_students.sql` 建立行政班与学生学籍表。
- 已应用的迁移记录在 `drizzle.__drizzle_migrations`，重复执行不会再次应用。
- 生成迁移后，`npm run db:generate` 会自动去掉 drizzle-kit 写入的 `"public".` 限定，
  让同一份迁移能在测试的独立 schema 中执行；不要手工改回。
- 容器启动时会自动执行迁移，因此部署新版本不需要单独的迁移步骤。
- `.gitignore` 会拦截 `*.sql`，但显式放行 `drizzle/**/*.sql`，迁移文件必须入库。

## 测试

测试只有一条缝：**HTTP 请求边界**。测试从外部向真实运行的应用发请求，连接真实 PostgreSQL，不直接测试内部函数或 React 组件。

```sh
docker compose up -d db
npm test
```

`npm test` 会先做一次生产构建（`next build`），然后：

1. 每个测试文件启动自己的 `next start` 进程，使用随机空闲端口；
2. 每个测试文件创建独立 schema（如 `test_m9x2_ab12cd34`），在其中执行迁移，并通过 `DATABASE_SCHEMA` 让应用连接该 schema；
3. 测试结束后杀掉应用进程并 `DROP SCHEMA ... CASCADE`，互不干扰，可并行运行。

迭代时可先手动构建再复用：

```sh
npm run build
SKIP_BUILD=1 npm test
```

- `DATABASE_URL` 必须指向可用的 PostgreSQL，账号需要 `CREATE SCHEMA` 权限（Compose 中的应用账号满足）。
- 测试数据只使用虚构学生（如「张三」「李四」）与虚构班级，禁止真实姓名、学号或成绩。
- `tests/auth.test.ts` 覆盖账号创建、Argon2id 存储、统一登录失败提示、会话 cookie
  属性与过期、强制改密、教务管理员重置、停用账号和三角色权限边界。
- 数据库不可用时会明确报错并提示先启动 PostgreSQL，而不是静默跳过。

### 验收剧本（Playwright）

第一版验收剧本是一条真实浏览器的端到端用例，覆盖「教务管理员导入 2 个行政班共 20 名学生
→ 建课程与教学班 → 排含单双周变化的课表 → 教师录入 3 个成绩项并发布
→ 学生登录只看到自己的课表与总评 → 教务管理员在变更日志里看到本次发布」。
它只跑 happy path，测试数据全部虚构（见 `tests/e2e/fixtures/students.csv`）。

```sh
npx playwright install chromium   # 首次运行
DATABASE_URL='postgres://...' npm run test:e2e
```

- 用例自己启动 `next start`（随机端口）并创建独占 schema（`e2e_...`），跑完 `DROP SCHEMA`；
  与 `npm test` 的 schema、端口互不干扰。
- `npm test` 不会连带运行 e2e：Vitest 只收集 `tests/**/*.test.ts`。
- 失败时 `test-results/` 保留整页截图、录像与 trace，`playwright-report/` 生成 HTML 报告；
  `npx playwright show-trace <trace.zip>` 可回放失败步骤。
- 迭代时可先 `npm run build`，再 `SKIP_BUILD=1 npm run test:e2e` 复用构建产物。
- CI 使用 `.github/workflows/e2e.yml`：GitHub Actions 起 PostgreSQL 服务，执行同一条命令。

运维脚本另有一条不依赖数据库与 Docker 的测试（Node 内置 test runner）：

```sh
npm run test:ops
```

覆盖备份的命名与 `pg_dump` 调用、失败时非零退出且不留半成品、异地副本、30 天保留
（含 `--dry-run`）、健康检查对 failed/过期/缺失状态的判定，以及启动期数据库不可达的快速失败。
`npm test` 会先跑 HTTP 测试，再跑这组运维测试。

## 生产构建

```sh
npm run build
npm start
```

`Dockerfile` 为多阶段构建：依赖安装、`next build`、仅生产依赖的运行镜像。运行镜像以非 root 用户启动，先迁移再监听 3000 端口。

## 目录结构

```
src/app/            页面与 route handler（App Router）
src/app/api/        登录、退出、改密与账号管理接口
src/app/admin/      教务管理员账号管理
src/app/change-password/ 修改密码（含首次强制改密）
src/db/             PostgreSQL 连接与 Drizzle 表定义
src/lib/            认证、会话、密码与账号逻辑
drizzle/            版本化迁移与 journal
scripts/migrate.mjs 迁移执行器（应用与容器共用，启动时先检查数据库连通性）
scripts/create-account.mjs 首个教务管理员开通脚本
scripts/backup.sh   单次备份：pg_dump → 按日期命名 → 异地副本 → 清理
scripts/backup-prune.sh 保留策略：删除超过保留天数的备份
scripts/backup-entrypoint.sh 备份容器入口：首次备份 + 安装 cron
scripts/backup-healthcheck.sh 备份健康检查（容器 healthcheck）
docs/operations.md  部署、环境变量、备份与恢复手册
tests/              HTTP 测试与测试脚手架
tests/ops/          备份脚本与启动失败的测试（Node 内置 test runner）
```
