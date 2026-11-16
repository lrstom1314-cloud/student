# 运维手册：部署、备份与恢复

这套系统由 Docker Compose 在一台服务器上运行两个长期服务（`app`、`db`）和一个备份服务（`backup`）。
成绩属于丢失后无法重建的数据，**备份与恢复演练是上线前的必做项**。

## 1. 从零启动

前置条件：已安装 Docker 与 Docker Compose。

```sh
# 1. 生成本地配置：复制模板并把 POSTGRES_PASSWORD 换成随机值
cp .env.example .env
password=$(openssl rand -base64 32 | tr -d '\n')
sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" .env
rm -f .env.bak

# 2. 启动数据库、应用与备份服务
docker compose up -d --build

# 3. 查看状态：三个服务都应为 running，app/backup 的 health 为 healthy
docker compose ps
```

启动后：

- 应用：<http://localhost:3000>
- 健康检查：<http://localhost:3000/healthz>，数据库可用时返回 200
- 首次部署还需要创建第一个教务管理员，见 [README 的「创建第一个教务管理员」](../README.md#创建第一个教务管理员)。

数据库数据保存在命名卷 `student-db-data` 中；备份文件保存在宿主机的 `./backups/` 目录。
首次启动前可先建好目录（Linux 上 Docker 以 root 创建时也可用 `sudo` 调整属主）：

```sh
mkdir -p backups backups/offsite
```

## 2. 环境变量清单

所有配置与密钥都来自环境变量，仓库只提交 `.env.example`。真实 `.env` 被 `.gitignore` 忽略。

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | **是** | 无 | 数据库密码。生成方式：`openssl rand -base64 32 \| tr -d '\n'`。不要使用示例值。 |
| `POSTGRES_USER` | 否 | `student` | 数据库账号。 |
| `POSTGRES_DB` | 否 | `student` | 数据库名。 |
| `POSTGRES_PORT` | 否 | `5432` | 数据库映射到宿主机的端口，仅本机排障需要。 |
| `APP_PORT` | 否 | `3000` | 应用映射到宿主机的端口。 |
| `DATABASE_URL` | 仅本机开发/测试 | 无 | 直接在宿主机运行应用或测试时使用；Compose 会给 `app` 自动注入。密码需与 `POSTGRES_PASSWORD` 一致。 |
| `DATABASE_SCHEMA` | 否 | 空（`public`） | 把连接固定到某个 schema；生产留空，测试脚手架会自动注入。 |
| `BACKUP_RETENTION_DAYS` | 否 | `30` | 备份保留天数，超过的会被删除。 |
| `BACKUP_SCHEDULE` | 否 | `0 3 * * *` | 备份 cron 表达式，**容器时区为 UTC**，默认每天 03:00 UTC（北京时间 11:00）。 |
| `BACKUP_OFFSITE_HOST_DIR` | 生产必需 | `./backups/offsite` | 异地/对象存储挂载点，挂载为备份容器的 `/offsite`。默认值与主备份同盘，只用于本机试跑；生产必须改成真实异地路径。 |

关于会话密钥：本系统的会话不依赖签名密钥。登录令牌是 32 字节随机值，只把 SHA-256
哈希存进 `sessions` 表；因此**没有** `SESSION_SECRET` 之类的变量需要配置或轮换。
会话数据随数据库一起备份。

> 修改 `POSTGRES_PASSWORD` 后，旧密码不会被自动改写到已存在的数据库卷中；已有部署请用
> `ALTER ROLE` 改数据库密码，并同步更新 `.env`。全新部署不存在这个问题。

## 3. 启动期数据库不可达

容器启动命令是 `node scripts/migrate.mjs && npm start`。迁移脚本会先做一次连通性检查：

- 连不上数据库时立即以退出码 1 结束，应用不会启动，日志中给出原因与修复方向；
- **不会自动重试、不会无限重启循环**（`restart: unless-stopped` 下容器会短暂重启，但每次都是立即失败，直到配置被修正）。

日志形如：

```
数据库连接失败：无法连接 postgres://student@db:5432/student（错误码：ECONNREFUSED）。
应用启动已中止：请确认 PostgreSQL 容器已启动、DATABASE_URL 的主机与端口可达、
且密码与 POSTGRES_PASSWORD 一致。修正后重启容器即可；本进程不会自动重试。
```

人工验证（不会破坏数据，因为连接目标是不可达端口）：

```sh
docker compose run --rm \
  -e DATABASE_URL='postgres://student:wrong@127.0.0.1:1/student' \
  app node scripts/migrate.mjs; echo "exit=$?"
```

预期：立即输出上面的中文错误，`exit=1`，且输出中不出现密码明文。

## 4. 每日备份

`backup` 服务在启动时立即执行一次备份，之后按 `BACKUP_SCHEDULE` 每天执行：

| 项目 | 约定 |
| --- | --- |
| 命令 | `pg_dump --format=custom`（POSIX sh 脚本 `scripts/backup.sh`） |
| 主备份 | `./backups/student-YYYY-MM-DD.dump`（UTC 日期；同一天重跑会覆盖当天文件） |
| 异地副本 | `/offsite/student-YYYY-MM-DD.dump`，对应宿主机 `BACKUP_OFFSITE_HOST_DIR` |
| 保留 | `BACKUP_RETENTION_DAYS` 天（默认 30），按文件修改时间清理 `student-*.dump` |
| 权限 | 以 `umask 077` 写入，仅容器运行用户可读 |
| 状态 | `./backups/.last-backup`，内容为 `ok|failed <UTC 时间> <文件名或原因>` |

手动触发一次：

```sh
docker compose exec backup sh /scripts/backup.sh
docker compose logs --tail=50 backup
ls -lh backups backups/offsite
```

### 备份失败如何被发现

备份失败不会被静默吞掉，至少有四个信号：

1. `scripts/backup.sh` 以非零退出码结束，日志中有 `备份失败：...`；
2. 容器日志（`docker compose logs backup`）保留完整 stderr，包括 `pg_dump` 的原始错误；
3. `.last-backup` 写成 `failed ...`；
4. 备份容器的 healthcheck（`scripts/backup-healthcheck.sh`）转为 **unhealthy**：
   最近一次状态不是 `ok`，或状态超过 36 小时未更新，或没有非空备份文件。
   `docker compose ps` 会直接显示。

建议在上线时把第 3/4 条接入现有监控：对 `docker compose ps` 的 health 状态、或
`docker compose logs backup` 中的 `备份失败` 关键字配置告警。仓库内不内置邮件/短信通道。

### 异地/对象存储留存

`BACKUP_OFFSITE_HOST_DIR` 指向独立于数据库磁盘的挂载点，例如：

```dotenv
# NFS
BACKUP_OFFSITE_HOST_DIR=/mnt/nas/student-backups
# 已通过 s3fs / rclone mount 挂载的对象存储
BACKUP_OFFSITE_HOST_DIR=/mnt/object-storage/student-backups
```

备份脚本会复制并用 `cmp` 校验副本一致；复制失败同样按备份失败处理。若该目录与主备份
在同一块磁盘上，磁盘损坏时两份会一起丢失，不满足异地留存要求。

## 5. 恢复步骤

> 恢复会覆盖现有数据。先执行一次手动备份，确认 `.last-backup` 为 `ok` 后再动手。
> 以下命令默认数据库账号与库名都是 `student`；若改过 `POSTGRES_USER` / `POSTGRES_DB`，请相应替换。

> **想少打字**：整份演练已做成向导 —— `bash scripts/wizard-restore-drill.sh`。
> 它会生成 `.env`、启动服务、引导你造一份最小数据、立即备份，并按 5.1 恢复到临时库、
> 比对行数、清理现场，最后提示你回填 5.4 的记录表。下面的命令是同一套流程的手工版，
> 适合排障时逐条执行。

### 5.1 演练：恢复到临时数据库（不影响线上）

```sh
# 1. 选一个备份文件
ls -lh backups/student-*.dump

# 2. 建一个临时空库
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d postgres \
  -c 'DROP DATABASE IF EXISTS student_restore_check;'
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d postgres \
  -c 'CREATE DATABASE student_restore_check;'

# 3. 把备份复制进容器并恢复
docker compose cp backups/student-YYYY-MM-DD.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U "${POSTGRES_USER:-student}" \
  -d student_restore_check --no-owner --no-privileges /tmp/restore.dump

# 4. 校验数据量与关键表
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d student_restore_check -c "
  select 'accounts' as 表, count(*) from accounts
  union all select 'students', count(*) from students
  union all select 'teaching_classes', count(*) from teaching_classes
  union all select 'grade_items', count(*) from grade_items
  union all select 'grade_overalls', count(*) from grade_overalls
  union all select 'grade_change_logs', count(*) from grade_change_logs;"

# 5. 清理临时库与临时文件
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d postgres \
  -c 'DROP DATABASE student_restore_check;'
docker compose exec -T db rm -f /tmp/restore.dump
```

演练的通过标准：`pg_restore` 退出码为 0；各表行数与备份时一致；`accounts` 与
`students` 中能看到已知的测试账号。

### 5.2 真实恢复：覆盖生产数据库

```sh
# 1. 停应用，避免恢复期间继续写入；先做一次当前数据的手动备份
docker compose stop app
docker compose exec backup sh /scripts/backup.sh

# 2. 删除并重建空库（会断开所有连接）
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d postgres \
  -c 'DROP DATABASE student WITH (FORCE);'
docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d postgres \
  -c 'CREATE DATABASE student OWNER student;'

# 3. 恢复（用第 1 步之外的、要回到的那个备份文件）
docker compose cp backups/student-YYYY-MM-DD.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U "${POSTGRES_USER:-student}" \
  -d student --no-owner --no-privileges /tmp/restore.dump
docker compose exec -T db rm -f /tmp/restore.dump

# 4. 启动应用（启动时会做幂等迁移）
docker compose start app

# 5. 健康检查
curl -fsS http://localhost:3000/healthz && echo
```

### 5.3 恢复后的验证点

按顺序逐项确认，任何一项失败都不能认为恢复完成：

1. **健康检查**：`/healthz` 返回 200，`checks.database` 为 `ok`。
2. **管理员能登录**：打开 `/login`，用备份时已存在的教务管理员账号登录；能进入 `/admin`，
   左侧能看到学年、学期、课程、教学班、学生。
3. **学生能登录并看到自己的数据**：用备份时已存在的学号登录（登录名为学号；
   若该账号仍带「需强制改密」标记，先完成改密），进入 `/student`，
   能看到自己的课表；「我的成绩」列出本学期已发布的总评，展开某门课能看到成绩项明细。
4. **成绩数据存在且对得上**：在页面上核对一名学生的总评，与 SQL 结果一致；再确认明细齐全：
   ```sh
   docker compose exec -T db psql -U "${POSTGRES_USER:-student}" -d student -c "
     select count(*) as 总评数 from grade_overalls;
     select count(*) as 成绩明细数 from student_grades;
     select count(*) as 变更日志数 from grade_change_logs;"
   ```
   行数与备份前一致，且抽查一名学生的 `grade_overalls` 有值。
5. **变更日志可追溯**：`grade_change_logs` 非空（若备份前有发布/改分操作），
   抽查 `action` 与 `old_value`/`new_value` 仍可读。

### 5.4 演练记录

| 日期 | 执行人 | 备份文件 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 待首次部署执行 | — | — | 尚未演练 | 开发环境无 Docker 与 `pg_dump`，无法在此完成；上线前必须按 5.1/5.2 演练并填写本表。 |

## 6. 备份产物不会进入仓库

`.gitignore` 已拦截 `backups/`、`*.dump`、`*.sql`、`*.sql.gz`、`*.dump.gz`、`.env*`。
可以自查：

```sh
git check-ignore -v backups/student-2026-11-17.dump
git status --short   # 不应出现任何 .dump / .env / backups 下的文件
```

## 7. 相关测试

备份脚本的控制流与保留策略不依赖 Docker，可在本机直接验证：

```sh
npm run test:ops
```

覆盖：按日期命名与 `pg_dump` 调用、失败时非零退出且不留半成品、异地副本、
30 天保留与 `--dry-run`、健康检查对 failed/过期/缺失状态的判定、启动期数据库
不可达的快速失败。
