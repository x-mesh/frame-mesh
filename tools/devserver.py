#!/usr/bin/env python3
"""frame-mesh 개발 서버.

frame-mesh 저장소 루트를 정적으로 서비스하고, 작업실·확장이 보내는 전달 묶음을
POST /handoff 로 받아 대상 프로젝트의 .frame-mesh/handoffs/ 아래에 저장한다.
서버 하나가 여러 프로젝트를 맡는다. 대상 폴더마다 ChatHub(tools/chat.py) 하나를 두고, Router가 요청을 알맞은 hub로 보낸다.
  시작할 때의 --target이 기본 대상이다. 다른 프로젝트에서 `frame-mesh dev`를 실행하면 포트가 쓰이는 중이라
  이 서버가 있는 것을 알아보고 그 폴더를 대상에 더한 뒤 끝난다(POST /chat/targets).
  hub 고르는 순서: 요청의 target → 세션 폴더(cwd)를 포함하는 대상 → 페이지 출처(page)
  (사용자가 고른 대상 → 그 포트를 연 프로젝트, tools/targets.py) → 기본 대상.
대화 요청은 hub의 대상 폴더에서 열린 Claude Code 세션에 전한다. frame-mesh MCP가 있는 세션은 MCP 서버가
POST /chat/register로 알리고, 없는 세션은 외부 전달 명령(xm relay)의 세션 조회로 찾아 셸 명령으로 답하게 한다.
답을 받을 세션은 그 세션 안에서 `frame-mesh connect`(POST /chat/connect)로 지정할 수 있다.
같은 세션 ID가 여러 터미널에 열려 있으면 터미널을 고르게 하고, 고르기 전에는 전달하지 않고 상태에 이유를 알린다.
의존성 없음.
"""
import argparse
import errno
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chat import ChatHub  # noqa: E402  (같은 폴더의 모듈을 경로 추가 뒤에 불러온다)
import targets  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# 전체 HTML을 포함한 묶음도 받을 수 있게 넉넉히 잡되, 무한 업로드는 막는다.
MAX_BODY = 20 * 1024 * 1024
# 요청 번호는 계속 쌓이므로 오래된 것부터 잊는다. 잊은 번호의 답은 어느 대상인지 알 수 없어 거부한다.
ID_KEEP = 2000
GIT_TIMEOUT_S = 3
JOIN_TIMEOUT_S = 2
# 기본 대상은 명령줄을 읽은 뒤에야 알 수 있어 main()에서 만든다.
ROUTER = None


class RouteError(Exception):
    pass


