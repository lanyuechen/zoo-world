#!/bin/bash
# 四路 enrich:fauna 跑完后自动 commit + push public/species，并结束 caffeinate
set -uo pipefail
cd /Users/zhenglipeng/Documents/localhost/zoo-world
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

echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] start 4 shards"

pids=""
for i in 0 1 2 3; do
  npm run enrich:fauna -- --resume --shard=${i}/4 --concurrency=2 \
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

n=$(find public/species -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
echo "md count: $n"

git add public/species
if git diff --cached --quiet; then
  echo "no public/species changes to commit"
  echo DONE_NO_CHANGES
  exit 0
fi

git commit -m "$(cat <<'EOF'
补充物种介绍 Markdown

由 enrich:fauna 四路分片续跑写入 public/species。
EOF
)"

if git push; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] push done"
  echo DONE_OK
else
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] push FAILED"
  echo DONE_PUSH_FAILED
  exit 1
fi
