#!/bin/sh
# 备份容器入口：立即执行一次备份（失败也继续），然后按 BACKUP_SCHEDULE
# 安装 cron 计划并前台运行 crond，让容器日志接收每次备份的输出。
#
# 备份失败的可发现信号：
#   - 每次运行的日志写入容器 stdout/stderr（docker compose logs backup）；
#   - .last-backup 状态文件变为 failed；
#   - 容器 healthcheck（scripts/backup-healthcheck.sh）转为 unhealthy。
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
BACKUP_SCHEDULE=${BACKUP_SCHEDULE:-0 3 * * *}
BACKUP_DIR=${BACKUP_DIR:-/backups}
CRONTAB_FILE=${CRONTAB_FILE:-/etc/crontabs/root}
CROND_BIN=${CROND_BIN:-crond}

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

mkdir -p -- "$BACKUP_DIR"

log "备份容器启动，计划「$BACKUP_SCHEDULE」（容器时区通常为 UTC）。"
if ! sh "$SCRIPT_DIR/backup.sh"; then
  log "警告：首次备份失败，容器继续运行等待下一次计划；healthcheck 会报告 unhealthy。"
fi

mkdir -p -- "$(dirname -- "$CRONTAB_FILE")"
printf '%s sh %s/backup.sh >> /proc/1/fd/1 2>&1\n' "$BACKUP_SCHEDULE" "$SCRIPT_DIR" >"$CRONTAB_FILE"
log "已安装 cron 计划：$BACKUP_SCHEDULE"

exec "$CROND_BIN" -f -l 2
