#!/usr/bin/env bash
# .demo-frames/<이름>/의 프레임을 docs/demo-<이름>.gif로 합친다. 같은 장면의 MP4는 .demo-frames/<이름>/demo.mp4에 둔다.
# 프레임마다 보여 줄 시간이 다르므로 ffmpeg concat 목록의 duration으로 길이를 맞춘다.
set -euo pipefail
name="${1:?사용법: build.sh <extension|workbench>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$root/.demo-frames/$name"
out="$root/docs"
# GIF_WIDTH를 주면 그 폭으로 줄이고, 없으면 녹화 크기 그대로 만든다.
scale="scale=${GIF_WIDTH:--1}:-2:flags=lanczos"
mkdir -p "$out"

surfaces=$(python3 - "$dir" <<'PY'
import json, sys, os
d = sys.argv[1]
data = json.load(open(os.path.join(d, 'frames.json')))
for k in data['surfaces']:
    with open(os.path.join(d, f'{k}.txt'), 'w') as f:
        for fr in data['frames']:
            f.write(f"file '{fr[k]}'\nduration {fr['ms'] / 1000:.3f}\n")
        f.write(f"file '{data['frames'][-1][k]}'\n")
print(' '.join(data['surfaces']))
PY
)

inputs=()
for s in $surfaces; do inputs+=(-f concat -safe 0 -i "$dir/$s.txt"); done
if [ "$(wc -w <<<"$surfaces")" -eq 2 ]; then
  # 사이드 패널은 페이지 오른쪽에 붙이고, 둘 사이에 브라우저 경계선처럼 2px 선을 둔다.
  stack='[1:v]pad=iw+2:ih:2:0:color=0xd4d4dc[p];[0:v][p]hstack=inputs=2'
else
  stack='[0:v]null'
fi

ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex \
  "$stack,fps=15,$scale,split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  "$out/demo-$name.gif"
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "$stack,fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "$dir/demo.mp4"

for f in "$out/demo-$name.gif" "$dir/demo.mp4"; do
  printf '%s  %s  %ss\n' "$(du -h "$f" | cut -f1)" "${f#$root/}" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)"
done
