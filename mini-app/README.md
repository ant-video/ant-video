# 蚂蚁影视 · 小程序

[蚂蚁影视](../README.md)宿主的小程序生态目录：开发文档、示例小程序、注入 SDK、市场分发清单，以及一套给 Claude Code 用的开发 skill。

小程序是纯 HTML/JS/CSS 包，跑在宿主容器的 WebView 里，通过宿主在 document-start 注入的
`window.ant` 调用宿主能力（播放器、采集源、存储、UI）。**写小程序不需要碰 Flutter，也不需要重新编译宿主。**

## 目录结构

```
mini-app/
├─ docs/
│  ├─ miniapp-developer-guide.md   开发引导：manifest、权限、JSAPI、打包发版
│  └─ miniapp-standalone-dev.md    脱离宿主开发调试：三阶段流程 + mock SDK 全文
├─ miniapps/
│  ├─ ant-sdk.js                   宿主注入的真 SDK（协议 v1，行为有疑问时以它为准）
│  ├─ demo/                        覆盖全部 JSAPI 的最小示例
│  ├─ tetris/                      俄罗斯方块（纯前端游戏 + TV 遥控）
│  └─ emby/                        影视库（多页面 + 采集源 + 播放 + 续播）
├─ market/zip/
│  ├─ market.json                  市场清单，用户在宿主「市场」Tab 填它的地址
│  └─ *.zip                        各小程序的安装包
└─ skills/miniapp-dev/             Claude Code skill：脚手架 / mock SDK / 预检 / 打包
```

## 示例小程序

| 小程序 | appId | 权限 | 看点 |
|---|---|---|---|
| **示例小程序** `miniapps/demo/` | `com.leospring.demo` | 全部 6 项 | 一屏按钮逐个试 `ant.*`，动手前先跑它 |
| **俄罗斯方块** `miniapps/tetris/` | `com.leospring.tetris` | ui / storage / navigate | 掌机复刻，Web Audio 音效 + LCD 光影；自带 `ant-mock.js`，浏览器里直接能玩 |
| **影视库** `miniapps/emby/` | `com.leospring.emby` | ui / storage / navigate / player / source | Emby 风格四页面（首页 / 媒体库 / 搜索 / 详情），复用宿主已配置的采集源，续播记录存 `ant.storage` |

三个都以 `com.leospring.*` 命名，与宿主内置的 `com.ant.*` 分开 —— appId 是唯一键，撞了会被当成同一个小程序。

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
**manifest 里没声明的能力一律 `PERMISSION_DENIED`**；声明了运行期就直接可用，不会再弹确认框。

```js
ant.env.getSystemInfo()   // {platform,osVersion,isTV,appId,devMode,permissions,sdkVersion}  免权限
ant.log(msg)              // 免权限；console.* 也会进日志面板
ant.request({url,method,headers,data,timeout})  // → {statusCode,headers,data:string}   [network]
ant.requestJson({url})                          // 非 2xx / 非法 JSON 会 reject         [network]
ant.storage.get/set/getJSON/setJSON/remove/clear/keys()                                 [storage]
ant.ui.toast/loading/hideLoading/confirm({title,content})/actionSheet([...])             [ui]
ant.clipboard.get/set(text)                                                             [ui]
ant.navigateTo/redirectTo(url) · navigateBack() · exitMiniApp()                         [navigate]
ant.player.open({url,title}) · getState() · onStateChange(fn) · onClose(fn)              [player]
ant.source.list() · home(siteKey) · category({siteKey,tid,page,ext})
         · detail({siteKey,id}) · play({siteKey,flag,id}) · search({siteKey,wd,page})    [source]
ant.on/off/once(event, fn) · onShow(fn) · onHide(fn) · tv.onKey(fn)
```

事件：`app.show`、`app.hide`、`player.open`、`player.stateChange`、`player.close`、`keydown`。

`ant.request` 走宿主的 HTTP 客户端，**不受浏览器 CORS 限制** —— 这是相对纯 H5 的最大优势。
采集源返回宿主内部的 `vod_*` 蛇形字段；用户可能一个站点都没配，`list()` 要按空数组处理。
拿到 `source.play` 的地址接 `ant.player.open()` 就是一条完整的看片链路（自动复用 M3U8 代理、去广告、内核切换）。

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
| 构建工具设 `base: './'` / `publicPath: './'`，路由用 hash 模式 | 白屏；刷新 404 |
| `viewport-fit=cover` + `env(safe-area-inset-*)` | 刘海屏 / 手势条被裁 |

改不了的限制：`ant.request` 只允许 http/https，回环与内网地址（`localhost`、`127.x`、`10.x`、
`172.16-31.x`、`192.168.x`、`169.254.x`）一律 `FORBIDDEN_HOST`，响应体 ≤10MB，超时上限 30s；
`ant.storage` 配额 5MB、key ≤256 字符；采集源单次超时 60s、并发上限 3；
包内单文件 ≤20MB、解压后 ≤100MB、文件数 ≤2000，不能含符号链接。

## 分发

zip 传到任何能直链下载的地方，再提供一个 JSON 清单地址，用户在宿主「市场」Tab 填它即可。
本仓库的清单就是 `market/zip/market.json`：

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
页面 CDN）**都得逐条写进 `network.allowlist`**，入口不能指向本机或内网。详见开发引导第 2.5 节。

## Claude Code Skill

`skills/miniapp-dev/` 是一份自带资料的 skill，唯一外部依赖是 `python3`（标准库即可，不需要
zip/md5 命令，也不需要 Flutter、Node、宿主源码）。拷到 `~/.claude/skills/` 或某个项目的
`.claude/skills/` 下就能用，触发词是「小程序 / miniapp」以及各类 JSAPI 名与错误码。

```
skills/miniapp-dev/
├─ SKILL.md                    工作流：脚手架 → 浏览器 → 调试模式 → 预检打包
├─ references/jsapi.md         完整 JSAPI 参考：manifest 全字段、权限、签名与返回结构、
│                              事件表、错误码表、硬限制、完整看片链路示例
├─ assets/ant-mock.js          浏览器 mock SDK（检测到真 SDK 自动退让，打包时留着无害）
├─ assets/template/            手写时的起点模板
└─ scripts/
   ├─ new_miniapp.py           脚手架
   ├─ check_miniapp.py         预检（安装器全部校验 + 权限反查 + 静默失败项）
   └─ pack_miniapp.py          打包（python zipfile，保证 manifest 落在包根）
```

> 宿主的 `ant-sdk.js` 加了新 API 时，同步更新 skill 的 `assets/ant-mock.js`、`references/jsapi.md`
> 和 `scripts/check_miniapp.py` 里的 `PERM_OF` 权限映射表。

## 文档

| 文档 | 什么时候读 |
|---|---|
| [开发引导](docs/miniapp-developer-guide.md) | 写第一个小程序，或要查 manifest 字段、权限、某个 API 的确切签名、错误码 |
| [脱离宿主开发调试](docs/miniapp-standalone-dev.md) | 配开发环境，或 CORS / 白屏 / 手机连不上 dev server / Vue-React 构建配置卡住了 |
| [JSAPI 参考](skills/miniapp-dev/references/jsapi.md) | 只想要一份速查表，或不在宿主仓库里 |

关注频道：[Ant Video](https://t.me/ant_video)

