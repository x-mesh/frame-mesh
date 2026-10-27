#!/usr/bin/env python3
"""xm relay용 `claude` 대체 실행 파일: `agents --json` 목록에서 지정한 터미널(PID)의 항목만 남긴다.

xm은 같은 세션 ID의 항목이 둘 이상이면 전달을 거부하고 PID를 고르는 옵션이 없다. 그래서 chat.py가 send 호출에만
환경 변수 XM_RELAY_CLAUDE_BIN으로 이 파일을 끼운다. XM_RELAY_CLAUDE_BIN은 xm의 공개 문서에 없는 환경 변수라서,
xm이 세션을 고르는 방식이 바뀌면 이 우회가 깨질 수 있다.

환경 변수:
  FRAME_MESH_CLAUDE_BIN    실제 claude 실행 파일(필수)
  FRAME_MESH_ONLY_SESSION  걸러낼 세션 ID
  FRAME_MESH_ONLY_PID      남길 PID. 위 세션 ID이면서 다른 PID인 항목을 지운다.
`agents --json` 이외의 인자는 실제 claude로 그대로 넘긴다.
"""
import json
import os
import subprocess
import sys

AGENTS_TIMEOUT_S = 10
EXIT_MISCONFIGURED = 2


def main(argv):
    real = os.environ.get("FRAME_MESH_CLAUDE_BIN", "")
    # 이 파일이 자기 자신을 부르면 끝나지 않으므로 막는다.
    if not real or os.path.realpath(real) == os.path.realpath(__file__):
        print("fm_claude_agents: FRAME_MESH_CLAUDE_BIN must point to the real claude command", file=sys.stderr)
        return EXIT_MISCONFIGURED
    if argv != ["agents", "--json"]:
        os.execv(real, [real, *argv])

    only_session = os.environ.get("FRAME_MESH_ONLY_SESSION")
    try:
        only_pid = int(os.environ.get("FRAME_MESH_ONLY_PID", ""))
    except ValueError:
        print("fm_claude_agents: FRAME_MESH_ONLY_PID must be an integer", file=sys.stderr)
        return EXIT_MISCONFIGURED
    try:
        out = subprocess.run([real, *argv], capture_output=True, text=True, timeout=AGENTS_TIMEOUT_S)
    except (subprocess.SubprocessError, OSError) as err:
        print(f"fm_claude_agents: {err}", file=sys.stderr)
        return 1
    if out.returncode != 0:
        sys.stderr.write(out.stderr)
        return out.returncode
    try:
        agents = json.loads(out.stdout)
    except ValueError:
        agents = None
    if not isinstance(agents, list):
        # 형식을 모르면 건드리지 않는다. 중복이 남아 xm이 직접 거부하므로 실패가 보인다.
        sys.stdout.write(out.stdout)
        return 0
    kept = [a for a in agents if not (isinstance(a, dict) and a.get("sessionId") == only_session and a.get("pid") != only_pid)]
    json.dump(kept, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
