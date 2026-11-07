---
name: miniapp-dev
description: 为蚂蚁影视开发、调试、校验和打包 WebView 小程序，支持 HTML/JS/CSS、包内 Python 或 Node.js 后端、小说阅读、流式请求、私有文件及在线站点。适用于 manifest、ant JSAPI、TV 遥控和安装运行问题；不用于修改 Flutter 宿主功能。
---

# 小程序开发（flutter_ant_video 宿主）

小程序界面是 HTML/JS/CSS，跑在宿主 WebView 里，通过 document-start 注入的 `window.ant`
调用宿主能力；包内还可携带 Python 或 Node.js 后端。已支持这些能力的宿主无需修改 Flutter
或重新编译。创建 Python 小程序时先读 [references/python.md](references/python.md)。

## 动手前确认三件事

1. 要做的是**小程序**（WebView 包，可带 Python/Node 后端，本 skill）还是**宿主功能**（Flutter/Dart，改 `lib/`）？后者不适用本 skill。
2. **输出位置**。默认当前目录下的 `miniapps/<slug>/`。用户指定了就用他们的。
3. 是否要**随宿主内置**（进宿主仓库的 `assets/miniapp/`）。默认不是——见第 6 节，那节只在宿主仓库里有意义。

## 0. 本 skill 是自带资料的，可以脱离宿主仓库用

参考资料、模板、mock SDK、校验与打包脚本全在 skill 目录里，脚手架/预检/打包仅依赖
`python3` 标准库。Python 本地联调还需安装业务代码依赖；宿主不会从 requirements.txt 自动 pip
安装。整个目录可放在项目 `.agents/skills/`、个人 `~/.codex/skills/` 或 `.claude/skills/`。

下面命令里的 `$SKILL` 指 skill 自己的目录，先解析一次：

```bash
# 将它设为当前读到的 SKILL.md 所在目录；独立公开项目也可能放在 skills/ 下。
SKILL=/absolute/path/to/miniapp-dev
```

只有两处需要宿主仓库：第 6 节（做成内置小程序）和文末列的宿主源码/文档（可选的加深阅读）。
不在宿主仓库里时跳过它们，其余流程完全不受影响。

## 1. 脚手架

```bash
python3 "$SKILL/scripts/new_miniapp.py" \
  --app-id com.leospring.notes --name 我的笔记 --out miniapps/notes
```

生成 `manifest.json` / `index.html` / `app.js` / `style.css` / `ant-mock.js`，硬规则（相对路径、
`body` 背景、安全区、深色模式、TV 遥控焦点、mock 权限自检）已经预置好，直接往上写业务。
`--permissions ui,storage,filesystem,network,player,source,navigate,miniapp,service,node,python` 可指定
权限，缺省 `ui,storage`；`--node` 生成 Node 服务（见 7.3）；`--python` 生成 `app.py`、Python
声明和 `ant.python.call` 示例（见 7.4）。两种后端互斥。

不用脚手架就手写时，模板在 `$SKILL/assets/template/`，逐条对齐第 4 节硬规则。

## 2. 阶段① 浏览器里写（90% 的时间待在这）

宿主编译要几分钟、打包安装十几秒，**不要在宿主里写代码**。布局、交互、业务逻辑全部在浏览器里完成：

```bash
cd miniapps/notes && python3 -m http.server 3000   # 必须走 HTTP，不能 file://
```

`ant-mock.js` 在浏览器里补齐 `window.ant`（toast/storage/player 都有极简实现），进了宿主检测到真
SDK 会自动退让，所以**打包时留着无害**。采集源没法模拟，在 `index.html` 里用
`window.__antMockFixtures` 喂假数据；`window.__antMockPermissions` 要和 manifest 保持一致。

唯一硬伤：mock 的 `ant.request` 走 `fetch`，**受 CORS 限制**，真机不受限。优先用假数据绕开。