class Router:
    """대상 폴더마다 ChatHub 하나를 두고, 요청을 알맞은 hub로 보낸다."""

    def __init__(self, default, base_url, port):
        self.base_url = base_url
        self.port = port
        self.lock = threading.Lock()
        self.hubs = {}
        self.pages = {}
        self.requests = {}
        self.proposals = {}
        self.default_hub = self.add(default)[0]

    @property
    def default(self):
        return self.default_hub.target

    def add(self, path):
        """(hub, 새로 만들었는지). 폴더가 아니면 RouteError."""
        if not isinstance(path, str) or not path.strip():
            raise RouteError("path is required")
        real = os.path.realpath(path.strip())
        if not os.path.isdir(real):
            raise RouteError(f"Not a folder: {path}")
        with self.lock:
            hub = self.hubs.get(real)
            if hub:
                return hub, False
            hub = self.hubs[real] = ChatHub(ROOT, real, base_url=self.base_url)
            return hub, True

    def _drop(self, hub):
        with self.lock:
            self.hubs.pop(hub.target, None)
            for table in (self.pages, self.requests, self.proposals):
                for key in [k for k, v in table.items() if v is hub or v == hub.target]:
                    del table[key]

    def list(self):
        with self.lock:
            return [{"target": h.target, "target_name": os.path.basename(h.target) or h.target} for h in self.hubs.values()]

    def _containing(self, cwd):
        with self.lock:
            hubs = [h for h in self.hubs.values() if cwd == h.target or cwd.startswith(h.target + os.sep)]
        return max(hubs, key=lambda h: len(h.target), default=None)

    def resolve(self, page=None, target=None, cwd=None):
        """(hub, resolved_by). target 지정 → cwd를 포함하는 가장 긴 대상 → page(고른 대상, 포트의 프로젝트) → 기본 대상."""
        if isinstance(target, str) and target:
            with self.lock:
                hub = self.hubs.get(os.path.realpath(target))
            if not hub:
                raise RouteError(f"unknown target: {target}")
            return hub, "explicit"
        if isinstance(cwd, str) and cwd:
            hub = self._containing(os.path.realpath(cwd))
            if hub:
                return hub, "cwd"
        if isinstance(page, str) and page:
            with self.lock:
                hub = self.hubs.get(self.pages.get(page))
            if hub:
                return hub, "chosen"
            # lsof는 느려서 lock 밖에서 부른다.
            folder = targets.project_for_origin(page, self.port)
            if folder:
                try:
                    return self.add(folder)[0], "port"
                except RouteError:
                    pass
        return self.default_hub, "default"

    def choose(self, page, target):
        """사용자가 고른 대상을 그 페이지 출처에 묶는다."""
        if not isinstance(page, str) or not page or not isinstance(target, str) or not target:
            raise RouteError("page and target are required")
        hub, _ = self.resolve(target=target)
        with self.lock:
            self.pages[page] = hub.target
        return hub

    def connect(self, body):
        """세션이 직접 요청한 것이므로, 맞는 대상이 없으면 그 폴더의 git 최상위(없으면 폴더)를 대상에 더한다."""
        cwd = body.get("cwd") if isinstance(body, dict) else None
        hub, created = None, False
        if isinstance(cwd, str) and cwd.strip():
            real = os.path.realpath(cwd.strip())
            hub = self._containing(real)
            top = os.path.realpath(self._git_toplevel(real)) if not hub else None
            # 홈이나 루트를 대상으로 삼으면 거기에 .frame-mesh를 만들게 된다. 기본 대상이 폴더 불일치로 거절한다.
            if top and top not in (os.sep, os.path.realpath(os.path.expanduser("~"))):
                hub, created = self.add(top)
        result = (hub or self.default_hub).connect(body)
        if created and not result.get("ok"):
            self._drop(hub)
        return result

    @staticmethod
    def _git_toplevel(cwd):
        try:
            out = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=GIT_TIMEOUT_S)
        except (subprocess.SubprocessError, OSError):
            return cwd
        return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else cwd

    def _remember(self, table, key, hub):
        if not key:
            return
        with self.lock:
            table[key] = hub
            while len(table) > ID_KEEP:
                del table[next(iter(table))]

    def send(self, hub, text, context, kind):
        result = hub.send(text, context, kind)
        self._remember(self.requests, result.get("request_id"), hub)
        return result

    def _owner(self, table, key, label):
        with self.lock:
            hub = table.get(key) if isinstance(key, str) else None
        if not hub:
            raise RouteError(f"Unknown {label} id")
        return hub

    def propose(self, body):
        hub = self._owner(self.requests, body.get("request_id"), "request")
        result = hub.propose(body.get("request_id"), body.get("summary"), body.get("ops"), body.get("reason", ""))
        self._remember(self.proposals, result.get("proposal_id"), hub)
        return result

    def reply(self, body):
        hub = self._owner(self.requests, body.get("request_id"), "request")
        return hub.reply(body.get("request_id"), body.get("text"))

    def set_proposal_status(self, body):
        hub = self._owner(self.proposals, body.get("proposal_id"), "proposal")
        return hub.set_proposal_status(body.get("proposal_id"), body.get("status"), body.get("note", ""))

    def status(self, hub, resolved_by):
        return {**hub.status(), "targets": self.list(), "resolved_by": resolved_by}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # 이 서버는 실행 중인 AI 에이전트 세션에 요청을 넣는다. 아무 웹사이트나 127.0.0.1로 요청을 보내
    # 세션에 지시를 넣거나 대화를 읽지 못하도록, 브라우저 요청은 이 서버 자신과 확장 출처만 받는다.
    # Origin이 없는 요청(curl, tools/fm_mcp.py 같은 로컬 프로그램)은 브라우저 요청이 아니므로 받는다.
    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        if origin.startswith("chrome-extension://"):
            return True
        port = self.server.server_address[1]
        return origin in {f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"}

    def _guarded(self, path):
        return path.startswith("/chat/") or path == "/handoff"

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204 if self._origin_allowed() else 403)
        self.end_headers()

    def _reject_foreign(self, path, require_json):
        if not self._guarded(path):
            return False
        if not self._origin_allowed():
            self._json(403, {"ok": False, "error": "Origin not allowed"})
            return True
        # JSON이 아닌 POST는 사전 확인 없이 다른 사이트에서 보낼 수 있으므로 받지 않는다.
        if require_json and "application/json" not in (self.headers.get("Content-Type") or ""):
            self._json(415, {"ok": False, "error": "Only Content-Type: application/json is accepted"})
            return True
        return False

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/chat/"):
            super().do_GET()
            return
        if self._reject_foreign(url.path, require_json=False):
            return
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            self._chat_get(url.path, q)
        except RouteError as err:
            self._json(400, {"ok": False, "error": str(err)})

    def _chat_get(self, path, q):
        if path == "/chat/targets":
            self._json(200, {"ok": True, "frame_mesh": True, "default": ROUTER.default, "targets": ROUTER.list()})
        elif path == "/chat/status":
            hub, by = ROUTER.resolve(q.get("page"), q.get("target"))
            self._json(200, {"ok": True, **ROUTER.status(hub, by)})
        elif path == "/chat/events":
            hub, _ = ROUTER.resolve(q.get("page"), q.get("target"))
            self._json(200, {"ok": True, **hub.events_since(int(q.get("since", 0)), float(q.get("timeout", 20)))})
        elif path == "/chat/state":
            hub, _ = ROUTER.resolve(q.get("page"), q.get("target"), q.get("cwd"))
            self._json(200, {"ok": True, **hub.get_state()})
        elif path == "/chat/wait":
            hub, _ = ROUTER.resolve(q.get("page"), q.get("target"), q.get("cwd"))
            req = hub.wait_request(float(q.get("timeout", 50)), q.get("session_id") or None)
            self._json(200, {"ok": True, "request": req})
        else:
            self._json(404, {"ok": False, "error": "unknown path"})

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            return None

    def _chat_post(self, path):
        # 대상 폴더를 늘리는 일은 로컬 명령(frame-mesh dev)만 한다. 확장이나 페이지는 Origin을 달고 오므로 거부한다.
        if path == "/chat/targets" and self.headers.get("Origin") is not None:
            self._json(403, {"ok": False, "error": "Origin not allowed"})
            return
        body = self._read_json()
        if not isinstance(body, dict):
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        try:
            result = self._chat_result(path, body)
        except RouteError as err:
            result = {"ok": False, "error": str(err)}
        if result is None:
            self._json(404, {"ok": False, "error": "unknown path"})
            return
        self._json(200 if result.get("ok") else 400, result)

    def _chat_result(self, path, body):
        page, target = body.get("page"), body.get("target")
        if path == "/chat/targets":
            hub, added = ROUTER.add(body.get("path"))
            return {"ok": True, "target": hub.target, "added": added}
        if path == "/chat/target":
            hub = ROUTER.choose(page, target)
            return {"ok": True, **ROUTER.status(hub, "chosen")}
        if path == "/chat/send":
            hub, _ = ROUTER.resolve(page, target)
            return ROUTER.send(hub, body.get("text"), body.get("context"), body.get("kind", "chat"))
        if path == "/chat/register":
            # 세션이 알리는 것만으로는 대상을 늘리지 않는다. 맞는 대상이 없으면 기본 hub가 in_target: false로 답한다.
            hub, _ = ROUTER.resolve(cwd=body.get("cwd"))
            return hub.register(body)
        if path == "/chat/connect":
            return ROUTER.connect(body)
        if path == "/chat/session":
            hub, _ = ROUTER.resolve(page, target)
            return {"ok": True, **hub.set_session(body.get("session_id"), body.get("pid"))}
        if path == "/chat/reply":
            return ROUTER.reply(body)
        if path == "/chat/propose":
            return ROUTER.propose(body)
        if path == "/chat/proposal":
            return ROUTER.set_proposal_status(body)
        if path == "/chat/state":
            hub, _ = ROUTER.resolve(page, target)
            return hub.set_page_state(body.get("state"))
        return None

    def do_POST(self):
        if self._reject_foreign(self.path, require_json=True):
            return
        if self.path.startswith("/chat/"):
            self._chat_post(self.path)
            return
        if self.path != "/handoff":
            self._json(404, {"ok": False, "error": "unknown path"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"ok": False, "error": f"body size {length} out of range"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        if not isinstance(payload, dict):
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        try:
            hub, _ = ROUTER.resolve(payload.get("page"), payload.get("target"))
        except RouteError as err:
            self._json(400, {"ok": False, "error": str(err)})
            return
        handoff_dir = Path(hub.handoff_dir)
        markdown = payload.get("markdown")
        data = payload.get("json")
        if not isinstance(markdown, str) or not markdown.strip():
            self._json(400, {"ok": False, "error": "markdown required"})
            return
        source = (data or {}).get("source") or payload.get("source") or "page"
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", re.sub(r"^https?://", "", str(source))).strip("-")[:60] or "page"
        stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
        handoff_dir.mkdir(parents=True, exist_ok=True)
        # 사용자의 저장소 .gitignore를 건드리지 않고도 전달 묶음이 커밋되지 않게 한다.
        try:
            with open(handoff_dir.parent / ".gitignore", "x", encoding="utf-8") as f:
                f.write("*\n")
        except FileExistsError:
            pass
        md_path = handoff_dir / f"{stamp}-{slug}.md"
        md_path.write_text(markdown, encoding="utf-8")
        files = [md_path]
        if data is not None:
            json_path = handoff_dir / f"{stamp}-{slug}.json"
            json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            files.append(json_path)
        (handoff_dir / "latest.md").write_text(markdown, encoding="utf-8")
        self._json(200, {"ok": True, "dir": str(handoff_dir), "files": [str(f.relative_to(hub.target)) for f in files]})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def relay_line(hub):
    source = hub.relay_source()
    if source == "xm":
        return f"relay: {shlex.join([*hub.relay_command(), *hub.relay_args()])} (auto)"
    if source == "env":
        return f"relay: {os.environ['FRAME_MESH_RELAY_CMD']} (FRAME_MESH_RELAY_CMD)"
    if "FRAME_MESH_RELAY_CMD" in os.environ:
        return "relay: off (FRAME_MESH_RELAY_CMD is empty or not found; a session must wait with fm_wait_request)"
    return "relay: off (xm not found; a session must wait with fm_wait_request)"


def join_running_server(base_url, folder):
    """같은 주소에 frame-mesh 서버가 이미 있으면 그 서버의 대상에 folder를 더한다. 합류했으면 True."""
    try:
        with urllib.request.urlopen(f"{base_url}/chat/targets", timeout=JOIN_TIMEOUT_S) as res:
            if json.loads(res.read() or b"{}").get("frame_mesh") is not True:
                return False
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return False
    req = urllib.request.Request(f"{base_url}/chat/targets", data=json.dumps({"path": str(folder)}).encode("utf-8"), method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=JOIN_TIMEOUT_S) as res:
            added = json.loads(res.read() or b"{}").get("added")
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read() or b"{}").get("error")
        except ValueError:
            detail = None
        print(f"frame-mesh: the server at {base_url} refused {folder}: {detail or f'HTTP {err.code}'}", file=sys.stderr)
        sys.exit(1)
    except (urllib.error.URLError, OSError, ValueError):
        return False
    print(f"frame-mesh: added {folder} to the server at {base_url}" if added else f"frame-mesh: {folder} is already served by the server at {base_url}", flush=True)
    return True


def port_in_use_message(port):
    """포트를 쓰는 프로세스를 밝힌다. 이전 버전의 frame-mesh 서버는 합류를 받지 못해 같은 오류가 나므로 따로 알린다."""
    pid = targets.listener_pid(port)
    command = targets.run(["ps", "-o", "command=", "-p", str(pid)]) if pid else None
    if command and "devserver.py" in command:
        return f"frame-mesh: an older frame-mesh server (PID {pid}) uses port {port} and cannot accept other projects. Stop it with: kill {pid}"
    if command:
        return f"frame-mesh: port {port} is used by PID {pid} ({command.strip()[:80]}). Stop it or run with --port <n>."
    return f"frame-mesh: port {port} is already in use. Stop the other server or run with --port <n>."


def main():
    global ROUTER
    parser = argparse.ArgumentParser(description="frame-mesh development server")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--target", default=str(ROOT), help="project folder that chat requests are sent to (default: the frame-mesh root)")
    args = parser.parse_args()
    if not os.path.isdir(args.target):
        parser.error(f"--target is not a folder: {args.target}")
    target = Path(os.path.realpath(args.target))
    # 0.0.0.0은 접속 주소가 아니므로, 세션이 답장할 주소는 루프백으로 안내한다.
    host = "127.0.0.1" if args.bind == "0.0.0.0" else args.bind
    base_url = f"http://{host}:{args.port}"
    ROUTER = Router(str(target), base_url, args.port)
    try:
        server = ThreadingHTTPServer((args.bind, args.port), Handler)
    except OSError as err:
        if err.errno != errno.EADDRINUSE:
            raise
        if join_running_server(base_url, target):
            sys.exit(0)
        print(port_in_use_message(args.port), file=sys.stderr)
        sys.exit(1)
    hub = ROUTER.default_hub
    print(f"frame-mesh: http://{args.bind}:{args.port}/index.html", flush=True)
    print(f"target: {target}  (handoffs: {hub.handoff_dir})", flush=True)
    print("other projects: run frame-mesh dev there; it joins this server.", flush=True)
    print(relay_line(hub), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
