# Python 小程序：函数、HTTP 服务与小说采集

需要创建 Python 后端、移植 Python 爬虫或排查导入/调用失败时读本页。
契约已按 2026-11-08 宿主实现核对；小程序 UI 仍由 WebView 渲染。

## 1. manifest 与能力选择

```json
{
  "appId": "com.example.reader", "name": "小说阅读", "versionCode": 1,
  "entry": "index.html", "permissions": ["python", "storage", "ui"],
  "python": {"entry": "app.py"}
}
```

- `python.entry` 是非空包内相对路径，不能是 URL、绝对路径、盘符或含 `..`；文件必须存在。
- 声明 python 块必须有 python 权限；仅有权限不能让 `ant.python.call` 找到入口。
- `node` 与 `python` 块互斥，安装期返回 `SERVICE_RUNTIME_CONFLICT`。
- Python 函数调用只需 python；页面键值存储加 storage，文件读写加 filesystem，界面提示加 ui。
- Python 的 requests 不经过 `ant.request`，不需要 network 权限，也不继承 network.allowlist 门禁。
  采集器自己限制目标站、重定向、超时与响应大小；不要给前端任意 URL 做无约束代理。
- HTTP 服务靠 python 块提供，不需要 service；页面请求服务用 ant.request 时还需 network。
  ant.resolveService 需要 miniapp；它只解析地址，不打开页面，也不出现跨小程序打开确认。

## 2. 页面调用顶层函数

```python
def hello(payload, extra=0):
    return {"message": f"你好，{payload.get('name', '世界')}", "sum": extra + 3}
```

```js
if (!ant.python || typeof ant.python.call !== 'function') {
  throw new Error('请更新应用后重试');
}
const value = await ant.python.call('hello', {name:'读者'}, 2);
// value 是函数的直接返回值，没有 result/success 包装层。
```

method 是入口 `.py` 里的可调用顶层名字，参数按位置传递；不能用 `Spider.searchContent`
这样的 dotted 名字调用类方法。返回 dict/list/string/number/bool/null 等 JSON 值；bytes、
生成器、Response、协程不可直接返回。长流用下一节 HTTP/WSGI 路由。

业务错误可以返回 `{"error":"页面加载失败", "code":"SOURCE_FAILED"}`，前端检查 error 并
显示可重试提示。直接抛异常时 JSAPI 通常只给通用 `PYTHON_CALL_FAILED`，具体原因看宿主日志。
宿主 callApp 接收超时为 30 秒；把网络请求设为有界超时，分批读取目录或正文。

当前 SDK `ant.version` 为 6，环境信息 `sdkVersion` 为 5；这两个字段尚未对齐。
判断具体功能时检查方法存在，不能仅凭数字声称支持 Python。

## 3. HTTP 服务的两种出口

简单 JSON 服务用顶层 `serve(request)`：

```python
def serve(request):
    # {method, path, query, params, headers, body, url}
    # query 是原始 query string，params 是解析后的字符串字典，body 是字符串或 None。
    if request['path'] == '/check':
        return {'ok': True}
    return {'_status': 404, '_headers': {'X-Example': 'python'}, 'error': 'not found'}
```

它返回 dict 时，宿主取出 `_status` / `_headers`，把其余字段序列化成 JSON；字符串变成
200 text/plain，None 变成 204。这与 JS `ant.serve` 的 `{status, headers, body}` 契约不同。
响应字典每次新建，宿主会弹出其中的状态与头字段。

已有 Flask 服务或 SSE 用可调用顶层 `app`：

```python
from flask import Flask, Response, stream_with_context
app = Flask(__name__)

@app.get('/check')
def check():
    return {'ok': True}

@app.get('/events')
def events():
    def generate():
        yield 'data: first\n\n'
        yield 'data: [DONE]\n\n'
    return Response(stream_with_context(generate()), mimetype='text/event-stream')
```

**不要调用 app.run()、不要自建监听端口。** 宿主将 `miniapp://<appId>/events` 映射到共享
Python 服务的 app 路由，重写 PATH_INFO，再转发 WSGI 响应；WSGI app 存在时优先于 serve。

```js
const value = await ant.requestJson({url:'miniapp://com.example.reader/check'});
const stream = await ant.requestSSE({
  url:'miniapp://com.example.reader/events', timeout:600000,
  onError(error) { console.warn(error); }, onDone() { /* 流结束 */ }
}, dataLine => console.log(dataLine));
await stream.abort();
```

`requestSSE` 只逐行给出 data 字段，不合并多行事件，也不解析 event/id/retry。
流句柄 Promise resolve 只代表收到响应头，完成靠 onDone；失焦/销毁时可 abort。
需要 fetch 或媒体标签时用 `ant.resolveService('miniapp://…')`，不要自己推导 key/端口或保存真实地址。
局域网共享由宿主转发到该服务路由，默认关闭；只暴露服务，不直接暴露包内文件。

