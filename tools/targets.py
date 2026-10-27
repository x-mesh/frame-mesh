"""페이지 출처(origin)를 그 포트를 연 프로젝트 폴더로 바꾼다.

작업실이 열린 페이지가 localhost의 어느 개발 서버인지 알면, 요청을 받을 프로젝트를 사용자가 고르지 않아도 정할 수 있다.
lsof(필요하면 /proc)로 포트를 연 프로세스를 찾아 그 작업 폴더를 쓰므로, lsof가 없거나 실패하면 찾지 못한 것으로 본다.
"""
import os
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
COMMAND_TIMEOUT_S = 3
# 상태 조회가 10초마다 오고 lsof는 느리므로 결과는 포트별로 잠시 재사용한다. 못 찾은 결과도 같다.
CACHE_S = 30

_cache = {}
_cache_lock = threading.Lock()


def run(cmd):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=COMMAND_TIMEOUT_S)
    except (subprocess.SubprocessError, OSError):
        return None
    return out.stdout if out.returncode == 0 else None


def listener_pid(port):
    out = run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"])
    for line in (out or "").split():
        if not line.isdigit():
            continue
        # 찾은 폴더에 전달 묶음 파일을 쓰므로, 다른 사용자의 프로세스는 따르지 않는다.
        uid = (run(["ps", "-o", "uid=", "-p", line]) or "").strip()
        if uid == str(os.getuid()):
            return int(line)
    return None


def _process_cwd(pid):
    if sys.platform.startswith("linux"):
        try:
            return os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            pass
    for line in (run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"]) or "").splitlines():
        if line.startswith("n"):
            return line[1:]
    return None


def _project_root(cwd):
    top = (run(["git", "-C", cwd, "rev-parse", "--show-toplevel"]) or "").strip()
    return os.path.realpath(top or cwd)


def _lookup(port):
    pid = listener_pid(port)
    cwd = _process_cwd(pid) if pid else None
    if not cwd or not os.path.isdir(cwd):
        return None
    root = _project_root(cwd)
    # 홈이나 루트에서 띄운 서버를 대상으로 삼으면 거기에 .frame-mesh를 만들게 된다.
    if root == os.sep or root == os.path.realpath(os.path.expanduser("~")):
        return None
    return root


def project_for_origin(origin, hub_port):
    """origin이 로컬 개발 서버면 그 프로세스의 프로젝트 폴더, 아니면 None. hub_port는 이 서버 자신의 포트다."""
    try:
        parsed = urlparse(origin)
        host, port = parsed.hostname, parsed.port
    except (ValueError, AttributeError):
        return None
    if host not in LOOPBACK_HOSTS or not port or port == hub_port:
        return None
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(port)
        if hit and now - hit[0] < CACHE_S:
            return hit[1]
    folder = _lookup(port)
    with _cache_lock:
        _cache[port] = (time.monotonic(), folder)
    return folder