## 3. 阶段② 宿主调试模式（真 JSAPI）

代码仍在 dev server 上，但 JSAPI 是真的——验证真实播放器、采集源、TV 遥控只能靠它。

1. dev server 监听 `0.0.0.0`：`python3 -m http.server 3000 --bind 0.0.0.0`
2. 取局域网 IP：macOS `ipconfig getifaddr en0`；Linux `hostname -I`；Windows `ipconfig`
3. 宿主 → 小程序 → 右上角 🐞 → 填 `http://192.168.x.x:3000` → 启动调试

桌面宿主可用 `127.0.0.1`；Android 模拟器用 `10.0.2.2`。改完代码点悬浮球里的「重新加载」。

小程序全屏运行、没有顶栏，容器操作都收在可拖动的**悬浮球**里：重新加载 / 日志 / 关闭。
日志面板收了 JSAPI 调用与返回、被拒的权限、`console.*` 与加载错误，前缀 `[APP]` `[API]` `[SYS]`
`[ERR]`，可全部复制——真机上先看它。调试实例的日志强制可见；正式安装的实例要先在小程序中心
右上角「调试」里打开调试功能开关（下次启动生效）。要用完整 DevTools：Android 走
`chrome://inspect`，iOS/macOS 走 Safari 开发菜单，且**只有 debug 构建能 inspect**。

**调试模式权限全开且完全不读 manifest**，所以它验证不了权限声明和安装校验——这两项靠第 5 节的预检。

**服务型小程序（`ant.serve`）在调试模式下测不了**：dev server 实例没有 loopback 服务，宿主
没有可回调的入口。那部分只能装成 zip 之后验，见第 7.1 节。

**Python/Node 后端也不会由 dev server 调试加载**：它不读取 manifest，也没有已安装的包目录。
Python 本地联调用 `python3 "$SKILL/scripts/dev_python.py" miniapps/example --port 3000`；
真正的内嵌运行时、包内依赖和 JSAPI 权限最后通过导入 zip 验证。

## 4. 硬规则（违反了会静默失败，逐条核对）

| 规则 | 违反后的现象 |
|---|---|
| 资源引用全部用相对路径（`./app.js`），不用 `/app.js` | 白屏 + 一堆 404。小程序挂在 `http://127.0.0.1:<port>/<token>/` 下 |
| 不要写 `<script src="ant-sdk.js">` | 宿主 document-start 已注入，手动引反而可能拿到空实现 |
| 自己设 `body { background }` | 容器 WebView 是透明的，会透出宿主壁纸 |
| `permissions` 覆盖实际用到的每个 API | 运行时 `PERMISSION_DENIED`；**调试模式全开，测不出来** |
| `ant.miniApp.open` 只能由当前可见的前台页响应用户操作发起，目标 appId 必须已安装 | `NOT_FOREGROUND` / `APP_NOT_INSTALLED`；不要在后台定时器里自动拉起 |
| 要支持 TV 就必须实现 `ant.tv.onKey` | 电视上遥控器完全没反应（WebView 不参与系统焦点） |
| 小对象持久化用 `ant.storage`，正文/附件等文件用 `ant.file` + `filesystem` 权限 | 每次启动 origin 端口都变，`localStorage` 不保证保留 |
| 每次发版 `versionCode` +1 | 装了新版打开还是老的 |
| `network.allowlist` 写了就要覆盖全部域名（不写＝`ant.request` 不限制，但**导航只剩同源**；导航不认 `*`） | `HOST_NOT_ALLOWED`；点站内链接弹「离开小程序」 |
| 用了 `ant.serve` 就别依赖 DOM/动画/用户点击 | 宿主会在页面不可见时后台拉起你，那时 `requestAnimationFrame` 被节流、没人点按钮 |
| 构建工具设 `base: './'`（Vite）/ `publicPath: './'`，路由用 hash 模式 | 白屏；刷新 404 |
| `viewport-fit=cover` + `env(safe-area-inset-*)` | 刘海屏/手势条被裁 |

