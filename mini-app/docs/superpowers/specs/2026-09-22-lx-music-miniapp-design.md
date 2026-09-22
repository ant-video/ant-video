# LX Music 小程序（Node 服务）设计

- 日期：2026-09-22
- 目标产物：`mini-app/miniapps/lx-music-node/`
- 上游：`github.com/XCQ0607/lxserver` @ `7832abfb637443588f76973aefc69c5adcf63de1`（v2.1.0）

## 1. 背景与目标

做一个跑在 flutter_ant_video 宿主里的小程序，把 lxserver（LX Music 同步服务器的增强分支）的
**Web 播放器 UI** 和 **音乐爬虫引擎**搬进来，让用户在小程序里：

1. 配置一个 lx 音源 js 的地址（或直接粘贴脚本文本）；
2. 由小程序拉起一个 LX 音源运行时（沙箱），解析该脚本并对外提供取流能力；
3. 用照搬自 lxserver 的界面完成 搜索 → 播放 → 歌词 的完整体验。

### 1.1 必须先纠正的一个前提

LX 音源协议**不包含搜索**。音源 js 只负责 `musicUrl`（可选的 `lyric`/`pic`），
调用形态是 `handler({ action: 'musicUrl', source, info: { musicInfo, quality, type } })`，
返回一个可播放的 URL 字符串。

lxserver 的分工是：

| 能力 | 来源 |
|---|---|
| 搜索、歌单、排行榜、歌手、专辑、歌词、封面 | lxserver 自己 fork 的桌面版爬虫 `src/modules/utils/musicSdk/{kw,kg,tx,wy,mg}/`（**不经过音源**） |
| 可播放地址 `musicUrl` | 音源 js（`src/server/userApi.ts` 的沙箱），多源兜底重试 |

所以「配置音源地址就能启动 lx 爬虫服务」这个说法只对取流那一环成立；**搜索必须靠移植
`musicSdk` 才能有**。本设计按此实现。

## 2. 范围

### 2.1 做

- 搜索（5 平台：酷我 kw / 酷狗 kg / QQ tx / 网易 wy / 咪咕 mg）
- 歌单、排行榜、歌手、专辑
- 取流（音源 js，多源兜底）
- 歌词（逐字 `lxlyric`）、封面
- 页面内 `<audio>` 播放：歌单连播、底部播放条、逐行歌词、播放模式、可视化
- 音源管理：填 URL / 粘贴脚本、启用停用、排序、删除、逐源错误状态
- 流代理（注入 UA/Referer，支持 Range）

### 2.2 不做（YAGNI，明确排除）

下载管理、本地音乐、自定义目录、Subsonic、WebDAV、elFinder、用户登录与鉴权、
服务端缓存与 ID3 打标（连带 `music-tag-native` 原生依赖）、分享成图、音效与变调、
PWA、LX 客户端数据同步（WebSocket 同步协议）、NoSleep、管理控制台。

## 3. 关键宿主事实（已读源码验证）

`mini-app/` 仓库里的文档在回环地址这一点上是**过期的**，以下结论以宿主源码为准。

来源：`flutter_ant_video/lib/miniapp/bridge/api_basic.dart`

1. **回环地址全局放行**。`_validateRequestUri()`（约 367 行）里有：
   `if (MiniAppHostPolicy.isLoopback(uri.host)) return uri;`
   且**不受 `network.allowlist` 限制**。注释原文：「回环全局放行（兄弟小程序服务、宿主本地服务），
   且不受 allowlist 限制。」所以 `ant.request` 可以访问 `127.x`。
2. **页面可以调用自己的 Node 服务**。`_request()`（189 行）先调 `_resolveServiceUrl()`
   （337 行），把 `miniapp://<appId>[/path]` 解析成
   `http://127.0.0.1:<port>/<token>/__service<path>`，再交给 `_validateRequestUri` 接住。
   `migu-video-node/README.md` 里「页面不允许访问自己的服务」是基于旧宿主的结论，**不再成立**。
3. **`miniapp://` 需要 `miniapp` 权限**。`_resolveServiceUrl` 里若 manifest 未声明
   `MiniAppPermission.miniApp`，直接抛 `PERMISSION_DENIED`。
4. **响应里带真地址**。`ant.request` 的返回值含 `url` 字段（`response.realUri.toString()`），
   即解析后的真地址。这是页面拿到引擎 base 的唯一途径。
