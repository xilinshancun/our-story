#!/bin/zsh
# 加密 data.js 和 photos/，然后发布到 GitHub Pages
set -e
cd "$(dirname "$0")"
NODE=$(command -v node || echo /Users/linjiu/.botmux/bin/node)
"$NODE" build.mjs
git add -A
if git diff --cached --quiet; then
  echo "没有改动，不用发布"
  exit 0
fi
git commit -q -m "更新内容 $(date '+%Y-%m-%d %H:%M')"
git push -q
echo "已发布，1–2 分钟后刷新网页就能看到"
