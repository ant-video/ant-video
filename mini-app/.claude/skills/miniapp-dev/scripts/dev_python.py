#!/usr/bin/env python3
"""本地 HTML + Python 联调，不模拟宿主运行时、权限或安装。

python3 dev_python.py miniapps/python-demo --port 3000
页面用 mock 的 __antMockPython 将调用转到 POST /__python/<method>。
仅绑定 127.0.0.1；代码修改后重启。第三方 Python 依赖需自己安装。
"""

import argparse
import json
import re
import runpy
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def load_entry(root):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    entry = root / manifest["python"]["entry"]
    resolved = entry.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("python.entry 必须是包内文件")
    # run_path 和宿主 exec 一样只加载入口；包内模块推荐按 __file__ 相对寻址。
    return runpy.run_path(str(resolved))


class PythonDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, namespace, **kwargs):
        self.namespace = namespace
        super().__init__(*args, **kwargs)

    def do_POST(self):
        if not self.path.startswith("/__python/"):
            self.send_error(404)
            return
        method = self.path[len("/__python/"):]
        try:
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", method):
                raise ValueError("只允许公开函数名")
            function = self.namespace.get(method)
            if not callable(function):
                raise ValueError(f"入口没有函数 {method}")
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 1024 * 1024:
                raise ValueError("请求体不能超过 1MB")
            payload = json.loads(self.rfile.read(size))
            args = payload.get("args", [])
            if not isinstance(args, list):
                raise ValueError("args 必须是数组")
            result = function(*args)
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            status = 200
        except Exception as error:
            body = json.dumps({"code": "PYTHON_CALL_FAILED", "message": str(error)}, ensure_ascii=False).encode("utf-8")
            status = 500
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", type=Path)
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()
    root = args.src.expanduser().resolve()
    handler = partial(PythonDevHandler, directory=str(root), namespace=load_entry(root))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"HTML + Python: http://127.0.0.1:{server.server_port}（改 Python 后重启）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止本地联调服务")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
