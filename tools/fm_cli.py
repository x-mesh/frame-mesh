#!/usr/bin/env python3
"""frame-mesh 명령줄 답장 도구 (의존성 없음).

MCP를 등록하지 않은 에이전트 세션이 Bash로 frame-mesh 대화에 답할 때 쓴다.
  frame-mesh reply <request_id> [--url URL] [text]        text가 없거나 "-"이면 stdin 전체
  frame-mesh propose <request_id> --summary S --reason R [--url URL] [--ops-file F]
  frame-mesh state [--url URL]
  frame-mesh connect [--url URL]                          Claude Code 세션 안에서 `! frame-mesh connect`로 실행
  frame-mesh whoami                                       Claude Code 세션 안에서 `! frame-mesh whoami`로 실행. 서버가 없어도 된다
reply/propose/state는 fm_mcp.call_tool을 그대로 호출하므로 개발 서버 요청 경로와 오류 문구는 MCP 도구와 같다.
결과 JSON 한 줄을 stdout에 쓰고, ok가 false면 종료 코드 1, 입력 오류면 stderr에 한 줄 쓰고 종료 코드 2다.
connect와 whoami는 사람이 읽는 줄을 쓴다(`!`로 실행하면 대화에 그대로 보인다).
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

EXIT_FAILED = 1
EXIT_USAGE = 2


class InputError(Exception):
    pass


def read_stdin():
    try:
        return sys.stdin.buffer.read().decode("utf-8")
    except UnicodeDecodeError as err:
        raise InputError(f"stdin is not valid UTF-8: {err}")


def build_reply(args):
    text = read_stdin() if args.text is None or args.text == "-" else args.text
    if not text.strip():
        raise InputError("text is empty")
    return "fm_reply", {"request_id": args.request_id, "text": text}


def build_propose(args):
    if args.ops_file:
        try:
            raw = Path(args.ops_file).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as err:
            raise InputError(f"cannot read --ops-file {args.ops_file}: {err}")
    else:
        raw = read_stdin()
    try:
        ops = json.loads(raw)
    except ValueError as err:
        raise InputError(f"ops is not valid JSON: {err}")
    if not isinstance(ops, list):
        raise InputError("ops must be a JSON array")
    return "fm_propose", {"request_id": args.request_id, "summary": args.summary, "reason": args.reason, "ops": ops}


def build_state(args):
    return "fm_get_state", {}


def claude_session(command):
    session_id = os.environ.get("CLAUDE_CODE_SESSION_ID")
    try:
        pid = int(os.environ.get("CLAUDE_PID", ""))
    except ValueError:
        pid = None
    if not session_id or pid is None:
        raise InputError(f"run this inside a Claude Code session, for example: ! frame-mesh {command}")
    return session_id, pid


def build_connect(args):
    session_id, pid = claude_session("connect")
    return {"session_id": session_id, "pid": pid, "cwd": os.getcwd()}


def build_whoami(args):
    return claude_session("whoami")


def short_time(epoch):
    """대화 탭과 같은 표기: 오늘이면 시:분, 아니면 월/일 시:분."""
    t = time.localtime(epoch)
    return time.strftime("%H:%M" if time.strftime("%Y-%m-%d", t) == time.strftime("%Y-%m-%d") else "%m/%d %H:%M", t)


def run_whoami(session):
    """대화 탭 목록에서 이 터미널을 알아볼 수 있게, 목록과 같은 이름·상태·터미널·시작 시각을 쓴다."""
    import chat

    session_id, pid = session
    hub = chat.ChatHub(Path(__file__).resolve().parent.parent, os.getcwd())
    cmd = hub.relay_command()
    procs = {}
    if cmd:
        try:
            out = subprocess.run([*cmd, "sessions", *hub.relay_args()], capture_output=True, text=True, timeout=chat.RELAY_TIMEOUT_S, env=hub.relay_env())
            listed = json.loads(out.stdout or "{}").get("sessions") or []
        except (subprocess.SubprocessError, OSError, ValueError, AttributeError):
            listed = []
        procs = {item["pid"]: item for item in listed if isinstance(item, dict) and item.get("session_id") == session_id and isinstance(item.get("pid"), int)}
    info = chat.read_proc_info(sorted({pid, *procs}))
    me = procs.get(pid, {})
    mine = info.get(pid, {})
    details = [me.get("status") if isinstance(me.get("status"), str) else None, mine.get("tty"), f"started {short_time(mine['started_at'])}" if mine.get("started_at") else None]
    name = me.get("name") or session_id[:8]
    print(" · ".join([f"frame-mesh: this terminal is {name} (PID {pid})", *filter(None, details), f"session {session_id[:8]}"]))
    for other in sorted(p for p in procs if p != pid):
        extra = info.get(other, {})
        print(f"frame-mesh: the same session is also open as {procs[other].get('name') or session_id[:8]} (PID {other})" + (f" · {extra['tty']}" if extra.get("tty") else ""))
    if not cmd:
        print("frame-mesh: no relay command (xm), so the name and the state are not shown.")
    return 0


def run_connect(body):
    import fm_mcp

    result = fm_mcp.http("POST", "/chat/connect", body)
    if not result.get("ok"):
        print(f"frame-mesh: {result.get('error') or 'connect failed'}", file=sys.stderr)
        return EXIT_FAILED
    print(f"frame-mesh: connected session {result['session_id'][:8]} (PID {result['pid']}, {result['channel']}) to {result['target']}")
    others = result.get("ambiguous_pids") or []
    if others:
        pids = ", ".join(str(pid) for pid in others)
        print(f"frame-mesh: this session is also open in PID {pids}. Requests go to this terminal (PID {result['pid']}).")
    return 0


def make_parser():
    parser = argparse.ArgumentParser(prog="frame-mesh")
    sub = parser.add_subparsers(dest="command", required=True)
    url_help = "Development server address (default: FRAME_MESH_URL or http://127.0.0.1:4173)"

    reply = sub.add_parser("reply", help="Reply with text in the frame-mesh chat")
    reply.add_argument("request_id")
    reply.add_argument("--url", help=url_help)
    reply.add_argument("text", nargs="?", help="Reply text. Read from stdin if omitted or '-'")
    reply.set_defaults(build=build_reply)

    propose = sub.add_parser("propose", help="Propose a screen change (ops JSON array on stdin or --ops-file)")
    propose.add_argument("request_id")
    propose.add_argument("--summary", required=True)
    propose.add_argument("--reason", required=True)
    propose.add_argument("--url", help=url_help)
    propose.add_argument("--ops-file")
    propose.set_defaults(build=build_propose)

    state = sub.add_parser("state", help="Read the page state that the user sees")
    state.add_argument("--url", help=url_help)
    state.set_defaults(build=build_state)

    connect = sub.add_parser("connect", help="Send chat requests to this Claude Code session (run with ! in the session)")
    connect.add_argument("--url", help=url_help)
    connect.set_defaults(build=build_connect)

    whoami = sub.add_parser("whoami", help="Show how this Claude Code terminal appears in the chat tab list (run with ! in the session)")
    whoami.set_defaults(build=build_whoami, url=None)
    return parser


def main():
    args = make_parser().parse_args()
    try:
        built = args.build(args)
    except InputError as err:
        print(f"frame-mesh: {err}", file=sys.stderr)
        return EXIT_USAGE

    # fm_mcp는 import할 때 BASE를 환경 변수에서 읽으므로 --url은 import 전에 반영해야 한다.
    if args.url:
        os.environ["FRAME_MESH_URL"] = args.url
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if args.command == "connect":
        return run_connect(built)
    if args.command == "whoami":
        return run_whoami(built)

    import fm_mcp

    tool, tool_args = built
    result = fm_mcp.call_tool(tool, tool_args)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