5. **`ant.request` 的硬限制**：响应体上限 10MB（`maxResponseBytes`），超时上限 30 秒
   （`maxTimeout`）。
6. **`<audio>` 不受上述限制**。它是 WebView 自己的媒体加载，不走 `ant.request`，
   所以长音频不会被 30 秒或 10MB 砍断。
7. **Node 服务契约**：`server/index.js` 导出 `start(config)`（可选 `stop()`），监听
   `process.env.DEV_HTTP_PORT`（不得写死），经 `globalThis.catServerFactory(handler)` 建服务
   （宿主能立刻感知监听状态），`/check` 返回 200 作为就绪探测。**只声明 `node` 即可对外提供服务**，
   不需要 `service` 权限。
8. **`entry` 支持子目录**。预检只校验 `(root / entry).is_file()`，所以 `web/index.html` 合法。

## 4. 架构

四个组件，边界清楚：

```
┌─────────────────────────────────────────────────────┐
│ 页面（WebView）— 搬来的 lxserver 播放器 UI           │
│   fetch(API_BASE + '/api/music/...')                │
│   <audio src=API_BASE + '/api/stream?...'>          │
└───────────────────────┬─────────────────────────────┘
                        │ http://127.0.0.1:<port>/<token>/__service/...
                        │ （跨源，引擎回 CORS）
┌───────────────────────▼─────────────────────────────┐
│ Node 服务 / 路由层                                    │
│   /check  /api/music/*  /api/lx/*  /api/stream       │
│   · 兼容层：形状对齐 lxserver，前端网络层不用改        │
│   · 流代理：原生 http/https（Range、UA/Referer 注入）  │
└──────┬──────────────────────────────┬───────────────┘
       │                              │
┌──────▼───────────────┐   ┌──────────▼──────────────┐
│ ③ 音源运行时 (vm2)    │   │ ④ 爬虫引擎 musicSdk      │
│   注入 lx 对象        │   │   搜索/歌词/封面/歌单/    │
│   只被调 musicUrl     │◄──┤   排行榜（取流经         │
│   3s inited / 10s 超时│   │   api-source.js 接缝）   │
└──────────────────────┘   └─────────────────────────┘
```

### 4.1 组件职责

- **页面**：只做渲染与交互。网络层保持 lxserver 原样（`fetch('/api/music/...')`），
  仅把 `API_BASE` 从写死的 `'/api/music'` 改为读 `window.__LX_API_BASE__`。
- **Node 服务 / 路由层**：自己写薄的，**不碰** lxserver 那 8233 行的 `server.ts`。
  三块职责：就绪口、`/api/music/*` 兼容层、`/api/lx/*` 音源管理；外加流代理与 CORS。
- **音源运行时**：`userApi.ts` 的等价移植。vm2 沙箱，注入 `lx` 对象
  （`EVENT_NAMES`/`request`/`on`/`send`/`env`/`version`/`utils`），3 秒等 `inited`、
  10 秒脚本超时。脚本只被调用 `musicUrl`。
- **爬虫引擎**：`musicSdk` 原样移植。取流时经 `api-source.js` 这个**上游已有的接缝**
  （该文件已被 lxserver 改造为服务端版本，去掉了 `@renderer/store` 依赖，并用
  `require('../../../server/userApi')` 懒加载）回调到音源运行时。

### 4.2 目录结构

产物按 `logvar-danmu-node` 的构建流水线模式组织：`src/` 是源码，`build-miniapp.mjs`
用 esbuild 产出 `dist/miniapp-node/`，**打包 zip 的是 dist**。

```
mini-app/miniapps/lx-music-node/
├─ src/
│  ├─ web/                    页面（搬自 lxserver public/music/）
│  │  ├─ index.html  css/  js/  assets/  vendor/fonts/
│  │  └─ boot.js              新增：引擎地址发现 + 注入 API_BASE + 降级页
│  └─ server/
│     ├─ index.js             宿主契约 shell：start/stop、/check
│     ├─ index.config.js
│     ├─ engine/
│     │  ├─ router.js         /api/music/* 与 /api/lx/* 路由
│     │  ├─ source-runtime.js vm2 沙箱、音源加载与生命周期
│     │  ├─ sources-store.js  音源列表持久化
│     │  └─ stream-proxy.js   原生 http/https 流代理（Range）
│     └─ vendor/              移植自 lxserver，尽量一字不改
│        ├─ musicSdk/         ~90 个 js（上游 620K）
│        ├─ request.js        上游 src/modules/utils/request.js
│        ├─ options.js        上游 src/modules/utils/options.js
│        ├─ message.js        上游 src/modules/utils/message.js
│        ├─ utils.js          上游 src/modules/utils/index.js
│        │                   （musicSdk 里 `from '../../index'` 指的是它）
│        └─ userApi.js        由上游 src/server/userApi.ts 编译而来
├─ build-miniapp.mjs          esbuild → dist/miniapp-node/
├─ README.md
└─ dist/miniapp-node/         打包 zip 的就是它
```

