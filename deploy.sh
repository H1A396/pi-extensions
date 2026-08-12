#!/usr/bin/env bash
# 将 pi-extensions 下所有 pi-myqy-* 扩展复制到 pi 运行时扩展目录
# 目标结构：~/.pi/agent/extensions/<扩展名>/（保留子目录与 index.ts 入口）
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.pi/agent/extensions"

for dir in "$SRC"/pi-myqy-*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"

  # 跳过无 .ts 入口文件的目录
  ts_entry=""
  for f in "$dir"/index.ts "$dir"/*.ts; do
    [ -f "$f" ] || continue
    ts_entry="$f"
    break
  done
  if [ -z "$ts_entry" ]; then
    echo "skip: $name (无 .ts 入口文件)"
    continue
  fi

  # 清空旧副本，同步整个目录（index.ts / *.ts / 子目录 / 非敏感资源）
  rm -rf "$DEST/$name"
  mkdir -p "$DEST/$name"
  cp -r "$dir"/. "$DEST/$name/"
  # 清理示例配置/README/docs 等运行时不需要的文件
  rm -f "$DEST/$name/example-config.json" "$DEST/$name/README.md"
  rm -rf "$DEST/$name/docs"
  echo "deployed: $name → $DEST/$name/"
done