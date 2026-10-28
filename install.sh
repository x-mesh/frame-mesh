#!/bin/sh
# frame-mesh 명령 설치. GitHub Release의 CLI 묶음과 체크섬을 받아 확인한 뒤
# $FRAME_MESH_HOME/<버전>에 풀고 $BIN_DIR/frame-mesh 링크를 만든다.
#
#   curl -fsSL https://raw.githubusercontent.com/x-mesh/frame-mesh/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --version v0.2.0
#   curl -fsSL .../install.sh | sh -s -- --uninstall
#
# 환경 변수: FRAME_MESH_HOME(기본 ~/.local/share/frame-mesh), BIN_DIR(기본 ~/.local/bin),
# FRAME_MESH_DOWNLOAD_BASE(기본 GitHub Release 주소. 시험할 때 로컬 주소로 바꾼다. 이때는 --version이 필요하다).
set -eu

REPO=x-mesh/frame-mesh
HOME_DIR=${FRAME_MESH_HOME:-$HOME/.local/share/frame-mesh}
BIN_DIR=${BIN_DIR:-$HOME/.local/bin}
BASE=${FRAME_MESH_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}

say() { printf 'frame-mesh: %s\n' "$*"; }
fail() { printf 'frame-mesh: %s\n' "$*" >&2; exit 1; }

version=""
action=install
while [ "$#" -gt 0 ]; do
	case "$1" in
	--version) [ "$#" -ge 2 ] || fail "--version needs a value, for example --version v0.2.0"; version=$2; shift 2 ;;
	--uninstall) action=uninstall; shift ;;
	-h | --help) sed -n '2,10p' "$0" 2>/dev/null || true; exit 0 ;;
	*) fail "unknown option: $1" ;;
	esac
done

link="$BIN_DIR/frame-mesh"

if [ "$action" = uninstall ]; then
	# 링크가 아닌 파일은 사용자가 직접 둔 것일 수 있어 지우지 않는다.
	if [ -L "$link" ]; then rm "$link" && say "removed $link"; else say "no link at $link"; fi
	if [ -d "$HOME_DIR" ]; then rm -rf "$HOME_DIR" && say "removed $HOME_DIR"; fi
	exit 0
fi

command -v python3 >/dev/null 2>&1 || fail "python3 is required. Install Python 3 and run this again."
command -v curl >/dev/null 2>&1 || fail "curl is required."

if [ -z "$version" ]; then
	[ -z "${FRAME_MESH_DOWNLOAD_BASE:-}" ] || fail "FRAME_MESH_DOWNLOAD_BASE needs --version"
	# API 호출 횟수 제한을 피하려고, latest 주소가 넘겨주는 태그 주소에서 버전을 읽는다.
	latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || fail "cannot reach GitHub"
	version=${latest##*/}
	case "$version" in v*) ;; *) fail "cannot find the latest release ($latest)" ;; esac
fi
case "$version" in v*) ;; *) version="v$version" ;; esac

name="frame-mesh-cli-$version"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "downloading $name"
curl -fsSL -o "$tmp/$name.tar.gz" "$BASE/$version/$name.tar.gz" || fail "cannot download $BASE/$version/$name.tar.gz. A release before the CLI bundle has no such file."
curl -fsSL -o "$tmp/$name.tar.gz.sha256" "$BASE/$version/$name.tar.gz.sha256" || fail "cannot download the checksum file"

expected=$(cut -d ' ' -f 1 "$tmp/$name.tar.gz.sha256")
actual=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$tmp/$name.tar.gz")
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "checksum mismatch for $name.tar.gz"

tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
[ -x "$tmp/$name/bin/frame-mesh" ] || fail "the bundle has no bin/frame-mesh"

dest="$HOME_DIR/$version"
mkdir -p "$HOME_DIR"
rm -rf "$dest"
mv "$tmp/$name" "$dest"

mkdir -p "$BIN_DIR"
if [ -e "$link" ] && [ ! -L "$link" ]; then
	fail "$link exists and is not a link. Move it away and run this again."
fi
ln -sfn "$dest/bin/frame-mesh" "$link"
say "installed $("$link" version) at $dest"
say "linked $link"

case ":$PATH:" in
*":$BIN_DIR:"*) ;;
*) say "$BIN_DIR is not in PATH. Add this line to your shell profile: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say "a running frame-mesh dev server keeps the old version. Stop it and run frame-mesh dev again."
