#!/bin/sh
# 单次数据库备份：pg_dump（自定义格式）→ 按日期命名 → 复制到异地目录 → 清理过期备份。
#
# 连接方式（二者取其一）：
#   - DATABASE_URL=postgres://用户:密码@主机:端口/库名
#   - 标准 libpq 变量 PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
#
# 可配置项：
#   BACKUP_DIR              主备份目录，默认 /backups
#   BACKUP_OFFSITE_DIR      异地/对象存储挂载目录；留空则只保留本机副本并告警
#   BACKUP_RETENTION_DAYS   保留天数，默认 30
#   BACKUP_PREFIX           文件名前缀，默认 student
#
# 退出码：0 成功；1 备份失败；2 配置错误。
set -eu

umask 077

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_OFFSITE_DIR=${BACKUP_OFFSITE_DIR:-}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
BACKUP_PREFIX=${BACKUP_PREFIX:-student}
SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)

STATUS_FILE="$BACKUP_DIR/.last-backup"
TMP_FILE=
FINAL_FILE=
NAME=

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

write_status() {
  state=$1
  detail=$2
  printf '%s %s %s\n' "$state" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$detail" >"$STATUS_FILE.tmp"
  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

cleanup() {
  if [ -n "$TMP_FILE" ] && [ -f "$TMP_FILE" ]; then
    rm -f -- "$TMP_FILE"
  fi
}

fail() {
  log "备份失败：$*"
  write_status failed "$*" || true
  log "请检查数据库连通性、凭据与磁盘空间；本次退出码为 1。"
  exit 1
}

trap cleanup EXIT
trap 'fail "收到终止信号"' INT TERM

case "$BACKUP_RETENTION_DAYS" in
  '' | *[!0-9]*)
    log "配置错误：BACKUP_RETENTION_DAYS 必须是正整数，当前为「$BACKUP_RETENTION_DAYS」。"
    exit 2
    ;;
esac

if [ "$BACKUP_RETENTION_DAYS" -lt 1 ]; then
  log "配置错误：BACKUP_RETENTION_DAYS 至少为 1，当前为「$BACKUP_RETENTION_DAYS」。"
  exit 2
fi

mkdir -p -- "$BACKUP_DIR" || exit 2

NAME="${BACKUP_PREFIX}-$(date -u +%Y-%m-%d).dump"
FINAL_FILE="$BACKUP_DIR/$NAME"
TMP_FILE="$BACKUP_DIR/.$NAME.tmp.$$"

log "开始备份数据库到 $FINAL_FILE"

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --format=custom --no-owner --no-privileges --file="$TMP_FILE" --dbname="$DATABASE_URL" ||
    fail "pg_dump 执行失败（连接串来自 DATABASE_URL）"
else
  pg_dump --format=custom --no-owner --no-privileges --file="$TMP_FILE" ||
    fail "pg_dump 执行失败（连接参数来自 PGHOST/PGUSER/PGDATABASE 等环境变量）"
fi

[ -s "$TMP_FILE" ] || fail "pg_dump 未生成任何内容"

mv -- "$TMP_FILE" "$FINAL_FILE"
TMP_FILE=
log "备份文件已生成：$FINAL_FILE（$(wc -c <"$FINAL_FILE" | tr -d ' ') 字节）"

if [ -n "$BACKUP_OFFSITE_DIR" ]; then
  mkdir -p -- "$BACKUP_OFFSITE_DIR" || fail "无法创建异地备份目录：$BACKUP_OFFSITE_DIR"
  cp -p -- "$FINAL_FILE" "$BACKUP_OFFSITE_DIR/$NAME" || fail "复制到异地目录失败：$BACKUP_OFFSITE_DIR"
  cmp -s -- "$FINAL_FILE" "$BACKUP_OFFSITE_DIR/$NAME" || fail "异地副本与源文件不一致：$BACKUP_OFFSITE_DIR/$NAME"
  log "异地副本已写入：$BACKUP_OFFSITE_DIR/$NAME"
else
  log "警告：未设置 BACKUP_OFFSITE_DIR，只有本机副本；生产环境必须配置异地或对象存储挂载点。"
fi

if ! sh "$SCRIPT_DIR/backup-prune.sh" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"; then
  log "警告：清理过期备份失败，请检查 $BACKUP_DIR 的权限。"
fi

if [ -n "$BACKUP_OFFSITE_DIR" ] && [ -d "$BACKUP_OFFSITE_DIR" ]; then
  if ! sh "$SCRIPT_DIR/backup-prune.sh" "$BACKUP_OFFSITE_DIR" "$BACKUP_RETENTION_DAYS"; then
    log "警告：清理异地过期备份失败，请检查 $BACKUP_OFFSITE_DIR 的权限。"
  fi
fi

write_status ok "$NAME"
log "备份完成：$NAME，保留 $BACKUP_RETENTION_DAYS 天。"
