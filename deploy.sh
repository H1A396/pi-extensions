#!/usr/bin/env bash
# 将 pi-extensions 下所有 pi-myqy-* 扩展复制到 pi 运行时扩展目录
# 目标结构：~/.pi/agent/extensions/<扩展名>/index.ts
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.pi/agent/extensions"

for dir in "$SRC"/pi-myqy-*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"

  # 取第一个 .ts 作为入口（规范：每个扩展一个入口文件）
  ts_file=""
  for f in "$dir"/*.ts; do
    [ -f "$f" ] || continue
    ts_file="$f"
    break
  done
  if [ -z "$ts_file" ]; then
    echo "skip: $name (无 .ts 入口文件)"
    continue
  fi

  mkdir -p "$DEST/$name"
  cp "$ts_file" "$DEST/$name/index.ts"
  echo "deployed: $name → $DEST/$name/index.ts"
done