`vendor/` 下的文件**尽量一字不改**，以便日后写 sync 脚本、凭上游 commit 重新同步，
而不用重新理解一遍。

**唯一的必要改动**：`musicSdk/api-source.js` 里有一句懒加载
`require('../../../server/userApi')`，在我们的目录布局下解析不到。这一句必须改指向
音源运行时，并在文件头注释里标注「本地改动」及原因，sync 时按注释重新施加上去。

同理，音频流代理与音源脚本的缓存目录统一放 `server/data/`（包内，升级时随包目录一起被替换，
所以它只是缓存，**不是真源**——见 7.4）。

## 5. 数据流

### 5.1 启动与引擎地址发现

1. 宿主加载 `web/index.html`（包内静态文件）。
2. `boot.js` 发 `ant.request({ url: 'miniapp://<appId>/check' })`。这一步会**按需把 Node
   服务拉起**（宿主行为，总超时 20 秒）。
3. 从返回值的 `url` 字段取得解析后的真地址
   `http://127.0.0.1:<port>/<token>/__service/check`，剥掉尾部 `/check` 得到 `API_BASE`。
4. 注入 `window.__LX_API_BASE__`，再启动 lxserver 的 `app.js`。
5. 失败 → 降级页：显示原因 + 重试按钮 + **手填引擎地址输入框**。

**跨源说明**：页面在 `127.0.0.1:<宿主端口>`，引擎在 `127.0.0.1:<服务端口>`，
**不同端口即跨源**。引擎必须回 `Access-Control-Allow-Origin: *` 并处理 `OPTIONS` 预检
（带 `Content-Type: application/json` 的 POST 必然触发预检）。

手填引擎地址是**正式功能**而非隐藏后门：它同时是开发模式入口（见 9.2），
也允许用户指向电脑上跑的独立引擎。

### 5.2 音源加载

1. 页面从 `ant.storage` 读音源列表。
2. `POST /api/lx/sources` 推给引擎。
3. 引擎对每个启用的音源：取脚本（缓存命中用缓存，否则按 URL 下载）→ vm2 沙箱执行 →
   等 `inited` 拿到 `{ sources: {kw,kg,tx,wy,mg}, ... }` 及各平台 `qualitys`。
4. 引擎回报「已就绪的音源 + 各平台可用音质」给页面。

同一 `appId` 的音源脚本只执行一次，缓存在内存。

### 5.3 搜索

`GET /api/music/search?name=&source=kw&page=1` → 路由层 →
`musicSdk[source].musicSearch.search(name, page, PAGE_SIZE)` → needle 请求 →
归一化成 lxserver 的响应形状。**搜索完全不经过音源。**

### 5.4 取流

`POST /api/music/url { source, musicInfo, quality }` →
`musicSdk[source].getMusicUrl()` → `api-source.js` 的 `apis(source)` →
音源运行时 `callUserApiGetMusicUrl` → 沙箱内
`handler({ action: 'musicUrl', source, info: { musicInfo, quality, type } })` → URL 字符串。

`musicInfo` 在交给音源前要先归一化（上游 `normalizeSongInfo` + 字段提升）：
`meta.songId → songmid`、`meta.picUrl → img`、`meta.qualitys → types`，
以及 `hash`（kg）、`copyrightId`/`lrcUrl`/`mrcUrl`/`trcUrl`（mg）、
`strMediaMid`/`albumMid`（tx）、`albumId`、`name`、`singer`、`interval`、`source`、`id`。

同一平台有多个音源支持时按 `order` 顺序兜底重试。

### 5.5 流代理

音源返回的直链普遍要校验 UA/Referer，而 `<audio>` **不能**设置请求头。所以页面播放的 src 是：

```
API_BASE + '/api/stream?u=' + encodeURIComponent(直链) + '&h=' + base64(headers)
```

引擎按 `headers` 转发，边下边回。

