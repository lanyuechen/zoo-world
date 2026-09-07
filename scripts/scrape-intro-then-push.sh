#!/bin/bash
# 先确保分类树叶索引，再四路 enrich:fauna；完成后发布 species Release（不 commit 小文件）
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=data/fauna/logs/scrape-then-push.log
mkdir -p data/fauna/logs
exec >>"$LOG" 2>&1

cleanup_caffeinate() {
  if pgrep -x caffeinate >/dev/null 2>&1; then
    killall caffeinate 2>/dev/null || true
    echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] stopped caffeinate"
  else
    echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] no caffeinate process"
  fi
}
trap cleanup_caffeinate EXIT

INDEX=data/fauna/tax-tree-leaves.json
if [[ ! -s "$INDEX" ]]; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] building tax tree index"
  npm run enrich:fauna:tree
fi
if [[ ! -s "$INDEX" ]]; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] missing $INDEX after tree crawl"
  exit 1
fi

echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] start 4 shards (tree index)"

pids=""
for i in 0 1 2 3; do
  npm run enrich:fauna -- --resume --retry-missed --shard=${i}/4 --concurrency=2 \
    >"data/fauna/logs/scrape-shard-${i}-of-4.log" 2>&1 &
  pid=$!
  pids="$pids $pid"
  echo "shard $i pid $pid"
done

ec=0
for pid in $pids; do
  if ! wait "$pid"; then
    ec=1
    echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] shard pid $pid exited non-zero"
  fi
done
echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] all shards finished (ec=$ec)"

n=$(find public/species -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo "species json count: $n"

if [[ "$n" -lt 1 ]]; then
  echo "no species json to publish"
  echo DONE_NO_CHANGES
  exit "$ec"
fi

if npm run species:publish; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] species release published"
  # 触发 Pages 重新拉取数据包（无代码变更时可用 workflow_dispatch）
  if command -v gh >/dev/null 2>&1; then
    gh workflow run deploy-pages.yml || true
  fi
  echo DONE_OK
else
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] species:publish FAILED"
  echo DONE_FAIL
  exit 1
fi