普通外网请求只允许 http/https，回环与内网地址（`localhost`、`127.x`、`10.x`、
`172.16-31.x`、`192.168.x`、`169.254.x`）一律 `FORBIDDEN_HOST`；响应体上限 10MB；`ant.storage`
配额 5MB；`ant.file` 总配额 20MB、单文件 5MB；采集源单次超时 60s、并发上限 3；
`ant.serve` 单次 60s 超时、请求体 ≤1MB。宿主解析的 `miniapp://` 服务及其注册端点是网络限制
的受控例外，别猜端口、token 或 Python key。Python 的 requests 不走 JSAPI 域名门禁。

### 4.1 在线站点型小程序（包着一个线上站点）

`manifest.entry` 写成 `https://…` 时，包里只要一份 `manifest.json`：宿主不起本地静态服务，
WebView 直接开这个地址，SDK 照旧在 document-start 注入。

```json
{ "appId": "com.example.site", "name": "示例站", "versionCode": 1,
  "entry": "https://www.example.com/app/",
  "permissions": ["ui", "storage", "navigate"],
  "network": { "allowlist": ["*.example.com", "cdn.foo.cn"] } }
```

- 装法：宿主 → 小程序 → `+` → 「从链接安装」填这个 `manifest.json` 的地址；本地选 `.json`
  文件、或打成只含 manifest 的 zip 也行。市场 JSON 的 `url` 同样可以指向 `manifest.json`
- `allowlist` 决定站内还能跳哪些域名（登录回跳、`www` 与裸域、页面 CDN），**得逐条写、`*`
  对导航无效**，漏了就弹「离开小程序」。`iframe` 同规则，子框架里的外链直接拦、不弹窗
- 入口不能是本机/内网地址，宿主拒装拒启；连开发机 dev server 请用调试模式
- `ant.request` 隐式放行入口域名；子资源（`img`/`script`/`fetch`）不受 allowlist 约束，
  跨域看 CORS
- 站点自己的 `localStorage`/Cookie 跟站点 origin 走，与 `ant.storage` 是两套
- 宿主默认启用两层广告过滤：请求层拦常见广告厂商/资源 URL，页面层隐藏横幅、信息流、插屏
  和视频广告控件。误伤时让用户在「小程序设置 → 在线网站广告过滤」关闭，结束实例后重开生效

## 5. 阶段③ 预检 + 打包

```bash
python3 "$SKILL/scripts/check_miniapp.py" miniapps/notes   # 预检
python3 "$SKILL/scripts/pack_miniapp.py"  miniapps/notes   # 预检通过才打包，附带 size/md5
```

预检核对 manifest、后端声明/权限/入口、符号链接、体积与文件数上限，外加
**扫代码里实际调用的 `ant.*` 反查权限声明**、绝对路径引用、`body` 背景缺失、TV 按键缺失。
`ERROR` 必须清零再进宿主；`WARN` 逐条判断。有构建流程时检查 `dist/`，不是源码目录。

打包用 python 的 `zipfile`，不依赖系统 `zip`；隐藏文件及开发缓存自动排除，
`manifest.json` 保证落在包根。普通包排除 node_modules，Node 包保留 node_modules；Python 包保留包内纯
Python 依赖，排除 `__pycache__`、`.pyc`、虚拟环境。Node/Python 后端包上限都是 200MB / 10000 文件。

装包：宿主 → 小程序 → 右上角 `+` → 「导入 zip 包」。开发期可用「导入文件夹」跳过打包
（桌面与 iOS 可用，Android 分区存储下常读不到路径，那边还是用 zip）。

装完至少走一遍：冷启动 → 每个主要交互 → 播放 → 退出播放页回到小程序 → 退出 → 再打开
（验证 `ant.storage` 真的持久化了）。