**Range 是硬要求**：`<audio>` 拖动进度条会发 `Range` 请求，代理必须原样透传并回
`206 Partial Content`（带 `Content-Range`/`Accept-Ranges`），否则一拖就断。
needle 做流式转发不合适，**这一层直接用 Node 原生 `http`/`https` 实现，不走 needle**。

因此引擎内**有两套 HTTP**：needle 供 `musicSdk` 与音源使用（上游代码不动），
原生模块供流代理使用。这是有意的，不是疏漏。

`h` 参数承载的是我们自己下发的 headers，需校验以免变成任意请求伪造（见 8.4）。

### 5.6 歌词

优先 `musicSdk` 自带歌词；音源若返回 `lyric`/`tlyric`/`rlyric`/`lxlyric` 则作为兜底。
归一化成 lxserver 的形状，交给页面的 `lyric-parser.js` 处理逐字歌词。

### 5.7 播放

音频由 WebView 直接播放（`<audio src=API_BASE + '/api/stream?...'>`），
**不经过宿主播放器**（未声明 `player` 权限）。因此不受 `ant.request` 的 10MB/30s 限制。

## 6. 引擎 HTTP 接口

### 6.1 宿主契约

| 路径 | 说明 |
|---|---|
| `GET /check` | 就绪探测，必须快速返回 200。**任何懒加载之前**短路返回 |

### 6.2 兼容层 `/api/music/*`（形状对齐 lxserver）

实现：`config`、`search`、`tipSearch`、`url`、`lyric`、`pic`、`songList/{tags,list,detail}`、
`leaderboard/{boards,list}`、`artistDetail`、`artistSongs`、`artistAlbums`、`albumSongs`、
`hotSearch`、`dislike[/add|/remove]`。
共享响应形状与 lxserver 保持一致，这是前端网络层不用改的前提。

**未实现的接口统一返回 `501`**，让前端的既有错误处理接管。

### 6.3 音源管理 `/api/lx/*`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/lx/sources` | 列出音源（含状态：就绪/报错/停用） |
| `POST` | `/api/lx/sources` | 覆盖式同步音源列表（页面推 `ant.storage` 里的真源） |
| `POST` | `/api/lx/sources/import` | 导入：`{ url }` 或 `{ script, name }` |
| `POST` | `/api/lx/sources/toggle` | 启用/停用 |
| `POST` | `/api/lx/sources/reorder` | 排序 |
| `DELETE` | `/api/lx/sources/:id` | 删除 |
| `GET` | `/api/lx/status` | 引擎状态：音源就绪情况、平台与音质矩阵 |

### 6.4 流代理

`GET /api/stream?u=<直链>&h=<base64(headers)>` — 支持 Range。

## 7. 音源运行时

等价移植 lxserver 的 `src/server/userApi.ts`。

### 7.1 沙箱

- 用 **vm2**（纯 JS，可 esbuild 打包；上游默认走这条，原生 `vm` 需管理员开关，不移植）。
- 注入的 `lx` 对象：
  - `version`、`env: 'desktop'`、`platform: 'web'`、`currentScriptInfo`
  - `EVENT_NAMES = { request, inited, updateAlert }`
  - `utils`：`buffer`、`crypto`(md5/aes/rsa/randomBytes)、`zlib`(inflate/deflate)
  - `request(url, options, cb)` —— 基于 needle 的回调风格，`follow_max: 5`，
    响应超时上限 60 秒，`(err, resp, body)`，`body` 能 JSON 解析时就解析
  - `send(eventName, data)` —— `inited` 登记音源并 resolve；`updateAlert` 不采用（视为无更新）
  - `on(eventName, handler)` —— 只受理 `request`
- 时限：脚本执行 **10 秒**；`inited` 等待 **3 秒**，超时报
  `初始化超时，请确保脚本调用了 lx.send("inited", ...)`。
- 每个跨边界的值都要 `decontextify()` 深拷贝，切断 Proxy 链。

### 7.2 加载来源

两种输入（宿主**没有文件选择器 API**，所以只有这两种）：

1. **URL** —— 下载脚本正文，缓存到包内 `server/data/`。
2. **粘贴文本** —— 直接存正文。

### 7.3 触发时机

`callUserApiGetMusicUrl(source, songInfo, quality)` 由 `api-source.js` 的 `apis(source)`
调用。若没有支持该平台的音源，抛
`未找到支持 <source> 平台的自定义源，请在设置中添加或启用相关源`。

