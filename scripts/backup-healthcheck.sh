#!/bin/sh
# 备份健康检查：供容器 healthcheck 使用，也可人工执行。
#
# 判定条件（全部满足才算健康）：
#   1. 主备份目录中存在 .last-backup 状态文件；
#   2. 状态为 ok（最近一次备份成功）；
#   3. 状态文件在 BACKUP_MAX_AGE_MINUTES 分钟内更新过（默认 2160 分钟 = 36 小时，
#      给「每日一次」留出一次错过的余量）；
#   4. 目录中至少有一个非空的 student-*.dump。
#
# 失败时退出码为 1，并输出可读原因；docker compose ps 会显示 unhealthy。
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_MAX_AGE_MINUTES=${BACKUP_MAX_AGE_MINUTES:-2160}
STATUS_FILE="$BACKUP_DIR/.last-backup"

log() {
  printf '[备份健康检查] %s\n' "$*" >&2
}

case "$BACKUP_MAX_AGE_MINUTES" in
  '' | *[!0-9]*)
    log "BACKUP_MAX_AGE_MINUTES 必须是正整数：$BACKUP_MAX_AGE_MINUTES"
    exit 1
    ;;
esac

if [ ! -f "$STATUS_FILE" ]; then
  log "尚无备份记录：$STATUS_FILE 不存在。请确认 backup 容器已启动并完成首次备份。"
  exit 1
fi

state=$(cut -d ' ' -f 1 "$STATUS_FILE")
if [ "$state" != "ok" ]; then
  log "最近一次备份失败：$(cat "$STATUS_FILE")"
  exit 1
fi

if [ -z "$(find "$STATUS_FILE" -mmin -"$BACKUP_MAX_AGE_MINUTES" -print)" ]; then
  log "最近一次备份成功状态已超过 $BACKUP_MAX_AGE_MINUTES 分钟未更新，备份可能未按时运行。"
  exit 1
fi

found=0
for file in "$BACKUP_DIR"/*.dump; do
  if [ -s "$file" ]; then
    found=1
    break
  fi
done

if [ "$found" -ne 1 ]; then
  log "备份目录 $BACKUP_DIR 中没有非空的 student-*.dump 文件。"
  exit 1
fi

log "最近一次备份成功且未过期：$(cat "$STATUS_FILE")"
exit 0