## 6. 做成宿主内置小程序（仅在宿主仓库内可做）

只有明确要求"随宿主发布"时才做，前提是当前就在 flutter_ant_video 仓库里。
散装文件放 `assets/miniapp/<name>/`，然后改两处：

- `pubspec.yaml` 的 `flutter.assets` 加 `- assets/miniapp/<name>/`
- `lib/miniapp/services/mini_app_demo.dart`：加一个 `MiniAppBuiltinBundle` 常量（`appId`、
  `assetDir`、**逐个列出 `files`**，漏一个文件就 404）并加进 `MiniAppDemo.all`

宿主启动时在内存里把这些散装 asset 压成 zip 再走真正的安装器，所以**不要提交 zip 文件**。
改完要 `flutter pub get` 并重新编译宿主。

## 7. JSAPI 速查

异步 JSAPI 返回 Promise，事件订阅/同步转换工具除外；失败 reject 带 `code` / `api` 的 Error。

```js
ant.env.getSystemInfo()                  // {platform,osVersion,isTV,appId,devMode,permissions,sdkVersion}
ant.log(msg)                             // 免权限；console.* 也会进日志面板
ant.request({url,method,headers,data,timeout,responseType,followRedirects})
                                         // → {statusCode,headers,data,responseType,url}  [network]
ant.requestJson({url})                   // 非 2xx / 非法 JSON 会 reject          [network]
ant.requestBytes({url}) · base64ToBytes(s)  // 二进制，→ Uint8Array               [network]
ant.requestStream({url,onHeaders,onData,onError,onDone,onAbort})                  [network]
ant.requestSSE(options, onDataLine) · readLines(onLine) // SSE data 行 / 分块行解析
ant.resolveService('miniapp://com.example.service/path')                         [miniapp]
ant.storage.get/set/getJSON/setJSON/remove/clear/keys()                          [storage]
ant.file.write/read/stat/list/mkdir/rename/delete()                              [filesystem]
ant.python.call('functionName', ...jsonArgs)                                      [python]
ant.ui.toast/loading/hideLoading/confirm({title,content})/actionSheet([...])     [ui]
ant.clipboard.get/set(text)                                                      [ui]
ant.navigateTo/redirectTo(url) · navigateBack() · exitMiniApp()                  [navigate]
ant.miniApp.open({appId,path?,params?})                                           [miniapp]
ant.miniApp.getLaunchOptions() · onOpen(fn)                                      [免权限]
ant.player.open({url,title,headers,sniff}) · getState() · onStateChange(fn) · onClose(fn) [player]
ant.source.list() · home(siteKey) · category({siteKey,tid,page,ext})
         · detail({siteKey,id}) · play({siteKey,flag,id}) · search({siteKey,wd,page})  [source]
ant.serve(async req => resp)             // 宿主反过来调你，见下                  [service]
ant.on/off/once(event, fn) · onShow(fn) · onHide(fn) · tv.onKey(fn)
```

事件：`app.show`、`app.hide`、`miniApp.open`、`player.open`、`player.stateChange`、`player.close`、`keydown`、`request.stream`。
能力判断优先检查方法存在；当前 SDK `ant.version` 为 6，宿主环境字段仍报 `sdkVersion: 5`，
不要只靠数字判断 Python、文件或流式 API。`ant.request` 可直接请求 `miniapp://`；原生 fetch
或媒体标签先用 `ant.resolveService`，解析出的实际地址不要持久化。
`ant.player.open` 的 `headers` 是取流请求头（`source.play` 返回的 `header` 可原样传，单数也认，
上限 32 条 / 单值 8192 字符）；`play.parse` / `play.jx` 为 `'1'` 的线路拿到的是网页地址，把整份
`play` 原样交给 `ant.player.open()`，宿主会跑解析器和网页嗅探；自己抓的站点可用 `sniff: true`
显式声明嗅探。外挂字幕仍不支持。它是整页跳转，退出会收到
`player.close`。采集源返回宿主内部的 `vod_*` 蛇形字段；用户可能一个站点都没配，`list()` 要按空数组处理。