### 7.4 持久化

**页面 `ant.storage` 是配置的真源**，存音源列表（脚本正文或 URL）、启用状态、顺序、收藏歌单；
Node 服务把脚本缓存到包内 `server/data/`，冷启动时由页面重新推送对齐。

理由：包目录在**升级时会被替换**，而 `ant.storage` 不会；反过来 `ant.storage` 只有 5MB、
且页面未加载时引擎看不到配置。所以两边都要，**以 `ant.storage` 为准**。

## 8. 错误处理与降级

按用户可感知程度排序：

1. **未配置音源（最重要）** —— 引擎起来但音源为空时，搜索/歌词/封面照常（走 `musicSdk`），
   **只有取流会失败**。必须明确提示「未配置音源，去设置里添加」，绝不能给一个点了没反应的播放器。
2. **引擎起不来** —— `boot.js` 发现地址失败（超时/未装/服务崩）→ 降级页 + 重试 + 手填地址。
3. **音源脚本出错** —— 3 秒没 `inited`、脚本抛异常、URL 下不下来：在音源管理页**逐源**显示
   错误状态，**一个源坏不影响其它源**。
4. **取流失败** —— 多源兜底重试；全失败则提示并跳到下一首。
5. **直链过期** —— 音源直链普遍有时效，长歌播到一半会 403。**必须实现自动重新取流并续播**
   （记录当前进度，重取后 seek 回去）。这是最容易被漏掉的一条。

### 8.1 流代理的安全校验

`/api/stream` 的 `u` 与 `h` 由页面下发，必须限制：

- `u` 只允许 `http`/`https`，且**拒绝回环与私有网段**（否则该接口就成了内网探测跳板）；
- `h` 只允许 `Referer`/`User-Agent`/`Cookie`/`Origin` 等白名单头，值长度上限；
- 响应大小不设上限（音频流需要），但要有空闲超时。

## 9. 前端集成

### 9.1 搬运与裁剪

**避让 manifest 撞车**：lxserver 的 `public/music/manifest.json` 是 **PWA 清单**，
而小程序包根的 `manifest.json` 是**小程序清单**，直接搬会撞车。所以网页文件全部放进
`web/` 子目录，`manifest.entry` 指向 `web/index.html`，根目录留给小程序自己的 `manifest.json`。

- **搬**：`public/music/` 的 `index.html`、`css/`(theme_variables + app)、`js/`(~25 个模块)、
  `assets/`(tailwind 运行时、FontAwesome、logo)，外加 `public/vendor/fonts/` 的 Inter 字体。
- **不搬**：管理控制台（`public/index.html` + 195KB `app.js` + `style.css`）、
  `filemanager.html`、`login.html`。

### 9.2 裁剪策略：先隔离，后删除

**第一版不对 `app.js` 做手术。** 它是 690KB / 约 1.6 万行的单体文件，下载、本地音乐、
缓存逻辑与播放逻辑缠在一起，硬剪风险高，剪错了要到装包后才发现。

所以第一版**只隔离不删除**，靠两件事让缺失能力优雅降级：

1. 引擎对未实现的接口统一回 `501`，前端本就有错误处理；
2. 打包时注入 feature flag 表
   （`window.__LX_FEATURES__ = { download:false, localMusic:false, ... }`），
   用一小段启动脚本隐藏对应入口按钮。

跑通并装包验证后，**再做第二轮的代码减法**，那时删错了也能立刻在真机上看到。

这样第一版的交付风险集中在「引擎能否跑通」与「装包后 `miniapp://` 能否解析」两件真正未知的
事情上，而不是耗在删代码的体力活上。

### 9.3 新增的页面逻辑

- `web/boot.js`：引擎地址发现、注入 `API_BASE`、降级页、手填地址输入框。
- **音源管理 UI**：复刻 lxserver 设置页的音源管理（列表/启用/排序/删除），
  把「上传文件」换成**填 js 地址**与**粘贴脚本文本**两种输入。

## 10. 测试与验证策略

分三层，因为宿主的限制决定了每层能验到什么。

### 10.1 引擎层（本机 Node，主战场）

引擎必须能独立 `node server/index.js` 启动，于是可以直接 curl + 写断言。
**TDD 在这一层做**，覆盖：

