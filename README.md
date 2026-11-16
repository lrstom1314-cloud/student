# 学生系统

单机构教务系统。领域词汇以 [`GLOSSARY.md`](./GLOSSARY.md) 为准，架构决策见 [`docs/adr/`](./docs/adr/)。

当前处于骨架阶段：应用可启动、连接 PostgreSQL、执行版本化迁移，并提供健康检查与 HTTP 测试底座。账号、学籍、课程等能力由后续工单加入。

## 环境要求

- Node.js 22 及以上（开发与测试使用）
- Docker 与 Docker Compose（启动应用与数据库）

## 配置

所有配置与密钥都来自环境变量。仓库只提交 `.env.example`，真实 `.env` 被 `.gitignore` 忽略。

```sh
cp .env.example .env
```

至少填写 `POSTGRES_PASSWORD`（请使用足够长的随机值）。`DATABASE_URL` 用于在本机直接运行应用或测试，密码需与 `POSTGRES_PASSWORD` 一致。

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose 中 PostgreSQL 的账号与库名 |
| `POSTGRES_PORT` / `APP_PORT` | 映射到宿主机的端口 |
| `DATABASE_URL` | 应用与测试使用的 PostgreSQL 连接串 |
| `DATABASE_SCHEMA` | 可选。把连接固定到某个 schema；生产留空（`public`），测试脚手架会自动注入 |

## 用 Docker Compose 启动

```sh
docker compose up --build
```

应用容器启动时会先执行数据库迁移（幂等），再启动 Next.js。数据库数据保存在命名卷 `student-db-data` 中。

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

- `drizzle/0000_baseline.sql` 是空基线，只用于建立迁移记账；业务表从后续工单开始加入。
- 已应用的迁移记录在 `drizzle.__drizzle_migrations`，重复执行不会再次应用。
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
- 数据库不可用时会明确报错并提示先启动 PostgreSQL，而不是静默跳过。

## 生产构建

```sh
npm run build
npm start
```

`Dockerfile` 为多阶段构建：依赖安装、`next build`、仅生产依赖的运行镜像。运行镜像以非 root 用户启动，先迁移再监听 3000 端口。

## 目录结构

```
src/app/            页面与 route handler（App Router）
src/app/healthz/    健康检查
src/db/             PostgreSQL 连接与 Drizzle 表定义
drizzle/            版本化迁移与 journal
scripts/migrate.mjs 迁移执行器（应用与容器共用）
tests/              HTTP 测试与测试脚手架
```