`responseType: 'base64'` 才能拿到原始字节（protobuf / gzip / brotli / GBK 网页必须用它，
缺省的 `'text'` 会让宿主按 charset 解码，二进制经此一遭就毁了）。

### 7.1 `ant.miniApp`：打开其它已安装小程序

来源小程序先在 manifest 声明 `miniapp`，再由当前可见页面响应用户操作调用：

```js
const result = await ant.miniApp.open({
  appId: 'com.example.target',
  path: 'detail.html?id=7',
  params: { id: 7, from: 'recommend' }
});
// 用户取消也会正常 resolve：{ opened:false, ... }
```

宿主确认目标已安装后，每次显示来源与目标名称让用户确认。目标已在后台就复用原 WebView；
带 `path` 时换到指定页面，不带时保留原页面。路径只能留在目标包或在线入口 origin 内，
`params` 必须是 JSON 对象且不超过 64KB。

目标小程序**不需要** `miniapp` 权限。入口脚本先注册事件，再主动读取宿主缓存，避免首屏竞态：

```js
ant.miniApp.onOpen(options => render(options));
const options = await ant.miniApp.getLaunchOptions(); // 从中心直接启动时为 null
if (options) render(options);
```

完整可运行示例见独立项目的 `miniapps/app-launcher/` 与 `miniapps/launch-target/`。

### 7.2 `ant.serve`：让宿主反过来调你

需要 `service` 权限。把一段逻辑跑成宿主眼里的**本地 HTTP 服务**——弹幕聚合就是这么接进
播放器的。

```js
ant.serve(async (req) => {
  // req = { method, path, query, params, headers, body, url }
  if (req.path === '/api/v2/search/episodes') {
    return { status: 200, headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(await search(req.params.anime)) };
  }
  return { status: 404, body: 'not found' };
});
```

`req.path` 已剥掉宿主的令牌与前缀，是干净的业务路径；`req.url` 是拼好的完整地址，
Worker 风格的代码可以直接 `new URL(req.url)`。返回标准 `Response`、
`{status,headers,body|bodyBase64}` 或裸字符串都认；返回 `null` 宿主收到 503。

宿主侧用 **`miniapp://<appId>[/path]`** 引用（真地址的端口和令牌每次启动都变，所以存的是
逻辑地址）。要点：

- 宿主**会在用户没打开小程序时把它后台拉起**，所以 handler 必须能在页面不可见时工作；
- 单次 60s 超时，请求体 ≤1MB；
- 服务型实例在保活上限（3 个）里排最后被回收，不会被随手开的小程序挤掉；
- 用户手动结束实例就断服，调用方按「服务不可用」处理；
- **dev server 测不了**（没有 loopback 服务），只能装成 zip 验。

**共享到局域网**：小程序详情页、或「小程序设置 → 局域网共享」里可以开（默认关），
宿主另起一个绑 `0.0.0.0:9321` 的服务，给出 `http://<本机IP>:9321/<lanToken>`：

- 多个服务能同时开，共用这一个端口，靠各自的 token 区分；
- token 持久化，重启地址不变；「重置地址」换掉它，旧地址立刻失效；
- 只暴露服务路由，**包内文件碰不到**；来源不是私有网段直接 403；
- 那个 token 就是唯一凭证，公共 WiFi 下开等于把你的服务（含出网能力）交给同网段所有人。

现成例子：`danmu_api` 仓库的 `miniapp/`（`build-miniapp.js` 打包）。

### 7.3 Node.js 后端服务：`node` 块 + `node` 权限

`ant.serve` 跑在 WebView 里，写不了文件、装不了 npm 依赖。服务本身是 Node 程序时
（express/fastify、node_modules、原生依赖），把它打进包、在 manifest 里声明 `node` 块，
宿主会用**内嵌 node（worker_threads）**把 `server/index.js` 当独立 worker 跑——
需要支持 Node 服务的宿主版本。