- 搜索结果的归一化形状
- 音源沙箱：`inited` 超时、脚本抛异常、多源兜底顺序、错误隔离
- Range 代理：`206` / `Content-Range` / 断点续传
- 音源持久化与冷启动对齐
- `/api/stream` 的 `u`/`h` 校验（拒绝内网、拒绝非白名单头）

**测试夹具**：自己写一个最小的 `lx` 协议假音源脚本，**不依赖外网和真音源**，测试才稳定。
`musicSdk` 的真实网络请求在 needle 层打桩，否则测试会因外网波动而假失败。

### 10.2 页面层（浏览器 + ant-mock）

本机独立引擎 + 手动指向地址（回环已放行，浏览器里能跑通完整交互）。
这是 90% 前端调试的地方。需要给 `ant-mock.js` 补一个 `ant.request` 的 mock。

### 10.3 装包验证（真机）

只能验三件事，且**这三件调试模式一件都测不了**（dev server 实例没有 loopback 服务）：

1. `miniapp://` 解析；
2. Node 服务启停；
3. `<audio>` 切后台的实际行为。

所以第一次装包不是「验收」而是「探索」。

## 11. 构建与发版

```
build-miniapp.mjs                 esbuild 把 src/server/ 打成 bundle
  → dist/miniapp-node/
check_miniapp.py dist/miniapp-node   ERROR 必须清零
pack_miniapp.py  dist/miniapp-node
  → market/zip/lx-music-node-v<versionCode>.zip
  → 更新 market/market.json 的 size / md5
```

`versionCode` 沿用 `logvar-danmu-node` 的 `major*10000 + minor*100 + patch`。
每次发版必须递增，它是宿主识别升级的**唯一**信号。

### 11.1 清单

```json
{
  "appId": "com.leospring.lx_music_node",
  "name": "LX Music",
  "version": "1.0.0",
  "versionCode": 10000,
  "renderer": "webview",
  "entry": "web/index.html",
  "permissions": ["node", "ui", "storage", "network", "miniapp"],
  "node": { "entry": "server/index.js", "config": "server/index.config.js" }
}
```

**`miniapp` 权限必须有**：`ant.request` 解析 `miniapp://` 时会校验它，漏了直接
`PERMISSION_DENIED`。**不需要 `service`**（声明 `node` 即对外提供服务），
**不需要 `player`**（页面内播放）。

### 11.2 工程清理

删除上次遗留在 `mini-app/skills/miniapps/lx-video-node/` 的空脚手架 ——
放错了目录（应在 `miniapps/` 下），`appId` 语义也不对（`lx_video_node`），
且只声明了 `service`、没有 `node` 块与 `server/`，`app.js` 还是模板样板。
它从未发布，换掉零成本。

## 12. 已知风险

| 风险 | 影响 | 应对 |
|---|---|---|
| `<audio>` 后台/锁屏播放不保证 | 切后台可能停播 | 第一版接受；装包后实测，必要时再评估原生兜底 |
| 引擎与流代理只能装包后验 | 调试模式测不了 | 独立引擎模式承担绝大部分迭代；首次装包按「探索」对待 |
| Tailwind 407KB CDN 运行时 | WebView 首屏样式闪动 | 接受；必要时后续换预编译 CSS |
| `musicSdk` 的 `from '../../index'` 拉入 `src/modules/utils/index.js` | esbuild 可能带进多余模块 | 打包后用体积与 require 图核对 |
| 直链时效性 | 长歌中断 | 第 8 节第 5 条的自动重取 + 续播 |
| 上游 `musicSdk` 会随平台改版失效 | 搜索/歌词失效 | `vendor/` 保持原样 + 记录上游 commit，便于重新同步 |

## 13. 参考

- `flutter_ant_video/lib/miniapp/bridge/api_basic.dart` —— 回环放行、`miniapp://` 解析、请求限制
- `flutter_ant_video/lib/miniapp/services/mini_app_service_endpoint.dart` —— 地址解析实现
- `mini-app/.claude/skills/miniapp-dev/SKILL.md` 与 `references/jsapi.md` —— 小程序开发契约
  （注意其回环限制一节已过期）
- `mini-app/miniapps/logvar-danmu-node/` —— esbuild 构建流水线范例
- `mini-app/miniapps/migu-video-node/` —— Node 服务契约范例（`start`/`/check`/`DEV_HTTP_PORT`）
- lxserver `src/server/userApi.ts` · `src/modules/utils/musicSdk/api-source.js` ·
  `src/modules/utils/request.js` · `public/music/` —— 待移植的引擎与 UI
