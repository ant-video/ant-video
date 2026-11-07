"""小程序 Python 入口：顶层函数和 Flask HTTP 服务共用阅读后端。"""

import runpy
from pathlib import Path

from flask import Flask, jsonify, request

# 宿主 __file__ 的文件名是 appId 派生 key；只使用其父目录，不假定它叫 app.py。
_backend = runpy.run_path(str(Path(__file__).parent / "reader_backend.py"))
app = Flask(__name__)


def _call(method, *args):
    try:
        return _backend[method](*args)
    except Exception as error:
        # JSAPI 的通用失败只给 PYTHON_CALL_FAILED；此处返回业务错误，让页面能显示原因。
        app.logger.warning("速读谷 %s 失败: %s", method, error)
        return {"error": str(error), "code": "SOURCE_FAILED"}


def home():
    return _call("home")


def listing(category="all", page=1):
    return _call("listing", category, page)


def search(keyword, page=1):
    return _call("search", keyword, page)


def detail(book_id):
    return _call("detail", book_id)


def chapter(url):
    return _call("chapter", url)


@app.get("/check")
def check():
    return {"ok": True, "runtime": "python", "source": "速读谷"}


@app.get("/api/<method>")
def api(method):
    handlers = {
        "home": lambda: home(),
        "listing": lambda: listing(request.args.get("category", "all"), request.args.get("page", "1")),
        "search": lambda: search(request.args.get("keyword", ""), request.args.get("page", "1")),
        "detail": lambda: detail(request.args.get("id", "")),
        "chapter": lambda: chapter(request.args.get("url", "")),
    }
    if method not in handlers:
        return jsonify({"error": "接口不存在"}), 404
    result = handlers[method]()
    return jsonify(result), 502 if result.get("error") else 200
