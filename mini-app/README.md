# 蚂蚁影视 · 小程序

[蚂蚁影视](../README.md)宿主的小程序生态目录：开发文档、示例小程序、注入 SDK、市场分发清单，以及一套可供 Codex / Claude Code 使用的开发 skill。

小程序是纯 HTML/JS/CSS 包，跑在宿主容器的 WebView 里，通过宿主在 document-start 注入的
`window.ant` 调用宿主能力（播放器、采集源、存储、UI）。**写小程序不需要碰 Flutter，也不需要重新编译宿主。**

## 目录结构

```
mini-app/
├─ docs/
│  ├─ miniapp-developer-guide.md   开发引导：manifest、权限、JSAPI、打包发版
│  └─ miniapp-standalone-dev.md    脱离宿主开发调试：三阶段流程 + mock SDK 全文
├─ miniapps/
│  ├─ ant-sdk.js                   宿主注入的真 SDK（协议 v3，行为有疑问时以它为准）
│  ├─ demo/                        覆盖全部 JSAPI 的最小示例
│  ├─ app-launcher/                跨小程序打开的发起端
│  ├─ launch-target/               启动参数与 onOpen 的接收端
│  ├─ web-links/                   容器内导航与外部网站跳转
│  ├─ online-site/                 manifest-only 在线站点示例
│  ├─ cms-t4-bridge/               CMS JSON → T4 兼容反向服务
│  ├─ tetris/                      俄罗斯方块（纯前端游戏 + TV 遥控）
│  └─ emby/                        影视库（多页面 + 采集源 + 播放 + 续播）
├─ market/
│  ├─ market.json                  市场清单，用户在宿主「市场」Tab 填它的地址
│  └─ zip/*.zip                    各小程序的安装包
└─ skills/miniapp-dev/             Claude Code skill：脚手架 / mock SDK / 预检 / 打包
```

## 示例小程序

| 小程序 | appId | 权限 | 看点 |
|---|---|---|---|
| **示例小程序** `miniapps/demo/` | `com.leospring.demo` | ui / storage / network / navigate / miniapp / player / source | 一屏按钮逐个试 SDK v3 常用 `ant.*`（含二进制响应与跨小程序打开） |
| **小程序启动台** `miniapps/app-launcher/` | `com.leospring.launcher` | ui / miniapp | 发起 `miniApp.open`，演示用户取消、未安装错误、指定 path 与 JSON params |
| **启动参数接收器** `miniapps/launch-target/` | `com.leospring.launch_target` | ui / storage / navigate | 接收 `onOpen`、读取 `getLaunchOptions`，支持保活复用与详情页落地 |
| **网页跳转示例** `miniapps/web-links/` | `com.leospring.web_links` | ui / navigate | 对比同源容器导航、外部 HTTPS 网站和系统协议的确认流程 |
| **在线站点示例** `miniapps/online-site/` | `com.leospring.online_site` | — | 只有 manifest，直接包装 HTTPS 站点并使用宿主广告过滤 |
| **CMS 转 T4 服务** `miniapps/cms-t4-bridge/` | `com.leospring.cms_t4_bridge` | ui / storage / network / service | 配置多个 CMS JSON 接口，按 `site` 提供 T4 首页、分类、搜索、详情和 `config` 接口，页面给出可复制的内部与局域网地址 |
| **俄罗斯方块** `miniapps/tetris/` | `com.leospring.tetris` | ui / storage / navigate | 掌机复刻，Web Audio 音效 + LCD 光影；自带 `ant-mock.js`，浏览器里直接能玩 |
| **影视库** `miniapps/emby/` | `com.leospring.emby` | ui / storage / navigate / player / source | Emby 风格四页面（首页 / 媒体库 / 搜索 / 详情），复用宿主已配置的采集源，续播记录存 `ant.storage` |

示例都以 `com.leospring.*` 命名，与宿主内置的 `com.ant.*` 分开 —— appId 是唯一键，撞了会被当成同一个小程序。体验跨小程序链路时先安装“启动参数接收器”，再打开“小程序启动台”。

