"""包内 Python 入口：顶层函数给 ant.python.call，serve 给 HTTP 服务。

不要在这里 app.run() 或自建监听端口；宿主负责加载与服务路由。
无 Flask app 的函数式入口可能被宿主重复加载，不依赖跨调用的模块内存状态。
"""


def hello(payload, extra=0):
    return {"message": f"你好，{payload.get('name', '世界')}", "sum": extra + 3}


def serve(request):
    if request.get("path") in {"/", "/check"}:
        return {"ok": True, "runtime": "python"}
    return {"_status": 404, "error": "not found"}
