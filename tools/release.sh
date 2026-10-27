#!/usr/bin/env bash
# git-kit ship과 릴리스 워크플로가 쓰는 보조 명령.
#   notes <version>  CHANGELOG.md에서 그 버전 구획의 본문을 출력한다 (워크플로의 Release 노트)
#   watch [tag]      태그 푸시로 시작된 release 워크플로를 찾아 끝날 때까지 기다린다 (ship.watch)
#   verify [tag]     Release에 첨부된 확장 zip이 내려받아지는지 확인한다 (ship.verify)
set -euo pipefail
cd "$(dirname "$0")/.."

WORKFLOW=release.yml
# 태그를 푸시한 직후에는 실행이 아직 목록에 없을 수 있어 잠시 기다리며 찾는다.
FIND_TRIES=30
FIND_DELAY_S=3

current_tag() {
  git describe --tags --exact-match HEAD 2>/dev/null || { echo "release.sh: HEAD has no tag. Pass the tag." >&2; exit 2; }
}

case "${1:-}" in
  notes)
    version="${2:?usage: release.sh notes <version>}"
    out=$(mktemp)
    awk -v v="$version" '
      $0 ~ "^## \\[" v "\\]" { found = 1; next }
      found && /^## \[/ { exit }
      found && /^\[[^]]+\]: / { exit }
      found { print }
    ' CHANGELOG.md | sed -e '/./,$!d' > "$out"
    if [ ! -s "$out" ]; then
      echo "release.sh: CHANGELOG.md has no section for $version" >&2
      rm -f "$out"
      exit 1
    fi
    cat "$out"
    rm -f "$out"
    ;;
  watch)
    tag="${2:-$(current_tag)}"
    for _ in $(seq "$FIND_TRIES"); do
      run_id=$(gh run list --workflow "$WORKFLOW" --event push --limit 20 --json databaseId,headBranch \
        --jq ".[] | select(.headBranch == \"$tag\") | .databaseId" | head -1)
      [ -n "$run_id" ] && break
      sleep "$FIND_DELAY_S"
    done
    if [ -z "${run_id:-}" ]; then
      echo "release.sh: no $WORKFLOW run found for $tag" >&2
      exit 1
    fi
    gh run watch "$run_id" --exit-status
    ;;
  verify)
    tag="${2:-$(current_tag)}"
    repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
    url="https://github.com/$repo/releases/download/$tag/frame-mesh-extension-$tag.zip"
    curl -fsSIL -o /dev/null "$url"
    echo "ok  $url"
    ;;
  *)
    echo "usage: release.sh notes <version> | watch [tag] | verify [tag]" >&2
    exit 2
    ;;
esac
