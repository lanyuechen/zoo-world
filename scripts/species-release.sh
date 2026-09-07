#!/usr/bin/env bash
# 物种详情 public/species 与 Git 解耦：打包 / 拉取 / 发布到 GitHub Release
#
#   npm run species:pack      # → dist-assets/species.tar.gz
#   npm run species:fetch     # 从 Release 解压到 public/species
#   npm run species:publish   # 打包并上传到 tag=species-data（需 gh 登录）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ASSET_NAME="species.tar.gz"
RELEASE_TAG="species-data"
OUT_DIR="$ROOT/dist-assets"
ARCHIVE="$OUT_DIR/$ASSET_NAME"
SPECIES_DIR="$ROOT/public/species"

resolve_repo() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    echo "$GITHUB_REPOSITORY"
    return
  fi
  local url
  url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "$url" =~ github.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    return
  fi
  echo "无法解析 GitHub 仓库（设置 GITHUB_REPOSITORY 或配置 origin）" >&2
  exit 1
}

cmd_pack() {
  if [[ ! -d "$SPECIES_DIR" ]]; then
    echo "缺少 $SPECIES_DIR" >&2
    exit 1
  fi
  local n
  n="$(find "$SPECIES_DIR" -type f -name '*.json' | wc -l | tr -d ' ')"
  if [[ "$n" -lt 1 ]]; then
    echo "public/species 下没有 JSON" >&2
    exit 1
  fi
  mkdir -p "$OUT_DIR"
  echo "打包 $n 个 JSON → $ARCHIVE"
  # 归档内路径为 species/...，解压到 public/
  tar -C "$ROOT/public" -czf "$ARCHIVE" species
  ls -lh "$ARCHIVE"
}

cmd_fetch() {
  local repo
  repo="$(resolve_repo)"
  mkdir -p "$OUT_DIR"
  local url="https://github.com/${repo}/releases/download/${RELEASE_TAG}/${ASSET_NAME}"
  echo "下载 $url"
  if command -v gh >/dev/null 2>&1; then
    gh release download "$RELEASE_TAG" -R "$repo" -p "$ASSET_NAME" -D "$OUT_DIR" --clobber
  else
    curl -fsSL -o "$ARCHIVE" -L "$url"
  fi
  if [[ ! -f "$ARCHIVE" ]]; then
    echo "下载失败：$ARCHIVE" >&2
    exit 1
  fi
  echo "解压到 public/species …"
  rm -rf "$SPECIES_DIR"
  mkdir -p "$ROOT/public"
  tar -C "$ROOT/public" -xzf "$ARCHIVE"
  local n
  n="$(find "$SPECIES_DIR" -type f -name '*.json' | wc -l | tr -d ' ')"
  echo "完成：public/species 共 $n 个 JSON"
}

cmd_publish() {
  local repo
  repo="$(resolve_repo)"
  cmd_pack

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh release view "$RELEASE_TAG" -R "$repo" >/dev/null 2>&1; then
      echo "更新 Release $RELEASE_TAG 资源…"
      gh release upload "$RELEASE_TAG" "$ARCHIVE" -R "$repo" --clobber
    else
      echo "创建 Release $RELEASE_TAG …"
      gh release create "$RELEASE_TAG" "$ARCHIVE" -R "$repo" \
        --title "Species detail JSON" \
        --notes "物种详情 public/species 压缩包（不入库）。本地：npm run species:fetch；Pages 构建时自动解压。"
    fi
  else
    # 回退：用 git credential / 环境变量调 GitHub API
    local user pass
    if [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
      user="${GITHUB_ACTOR:-token}"
      pass="${GH_TOKEN:-$GITHUB_TOKEN}"
    else
      local cred
      cred="$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null || true)"
      user="$(echo "$cred" | awk -F= '/^username=/{print $2}')"
      pass="$(echo "$cred" | awk -F= '/^password=/{print $2}')"
    fi
    if [[ -z "$pass" ]]; then
      echo "需要 gh auth login，或设置 GH_TOKEN，或配置 git 的 GitHub 凭据" >&2
      exit 1
    fi
    echo "经 API 发布 Release $RELEASE_TAG …"
    local resp upload id
    resp="$(curl -fsS -u "$user:$pass" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${repo}/releases/tags/${RELEASE_TAG}" 2>/dev/null || true)"
    id="$(echo "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);console.log(j.id||'')}catch{}}")"
    if [[ -z "$id" ]]; then
      resp="$(curl -fsS -u "$user:$pass" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${repo}/releases" \
        -d "{\"tag_name\":\"${RELEASE_TAG}\",\"name\":\"Species detail JSON\",\"body\":\"物种详情 public/species 压缩包。npm run species:fetch\"}")"
      id="$(echo "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(!j.id){console.error(s);process.exit(1)};console.log(j.id)}")"
    else
      # 删除旧同名 asset
      echo "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);for(const a of j.assets||[]){if(a.name==='${ASSET_NAME}') console.log(a.id)}})" | while read -r aid; do
        [[ -n "$aid" ]] || continue
        curl -fsS -u "$user:$pass" -X DELETE -H "Accept: application/vnd.github+json" \
          "https://api.github.com/repos/${repo}/releases/assets/${aid}" >/dev/null
      done
    fi
    curl -fsS -u "$user:$pass" \
      -H "Content-Type: application/gzip" \
      -H "Accept: application/vnd.github+json" \
      --data-binary @"$ARCHIVE" \
      "https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${ASSET_NAME}" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.state!=='uploaded'){console.error(s);process.exit(1)};console.log(j.browser_download_url)})"
  fi
  echo "已发布：https://github.com/${repo}/releases/tag/${RELEASE_TAG}"
}

case "${1:-}" in
  pack) cmd_pack ;;
  fetch) cmd_fetch ;;
  publish) cmd_publish ;;
  *)
    echo "用法: $0 pack|fetch|publish" >&2
    exit 1
    ;;
esac
