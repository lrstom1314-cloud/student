#!/bin/sh
# 备份保留策略：删除目录中超过保留天数的学生备份。
#
# 用法：sh scripts/backup-prune.sh <备份目录> <保留天数> [--dry-run]
#
# 只处理形如 student-YYYY-MM-DD.dump 的文件，不会碰目录中的其它内容。
# 按文件修改时间判断年龄：复制到异地时使用 `cp -p` 保留时间，因此两边结论一致。
set -eu

dir=${1:-}
days=${2:-}
mode=${3:-}

if [ -z "$dir" ] || [ -z "$days" ]; then
  echo "用法：$0 <备份目录> <保留天数> [--dry-run]" >&2
  exit 2
fi

case "$days" in
  '' | *[!0-9]*)
    echo "保留天数必须是正整数：$days" >&2
    exit 2
    ;;
esac

if [ "$days" -lt 1 ]; then
  echo "保留天数至少为 1：$days" >&2
  exit 2
fi

if [ ! -d "$dir" ]; then
  echo "备份目录不存在：$dir" >&2
  exit 1
fi

find "$dir" -maxdepth 1 -type f -name 'student-*.dump' -mtime +"$days" -print |
  while IFS= read -r file; do
    if [ "$mode" = "--dry-run" ]; then
      printf '将删除过期备份：%s\n' "$file"
    else
      printf '删除过期备份：%s\n' "$file"
      rm -f -- "$file"
    fi
  done