```json
{
  "permissions": ["node"],
  "node": { "entry": "server/index.js", "config": "server/index.config.js" }
}
```

脚手架一键生成骨架（server 契约、`/check` 就绪口、`catServerFactory` 都预置好了）：

```bash
python3 scripts/new_miniapp.py --app-id com.foo.svc --name 我的服务 --node
```

服务端契约与要点：

- `server/index.js` **必须导出 `start(config)`**，可另导出 `stop()` 做清理；`config`
  来自 `index.config.js`（或 `node.config` 指定的文件），都没有则收到 `null`；
- 监听端口用 `process.env.DEV_HTTP_PORT`，**不要写死**；`/check` 返回 200 是宿主的
  就绪探测；经 `globalThis.catServerFactory` 起服务，宿主能立刻感知监听状态；
- 包内可带 `node_modules/`（上限 200MB / 10000 文件，预检与打包都不会跳过它）；
- 寻址与 `ant.serve` 一样填 **`miniapp://<appId>[/path]`**，不需要 `service` 权限；
  宿主按需自启，小程序详情页可手动启停；升级/卸载时宿主先停 worker 再动目录；
- Android x86 模拟器没有内嵌 node，那里按「无可用服务」处理；
- 完整说明见开发引导 §4.11，示例 `miniapps/node-demo/`。

### 7.4 Python 后端与函数调用

```bash
python3 "$SKILL/scripts/new_miniapp.py" --app-id com.example.python --name Python示例 --python
python3 "$SKILL/scripts/dev_python.py" miniapps/python --port 3000
```

manifest 需要 `"permissions": ["python"]` 与 `"python": {"entry": "app.py"}`。入口文件的
**顶层函数**由 `await ant.python.call('hello', {name:'读者'}, 2)` 调用，返回值必须可 JSON 序列化。
只做函数调用不需要 `serve`、`service`、`network` 权限；Python 采集 requests 的域名和超时自己控制。

提供 HTTP 服务时导出 `serve(request)` 或可调用的 Flask/WSGI `app`；**不要 app.run()、不要自建端口**。
宿主用 `miniapp://<appId>[/path]` 按需加载；局域网共享通过宿主服务路由转发，同样无需 `service` 权限。
运行时共享同一 CPython，包内模块按 `__file__` 父目录寻址，避免通用 `import app/utils` 的模块缓存碰撞。
完整契约、依赖、正文采集适配和错误处理见 [references/python.md](references/python.md)。
示例：`miniapps/python-demo/`（最小调用）、`miniapps/sudugu-reader/`（小说阅读）。

## 8. 排查

