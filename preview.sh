#!/bin/zsh
# 在本地预览：加密后启动一个本地服务器，浏览器打开 http://localhost:8000
set -e
cd "$(dirname "$0")"
NODE=$(command -v node || echo /Users/linjiu/.botmux/bin/node)
"$NODE" build.mjs
(sleep 1 && open http://localhost:8000) &
echo "按 Ctrl+C 结束预览"
python3 -m http.server 8000