市场清单里还有一个 **LogVar 弹幕服务**（`com.logvar.danmu`），它演示的是**服务型小程序**：
整个弹幕聚合服务跑在小程序里，播放器直接从它取弹幕，不用再自己部署 vercel / docker。
源码不在本仓库，在上游 [huangxd-/danmu_api](https://github.com/huangxd-/danmu_api) 的 `miniapp/`
目录（AGPL-3.0，包内附 `LICENSE` 与 `SOURCE.md`）。做法见下面的「服务型小程序」一节。

`demo` 里没有 `ant.serve` 的按钮 —— 声明 `service` 权限会让小程序被宿主后台拉起，
对一个纯演示包不合适。要看活例子就装弹幕服务。

### CMS 转 T4 服务

安装 `cms-t4-bridge` 后，在小程序页面添加多个 CMS JSON 接口，为每个接口设置唯一 `key`、显示名称和地址。
它会注册一个后台服务，应用侧使用按站点区分的 T4 地址（站点走路径，后面能直接接 `?ac=…`；
`?site=站点key` 的查询串写法同样受理）：

- `/site/站点key?filter=true`：CMS 首页转 T4 首页与分类
- `/site/站点key?t=分类ID&ac=videolist&pg=1`：分类分页，T4 的 `ext` 会转成 CMS 查询参数
- `/site/站点key?wd=关键词&pg=1`：搜索
- `/site/站点key?ac=detail&ids=影片ID`：详情
- `/site/站点key?flag=线路&play=播放地址`：将 CMS 选集中的直链转换为 T4 播放响应
- `/config` 或 `/api/config`：严格返回 `{ "sites": [{ "key", "name", "type": 4, "api", "searchable", "quickSearch", "filterable" }] }`
- `/health`：服务状态与已配置的站点数

省略站点时用小程序里设为默认的那个站点。

页面的「对外接口」面板直接给出可复制的地址，两种前缀切换：

- **宿主内部**：`miniapp://com.leospring.cms_t4_bridge/config`，供宿主自己的设置项和其它小程序引用
- **局域网**：把宿主「小程序设置 → 局域网共享」里的 `http://IP:9321/<lanToken>` 粘进面板，
  页面据此生成 `http://IP:9321/<lanToken>/config` 和每个站点的地址，给同网络的设备和第三方播放器用

`/config` 返回的 `api` 前缀跟着调用方来源走：局域网请求拿到局域网地址，宿主内部请求拿到 `miniapp://`，
也可以用 `?base=` 显式指定。局域网请求进来一次后，页面会自己认出那个地址（宿主没有读取它的 JSAPI）。

服务必须保持在宿主中安装且未被用户结束；需要给其它设备使用时，可在宿主的小程序详情里打开局域网共享——
地址里的 token 就是唯一凭证，别在公共网络里外传。

## 五分钟上手

最少三个文件：`manifest.json` + `index.html` + `app.js`。
**不要写 `<script src="ant-sdk.js">`** —— 宿主已在 document-start 注入。

**manifest.json**

```json
{
  "appId": "com.yourname.hello",
  "name": "Hello",
  "versionCode": 1,
  "entry": "index.html",
  "permissions": ["ui", "storage"]
}
```

**app.js**

```js
await ant.ui.toast('你好，小程序');
await ant.storage.set('clicked_at', new Date().toISOString());
```

用 skill 里的脚手架一步生成，硬规则（相对路径、`body` 背景、安全区、深色模式、TV 焦点、mock 权限自检）已预置：

```bash
python3 skills/miniapp-dev/scripts/new_miniapp.py \
  --app-id com.yourname.hello --name Hello --out miniapps/hello \
  --permissions ui,storage        # 缺省 ui,storage
```

装进宿主：小程序中心 → 右上角 `+` → 「导入 zip 包」（开发期可用「导入文件夹」跳过打包，
桌面与 iOS 可用；Android 分区存储读不到路径，那边还是用 zip）。

## 开发流程

宿主编译要几分钟、打包安装十几秒，**不要在宿主里写代码**。分三个阶段：

| 阶段 | 跑在哪 | 反馈速度 | 能验证 | 验证不了 |
|---|---|---|---|---|
| ① 纯浏览器 | Chrome/Safari + `ant-mock.js` | 刷新即可 | 布局、交互、业务逻辑 | 真实 JSAPI、权限、播放器、采集源 |
| ② 宿主调试模式 | 宿主容器直连你的 dev server | 点「重新加载」 | 全部真实能力、TV 遥控、真机表现 | manifest 校验与权限声明（调试模式权限全开且不读 manifest） |
| ③ 打包安装 | 宿主，正式安装 | 重新打包导入 | 安装校验、升级、卸载、分发 | — |

90% 的时间应该待在 ①。

```bash
# ① 必须走 HTTP，不能 file://
cd miniapps/hello && python3 -m http.server 3000

# ② dev server 绑 0.0.0.0，宿主 → 小程序 → 右上角 🐞 → 填 http://<局域网IP>:3000
python3 -m http.server 3000 --bind 0.0.0.0

# ③ 预检（ERROR 必须清零）→ 打包（附带 size/md5）
python3 skills/miniapp-dev/scripts/check_miniapp.py miniapps/hello
python3 skills/miniapp-dev/scripts/pack_miniapp.py  miniapps/hello
```

预检除了覆盖安装器的全部校验，还会**扫代码里实际调用的 `ant.*` 反查权限声明**、绝对路径引用、
`body` 背景缺失、TV 按键缺失 —— 这几项是调试模式测不出来的。有构建流程时检查 `dist/`，不是源码目录。

容器操作收在一个可拖动的**悬浮球**里：重新加载 / 日志 / 关闭。日志面板收了 JSAPI 调用与返回、
被拒的权限、`console.*` 与加载错误（前缀 `[APP]` `[API]` `[SYS]` `[ERR]`，可全部复制），真机上先看它。

## JSAPI 速查

全部返回 Promise，失败 reject 一个带 `code` / `api` 的 Error。方括号是所需权限，
**manifest 里没声明的能力一律 `PERMISSION_DENIED`**。大多数权限声明后直接可用；
`miniapp` 会把用户带到另一个应用，所以每次打开仍会展示目标名称让用户确认。

```js
ant.env.getSystemInfo()   // {platform,osVersion,isTV,appId,devMode,permissions,sdkVersion}  免权限
ant.log(msg)              // 免权限；console.* 也会进日志面板
ant.request({url,method,headers,data,timeout,responseType,followRedirects})
                          // → {statusCode,headers,data,responseType,url}            [network]
ant.requestJson({url})                          // 非 2xx / 非法 JSON 会 reject         [network]
ant.requestBytes({url}) · base64ToBytes(s)      // 二进制，→ Uint8Array                [network]
ant.storage.get/set/getJSON/setJSON/remove/clear/keys()                                 [storage]
ant.ui.toast/loading/hideLoading/confirm({title,content})/actionSheet([...])             [ui]
ant.clipboard.get/set(text)                                                             [ui]
ant.navigateTo/redirectTo(url) · navigateBack() · exitMiniApp()                         [navigate]
ant.miniApp.open({appId,path?,params?})                                                  [miniapp]
ant.miniApp.getLaunchOptions() · onOpen(fn)                                             [免权限]
ant.player.open({url,title,headers}) · getState() · onStateChange(fn) · onClose(fn)      [player]
ant.source.list() · home(siteKey) · category({siteKey,tid,page,ext})
         · detail({siteKey,id}) · play({siteKey,flag,id}) · search({siteKey,wd,page})    [source]
ant.serve(async req => resp)                    // 宿主反过来调你，见下一节          [service]
ant.on/off/once(event, fn) · onShow(fn) · onHide(fn) · tv.onKey(fn)
```

事件：`app.show`、`app.hide`、`miniApp.open`、`player.open`、`player.stateChange`、`player.close`、`keydown`。

`ant.request` 走宿主的 HTTP 客户端，**不受浏览器 CORS 限制** —— 这是相对纯 H5 的最大优势。
要拿原始字节就用 `responseType: 'base64'`（或 `ant.requestBytes`）：protobuf、gzip/brotli、
GBK 网页必须走这条，缺省的 `'text'` 会让宿主按 charset 解码，二进制经此一遭就毁了。

采集源返回宿主内部的 `vod_*` 蛇形字段；用户可能一个站点都没配，`list()` 要按空数组处理。
拿到 `source.play` 的地址接 `ant.player.open()` 就是一条完整的看片链路（自动复用 M3U8 代理、
去广告、内核切换），它返回的 `header` 可以原样传给 `player.open` 的 `headers`。

## 服务型小程序（`ant.serve`）

需要 `service` 权限。前面所有能力都是「小程序调宿主」，这个反过来：把一段逻辑跑成宿主眼里的
**本地 HTTP 服务**。市场里的弹幕服务就是这么接进播放器的。

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
Cloudflare Worker 风格的代码可以直接 `new URL(req.url)`。返回标准 `Response`、
`{status, headers, body|bodyBase64}` 或裸字符串都认；返回 `null` 宿主收到 503。

宿主侧用 **`miniapp://<appId>[/path]`** 引用（真地址的端口和令牌每次启动都变，所以存的是
逻辑地址）。要点：

- 宿主**会在用户没打开小程序时把它后台拉起**，所以 handler 必须能在页面不可见时工作 ——
  别依赖 `requestAnimationFrame` / DOM / 用户点击；
- 单次调用 60s 超时，请求体 ≤1MB；
- 服务型实例在保活上限里排最后被回收，不会被随手开的小程序挤掉；
- 用户手动结束实例就断服，调用方按「服务不可用」处理；
- **调试模式测不了这块** —— dev server 实例没有本地服务，宿主没有可回调的入口，
  只能装成 zip 之后验。

### 共享到局域网

小程序详情页、或「小程序设置 → 局域网共享」里可以开（默认关，只对声明了 `service` 的小程序
显示）。宿主会另起一个绑 `0.0.0.0:9321` 的服务，给出 `http://<本机IP>:9321/<lanToken>`，
同一网络里的别的设备填这个地址就能共用你这份服务。

- **多个服务能同时开**：共用这一个端口（防火墙只放行一个就够），靠各自的 token 区分；
  token 互不相同，泄露一个不影响别的，单独重置某一个也不动其它；
- `lanToken` **持久化**，重启后不变 —— 不然别的设备每次都要重配。「重置地址」换掉它，
  已经发出去的旧地址立刻失效；
- 只有服务路由被暴露，**包内文件一个都碰不到**；来源 IP 不是私有网段直接 403；
- 那个 token 就是唯一凭证。公共 WiFi 下开等于把你这个服务的能力（包括它的 `ant.request`
  出网能力）交给同网段所有人。

## 硬规则

违反了会静默失败，逐条核对：

| 规则 | 违反后的现象 |
|---|---|
| 资源引用全用相对路径（`./app.js`） | 白屏 + 一堆 404。小程序挂在 `http://127.0.0.1:<port>/<token>/` 下 |
| 自己设 `body { background }` | 容器 WebView 是透明的，会透出宿主壁纸 |
| `permissions` 覆盖实际调用的每个 API | 运行时 `PERMISSION_DENIED`；调试模式全开，测不出来 |
| 持久化用 `ant.storage`，别用 `localStorage` | 每次启动 origin 端口都变，`localStorage` 不保证保留 |
| 每次发版 `versionCode` +1 | 装了新版打开还是老的 |
| 要支持 TV 就必须实现 `ant.tv.onKey` | 电视上遥控器完全没反应（WebView 不参与系统焦点） |
| `network.allowlist` 写了就要覆盖全部域名 | `HOST_NOT_ALLOWED`；点站内链接弹「离开小程序」。不写＝`ant.request` 不限制但导航只剩同源；**导航不认 `*`** |
| 用了 `ant.serve` 就别依赖 DOM / 动画 / 用户点击 | 宿主会在页面不可见时后台拉起你，那时 `requestAnimationFrame` 被节流、没人点按钮 |
| 构建工具设 `base: './'` / `publicPath: './'`，路由用 hash 模式 | 白屏；刷新 404 |
| `viewport-fit=cover` + `env(safe-area-inset-*)` | 刘海屏 / 手势条被裁 |

改不了的限制：`ant.request` 只允许 http/https，回环与内网地址（`localhost`、`127.x`、`10.x`、
`172.16-31.x`、`192.168.x`、`169.254.x`）一律 `FORBIDDEN_HOST`，响应体 ≤10MB，超时上限 30s；
`ant.storage` 配额 5MB、key ≤256 字符；采集源单次超时 60s、并发上限 3；
`ant.serve` 单次 60s 超时、请求体 ≤1MB；
包内单文件 ≤20MB、解压后 ≤100MB、文件数 ≤2000，不能含符号链接。

## 分发

zip 传到任何能直链下载的地方，再提供一个 JSON 清单地址，用户在宿主「市场」Tab 填它即可。
本仓库的清单就是 `market/market.json`：

```json
{
  "apps": [
    {
      "appId": "com.yourname.hello",
      "name": "Hello",
      "version": "1.0.1",
      "versionCode": 2,
      "url": "https://cdn.example.com/hello-v2.zip",
      "md5": "9e107d9d372bb6826bd81d3542a419d6",
      "icon": "https://cdn.example.com/hello.png",
      "author": "yourname",
      "description": "一句话介绍"
    }
  ]
}
```

- `appId`、`url` 缺一不可，其余可选；缺字段的条目会被静默跳过
- 清单里的 `appId` / `versionCode` 必须与 zip 内 `manifest.json` 一致，宿主按它判断「更新」
- 提供 `md5` 时宿主会校验，不匹配拒绝安装（`md5 -q hello-v2.zip`）
- 顶层用 `apps` / `list` / `data` 或直接给一个数组都能识别

改 `appId` 等于换了一个小程序：数据不迁移、权限要重新授权。升级只看 `versionCode`，
装上后旧版本目录自动清掉，`ant.storage` 的数据保留。

### 在线站点型小程序

`manifest.entry` 写成 `https://…` 时，包里只要一份 `manifest.json`：宿主不起本地静态服务，
WebView 直接开这个地址，SDK 照旧注入。装法是「+ → 从链接安装」填 manifest 的地址，
市场清单的 `url` 也可以直接指向 `manifest.json`。要点：站内会跳到的域名（登录回跳、`www` 与裸域、
页面 CDN）**都得逐条写进 `network.allowlist`**，入口不能指向本机或内网。

宿主默认对在线站点启用两层广告过滤：请求层拦截常见国内外广告厂商及典型广告资源，页面层
隐藏横幅、信息流、插屏和视频广告控件。若页面被误伤，可在「小程序设置 → 在线网站广告过滤」
关闭，结束实例后重新打开生效。详见开发引导第 2.5 节。

## Codex / Claude Code Skill

`skills/miniapp-dev/` 是一份自带资料的 skill，唯一外部依赖是 `python3`（标准库即可，不需要
zip/md5 命令，也不需要 Flutter、Node、宿主源码）。可装进 Codex skills，或拷到
`~/.claude/skills/` / 项目的 `.claude/skills/`。触发词覆盖「小程序 / miniapp」、JSAPI 名和错误码。

```
skills/miniapp-dev/
├─ SKILL.md                    工作流：脚手架 → 浏览器 → 调试模式 → 预检打包
├─ agents/openai.yaml          Codex 列表展示与默认提示
├─ references/jsapi.md         完整 JSAPI 参考：manifest 全字段、权限、签名与返回结构、
│                              事件表、错误码表、硬限制、完整看片链路示例
├─ assets/ant-mock.js          浏览器 mock SDK（检测到真 SDK 自动退让，打包时留着无害）
├─ assets/template/            手写时的起点模板
└─ scripts/
   ├─ new_miniapp.py           脚手架
   ├─ check_miniapp.py         预检（安装器全部校验 + 权限反查 + 静默失败项）
   └─ pack_miniapp.py          打包（python zipfile，保证 manifest 落在包根）
```

> 宿主的 `ant-sdk.js` 加了新 API 时，同步更新 skill 的 `assets/ant-mock.js`、`references/jsapi.md`，
> 以及两个脚本里的权限表 —— `scripts/check_miniapp.py` 的 `KNOWN_PERMS` 与 `PERM_OF`、
> `scripts/new_miniapp.py` 的 `KNOWN_PERMS`。加新权限时别漏 `new_miniapp.py`，
> 不然 `--permissions` 会拒掉它。

## 文档

| 文档 | 什么时候读 |
|---|---|
| [开发引导](docs/miniapp-developer-guide.md) | 写第一个小程序，或要查 manifest 字段、权限、某个 API 的确切签名、错误码 |
| [脱离宿主开发调试](docs/miniapp-standalone-dev.md) | 配开发环境，或 CORS / 白屏 / 手机连不上 dev server / Vue-React 构建配置卡住了 |
| [JSAPI 参考](skills/miniapp-dev/references/jsapi.md) | 只想要一份速查表，或不在宿主仓库里 |

关注频道：[Ant Video](https://t.me/ant_video)