| 现象 | 原因 |
|---|---|
| 白屏 + 404 | 用了绝对路径引用 |
| `window.ant is undefined` | 宿主里＝注入失败（看日志面板）；浏览器里＝忘了引 `ant-mock.js` |
| 调试模式正常，装包后 `PERMISSION_DENIED` | `manifest.permissions` 漏声明（调试模式权限全开） |
| 安装报 `MISSING_MANIFEST` | zip 里多套了一层目录，或压的是父目录 |
| 安装报 `ENTRY_MISSING` / `UNSAFE_PATH` | `entry` 路径写错 / 包里有 `../` 条目 |
| 安装报 `INVALID_ENTRY` / `FORBIDDEN_ENTRY_HOST` | `entry` 用了 http/https 之外的协议 / 在线入口指向本机或内网 |
| 在线站点点站内链接弹「离开小程序」 | 那个域名没写进 `network.allowlist` |
| 在线站点布局缺块或功能异常 | 可能被广告规则误伤；关闭「在线网站广告过滤」，结束实例后重开验证 |
| `miniApp.open` 报 `APP_NOT_INSTALLED` | 先安装目标 appId；API 不负责下载或静默安装 |
| `miniApp.open` 报 `NOT_FOREGROUND` / `BUSY` | 只在当前可见页由用户触发；等待上一次确认结束 |
| 装了新版还是老的 | `versionCode` 没递增 |
| 数据莫名清空 | 改过 `appId`（等于换了一个小程序），或经历过卸载 |
| 背景透出宿主壁纸 | 没设 `body { background }` |
| TV 上遥控完全没反应 | 没实现 `ant.tv.onKey` |
| 采集源报 `TOO_MANY_REQUESTS` | 并发超过 3，把请求串行化 |
| 宿主调 `miniapp://` 时报服务不可用 | 没声明 `service`；或没调 `ant.serve`；或页面脚本还没跑完（宿主会等，但有上限）；或用的是 dev server 实例 |
| `ant.serve` 的 handler 在后台时不干活 | 依赖了 `requestAnimationFrame` / DOM / 用户点击——离屏时这些都不成立 |
| 局域网地址在别的设备上 404 | token 被「重置地址」换过；或那个小程序的共享已关 |
| 局域网地址返回 403 | 请求方不在私有网段（走了公网回环、或经过了某种转发） |
| `PYTHON_ENTRY_MISSING` | 只有 python 权限，未声明 python.entry，或入口没打进包 |
| `PYTHON_RUNTIME_UNAVAILABLE` | 设备不支持内嵌 Python（Android x86 不支持）、运行时缺失、入口导入失败；看宿主日志 |
| `PYTHON_CALL_FAILED` | 入口没有该顶层函数、参数个数不匹配、异常或返回值不是 JSON；业务错误可返回 error 对象让页面展示 |
| Python 本地能跑、宿主报 ImportError | 本机装了宿主没有的依赖，或带了本机编译的原生扩展；不会自动 pip install |
| 多个 Python 小程序互相串状态 | 共用 sys.modules 或通用模块名；按包路径加载模块，不把命名空间隔离当进程沙箱 |

其余错误码见 `$SKILL/references/jsapi.md` 的错误码表。

## 参考资料

**`$SKILL/references/jsapi.md`** —— skill 自带的完整参考，脱离宿主仓库也能查：manifest 全字段、
权限表、每个 API 的签名与返回结构、事件表、错误码表、硬限制、市场 JSON 分发、mock 与真机差异，
以及一份**搜索→详情→取播放地址→调起播放器**的完整看片链路示例（字段约定按宿主实际返回的形状写的）。
第 7 节速查不够用时读它，别凭记忆写 API。

在宿主仓库里时，还可以读这些（可选，更细）：

- `docs/miniapp/miniapp-developer-guide.md` · `miniapp-standalone-dev.md` · `2026-09-01-miniapp-design.md`
- `assets/miniapp/demo/` — 覆盖全部 JSAPI 的最小示例
- `assets/miniapp/emby/` — 多页面 + 采集源 + 播放 + 续播的实战示例
- 独立示例仓库的 `miniapps/app-launcher/`、`launch-target/`、`web-links/`、`online-site/`
- `assets/miniapp/ant-sdk.js` 与 `lib/miniapp/bridge/` — 当前 SDK 真实现，行为有疑问时以它们为准
- `lib/python/spider_runner.py`、`spider_server.py`、`lib/miniapp/services/mini_app_python_service.dart` — Python 实际加载/路由契约

维护提醒：宿主的 `ant-sdk.js` 加了新 API 时，同步更新本 skill 的 `assets/ant-mock.js`、
`references/jsapi.md`，以及两个脚本里的权限表——`scripts/check_miniapp.py` 的 `KNOWN_PERMS`
与 `PERM_OF`、`scripts/new_miniapp.py` 的 `KNOWN_PERMS`。加了新权限时别漏 `new_miniapp.py`，
不然 `--permissions` 会拒掉它。