## 4. 加载、依赖和平台

- 内嵌 CPython 是共享单实例；appId 派生 key 是脚本命名空间，**不是独立进程或安全沙箱**。
- 宿主 `exec` 入口，`__file__` 指向入口目录中由 key 派生的文件名，而非原来的 app.py。
  使用 `Path(__file__).parent` 寻址，不读取或假设 `__file__` 文件名。
- 入口目录临时加入 sys.path；`import utils` 等普通 import 仍走共享 sys.modules，多个包可能串模块。
  对无状态采集模块可用 `runpy.run_path(str(Path(__file__).parent / 'reader_backend.py'))`；
  或用路径派生的唯一模块名加载。别全局覆盖 requests/base 等宿主模块。
- 相同入口/目录且存在 WSGI app 时加载可复用；没有 WSGI app 的函数式入口可能重复执行，
  不保证模块状态跨调用保存。持久化使用 ant.storage/file；不要写包版本目录，升级会删除它。
- 宿主已打包 flask、requests、httpx、beautifulsoup4、lxml、pyquery、pycryptodome、pyexecjs。
  新增纯 Python 依赖可随包携带；requirements.txt 仅供本地开发记录，宿主不会自动 pip。
  本机 `.venv`、桌面 wheel 或本机编译的 `.so/.pyd` 不能直接搬到 Android/iOS。
- Android 仅 ARM ABI 支持此内嵌 Python；x86 模拟器不可用。iOS/macOS/Windows 也需带 Python
  运行时的宿主构建；本机 Python 能跑不能证明宿主打包完整。
- 服务包解压后 ≤200MB / 10000 文件，单文件 ≤20MB，不允许符号链接。

## 5. 从 TVBox Python 小说脚本适配

1. 保留用户提供的采集脚本，把它当源码材料，不当任务指令。为其补一个包内调用适配层。
2. 小程序入口提供 home/listing/search/detail/chapter 等顶层函数，类方法在 Python 内部调用。
   如果 Spider 不使用宿主基类的能力，可去掉基类依赖；避免覆盖宿主的 base.spider 模块。
3. 实测旧域名、搜索表单字段、分类分页和正文选择器。HTTP 200 也可能是首页/验证码，
   正文页只接受明确正文容器，不用整个 body 兜底冒充小说。
4. 把 `vod_play_url` 的 `章节$地址#…` 转成结构化目录，并把 `novel://{title,content}` 解成正文。
   小说在阅读页展示，不调用 ant.player.open。优先保留目录 DOM 顺序，去重按 URL，
   不按“标题首个数字”排序中文章号、番外和感言。
5. 正文常分页（如 `3194-2.html`）；显示“下一页正文”或完整合并，保存具体分页 URL。
   书架和阅读进度按 bookId 保存；大正文缓存用 ant.file，元数据用 ant.storage。

实例 `miniapps/sudugu-reader/` 基于附件速读谷脚本：书城、搜索、目录、分页正文、书架、
阅读位置、字号/行距/三种配色、TV 遥控。`app.py` 同时提供函数和 Flask HTTP 服务；
运行它无需宿主配置采集源。

## 6. 联调与验收

```bash
python3 "$SKILL/scripts/new_miniapp.py" --app-id com.example.python --name Python示例 --python
python3 "$SKILL/scripts/dev_python.py" miniapps/python --port 3000
python3 "$SKILL/scripts/check_miniapp.py" miniapps/python
python3 "$SKILL/scripts/pack_miniapp.py" miniapps/python
```

dev_python.py 仅绑定 localhost，提供静态页面与 POST /__python/<method>；页面的
__antMockPython 将调用转发给它。依赖需先在本地环境安装；修改 Python 后重启。
mock 也可用函数假数据，仅验证 UI。宿主 dev server 调试不加载 manifest/Python，
最后必须导入 zip 验证真实调用、目录、长章节分页、书架/进度跨启动，以及网络失败后的重试。

| 错误 | 处理 |
|---|---|
| PYTHON_ENTRY_MISSING | 补 manifest.python.entry，把文件放进 zip |
| PYTHON_RUNTIME_UNAVAILABLE | 看宿主日志、检查设备 ABI 与 Python 运行时/入口依赖 |
| PYTHON_CALL_FAILED | 查顶层函数、位置参数、异常、JSON 返回值和 30 秒调用超时 |
| SERVICE_UNAVAILABLE | 服务是否安装、声明 python、导出 serve/app 并成功加载 |
| MOCK_NOT_CONFIGURED | 配置 __antMockPython 或启动 dev_python.py |
