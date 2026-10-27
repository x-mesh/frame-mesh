#!/usr/bin/env python3
"""frame-mesh 개발 서버.

프로젝트 루트를 정적으로 서비스하고, 작업실·확장이 보내는 전달 묶음을
POST /handoff 로 받아 handoffs/ 아래에 저장한다. 의존성 없음.
"""
import argparse
import json
import re
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chat import ChatHub  # noqa: E402  (같은 폴더의 모듈을 경로 추가 뒤에 불러온다)

ROOT = Path(__file__).resolve().parent.parent
HANDOFF_DIR = ROOT / "handoffs"
# 전체 HTML을 포함한 묶음도 받을 수 있게 넉넉히 잡되, 무한 업로드는 막는다.
MAX_BODY = 20 * 1024 * 1024
HUB = ChatHub(ROOT)


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
        if url.path == "/chat/status":
            self._json(200, {"ok": True, **HUB.status()})
        elif url.path == "/chat/events":
            self._json(200, {"ok": True, **HUB.events_since(int(q.get("since", 0)), float(q.get("timeout", 20)))})
        elif url.path == "/chat/state":
            self._json(200, {"ok": True, **HUB.get_state()})
        elif url.path == "/chat/wait":
            req = HUB.wait_request(float(q.get("timeout", 50)))
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
        body = self._read_json()
        if body is None:
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        if path == "/chat/send":
            result = HUB.send(body.get("text"), body.get("context"), body.get("kind", "chat"))
        elif path == "/chat/session":
            result = {"ok": True, **HUB.set_session(body.get("session_id"))}
        elif path == "/chat/reply":
            result = HUB.reply(body.get("request_id"), body.get("text"))
        elif path == "/chat/propose":
            result = HUB.propose(body.get("request_id"), body.get("summary"), body.get("ops"), body.get("reason", ""))
        elif path == "/chat/proposal":
            result = HUB.set_proposal_status(body.get("proposal_id"), body.get("status"), body.get("note", ""))
        elif path == "/chat/state":
            result = HUB.set_page_state(body.get("state"))
        else:
            self._json(404, {"ok": False, "error": "unknown path"})
            return
        self._json(200 if result.get("ok") else 400, result)

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
        markdown = payload.get("markdown")
        data = payload.get("json")
        if not isinstance(markdown, str) or not markdown.strip():
            self._json(400, {"ok": False, "error": "markdown required"})
            return
        source = (data or {}).get("source") or payload.get("source") or "page"
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", re.sub(r"^https?://", "", str(source))).strip("-")[:60] or "page"
        stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
        HANDOFF_DIR.mkdir(exist_ok=True)
        md_path = HANDOFF_DIR / f"{stamp}-{slug}.md"
        md_path.write_text(markdown, encoding="utf-8")
        files = [md_path]
        if data is not None:
            json_path = HANDOFF_DIR / f"{stamp}-{slug}.json"
            json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            files.append(json_path)
        (HANDOFF_DIR / "latest.md").write_text(markdown, encoding="utf-8")
        self._json(200, {"ok": True, "files": [str(f.relative_to(ROOT)) for f in files]})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="frame-mesh development server")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f"frame-mesh workbench: http://{args.bind}:{args.port}/index.html  (handoffs: POST /handoff → handoffs/)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
