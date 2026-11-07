# 小程序开发引导

写给要给这个宿主做小程序的开发者。只需要会 HTML/JS/CSS，不需要碰 Flutter，也不需要重新编译宿主。

配套文档：[脱离宿主开发调试](miniapp-standalone-dev.md) · [技术设计](2026-09-01-miniapp-design.md)

---

## 1. 五分钟上手

建一个目录，放三个文件：

```
hello/
├─ manifest.json
├─ index.html
└─ app.js
```

**manifest.json**

```json
{
  "appId": "com.yourname.hello",
  "name": "Hello",
  "version": "1.0.0",
  "versionCode": 1,
  "renderer": "webview",
  "entry": "index.html",
  "permissions": ["ui", "storage"]
}
```

**index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Hello</title>
</head>
<body>
  <button id="go">点我</button>
  <script src="app.js"></script>
</body>
</html>
```

不用写 `<script src="ant-sdk.js">`——宿主会自动注入 `window.ant`。

**app.js**

```js
document.getElementById('go').addEventListener('click', async () => {
  await ant.ui.toast('你好，小程序');
  await ant.storage.set('clicked_at', new Date().toISOString());
  ant.log('已记录点击时间');
});
```

打包并安装：

```bash
cd hello
zip -r ../hello.zip .          # 注意是在目录里打包，不要把 hello/ 这层也压进去
```

宿主里进「小程序」→ 右上角 `+` → 「导入 zip 包」→ 选 `hello.zip`。装好后点开就能用。

开发期也可以跳过打包：`+` → 「导入文件夹」，直接选 `hello/`，宿主会把目录复制进安装区。
`.git`、`.svn`、`node_modules`、`.DS_Store` 会被自动跳过，其余校验（manifest、入口、
符号链接、体积与文件数上限）和 zip 完全一致。目录选择器依赖系统能力：桌面与 iOS 可用，
Android 分区存储下拿到的路径常常读不了，那边还是用 zip。

> 外层多一层文件夹（`hello/manifest.json`）也能装——安装器会自动识别并剥掉，但只在**唯一**一个这样的目录时生效。zip 与文件夹两种导入都是这个规则。

## 2. 包结构与 manifest

除 `manifest.json` 必须在包根之外，其余文件怎么组织都行；子目录、打包产物（Vue/React `dist`）都可以。

| 字段 | 必填 | 说明 |
|---|---|---|
| `appId` | ✅ | 反向域名，至少两段，只允许字母数字下划线。**这是唯一键**：安装目录、`ant.storage` 分区、权限授权记录都以它为准，发布后不要改 |
| `name` | ✅ | 展示名 |
| `versionCode` | ✅ | 正整数，**升级判断只看这个**。每次发版必须 +1 |
| `version` | | 展示版本号，如 `1.2.0`，不参与升级判断 |
| `renderer` | | 目前只能是 `webview`（缺省即此值）。`native` 是第二期的占位，现在写会被拒绝安装 |
| `entry` | | 首屏。包内 HTML（缺省 `index.html`，可带子目录如 `pages/index.html`），或者一个 `http`/`https` 地址——那就是[在线站点型小程序](#25-在线站点型小程序)。其它协议（`file:` / `data:` / `javascript:`）与协议相对地址 `//host/path` 一律拒绝安装 |
| `permissions` | | 见下节。**没声明的能力一律调不通** |
| `network.allowlist` | | 两个作用：`ant.request` 能请求哪些域名（**不写等于不限制**），以及 WebView 能跳到哪些域名（**不写等于只能停在自己的入口 origin**；导航不认 `*`，得逐条写域名） |
| `node` | | Node.js 后端入口/配置，见 4.11，必须声明 node 权限 |
| `python` | | `{"entry":"app.py"}`，必须声明 python 权限，与 node 块互斥，见 4.12 |
| `icon` | | http/https 图标或包内相对路径，未提供或加载失败时回退名称首字 |
| `description` | | 一句话描述 |
| `minHostVersion` | | 要求的最低宿主版本，低于它安装会被拒 |
| `pages` | | 第二期原生渲染用的页面列表，现在写了也不生效 |

`network.allowlist` 的匹配规则：

| 规则 | `ant.request` | 导航（点链接 / `navigateTo` / iframe） |
|---|---|---|
| 不写这个字段 | 全部放行 | 只有入口 origin |
| `*` | 全部放行 | **不放行**——SDK 会注入进 WebView 里加载的任何页面，等于把你的 JSAPI 权限交给对方域名，这种授权只接受逐条写明的域名 |
| `*.example.com` | `api.example.com`、`a.b.example.com`，**也包括** `example.com` | 同左 |
| `api.foo.cn` | 精确匹配（大小写不敏感） | 同左 |

### 2.5 在线站点型小程序

`entry` 写成线上地址时，包里就不需要任何页面文件了——宿主不再起本地静态服务，WebView 直接开这个地址，SDK 仍然在 document-start 注入，`window.ant` 照常可用：

```json
{
  "appId": "com.example.site",
  "name": "示例站",
  "versionCode": 1,
  "entry": "https://www.example.com/app/",
  "permissions": ["ui", "storage", "navigate"],
  "network": { "allowlist": ["*.example.com", "cdn.foo.cn"] }
}
```

安装方式有三种：把这份 `manifest.json` 单独放到网上，用小程序中心「+ → 从链接安装」填它的地址；或者本地选这个 `.json` 文件导入；或者照常打成只含 `manifest.json` 的 zip。市场 JSON 里的 `url` 也可以直接指向 `manifest.json`，宿主按内容分流，不看扩展名。

几条必须知道的差异：

- **`allowlist` 决定站内能跳到哪儿**。入口 origin 之外的域名（登录回跳、`www` 与裸域互跳、放页面的 CDN）都要逐条写进 `allowlist`——写 `*` 对导航无效。漏了就会在跳转时弹「离开小程序」，由用户决定是否交给系统浏览器。`iframe` 走同一套规则，只是子框架里的外链直接拦掉、不弹窗。
- **入口不能指向本机或内网**。`127.0.0.1`、`localhost`、`192.168.*`、`10.*`、`*.local` 这些一律拒绝安装和启动——宿主自己的视频代理与本地服务就在那儿。要连开发机的 dev server 请用调试模式（第 8 节）。
- **`ant.request` 隐式放行入口域名**，其余域名照旧看 `allowlist`；内网地址依然一律拒绝。
- **代码在别人服务器上，随时会变**。宿主在小程序图标右下角标一个云角标提示用户，权限声明请按最小集写。
- 页面里的 `fetch` / `<img>` / `<script src>` 不算导航，不受 `allowlist` 约束，跨域由浏览器的 CORS 决定；需要绕 CORS 就走 `ant.request`。
- 站点自己的 `localStorage` / Cookie 跟着站点 origin 走，不是宿主的 `ant.storage` 分区；要跨设备或跟宿主对齐，用 `ant.storage`。
- 宿主默认对在线站点启用广告过滤：请求层拦截常见国内外广告平台及典型广告资源，页面层隐藏横幅、信息流、插屏和视频广告控件。这个能力只作用于在线站点型小程序，规则由宿主维护，小程序不能借此向第三方页面注入任意脚本；若站点被误伤，用户可在「小程序设置 → 在线网站广告过滤」关闭，结束该小程序后重新打开生效。

## 3. 权限

| id | 覆盖的 API |
|---|---|
| `ui` | `ant.ui.*`、`ant.clipboard.*` |
| `storage` | `ant.storage.*` |
| `filesystem` | `ant.file.*`，私有文件读写，见 4.13 |
| `network` | `ant.request`、`ant.requestJson`、`ant.requestBytes`、`ant.requestStream`、`ant.requestSSE` |
| `navigate` | `ant.navigateTo` / `redirectTo` / `navigateBack` / `exitMiniApp` |
| `miniapp` | `ant.miniApp.open`（打开其它已安装小程序）、`ant.resolveService`（只解析服务地址） |
| `player` | `ant.player.*` |
| `source` | `ant.source.*` |
| `service` | `ant.serve`（见 4.10） |
| `node` | manifest.node 包内 Node.js 服务（见 4.11） |
| `python` | manifest.python 后端、ant.python.call（见 4.12） |

`ant.env.getSystemInfo()` 和 `ant.log()` 不需要任何权限。

大部分权限都是**声明了就能直接用**，运行期不再重复确认——用户在安装和详情页已经看得到完整的权限列表。`miniapp` 是例外：声明决定能否调用，真正打开另一个小程序时仍会逐次显示目标名称，由用户确认。

没声明就调用会 reject 一个 `code === 'PERMISSION_DENIED'` 的 Error。

**按需申请**：声明了但没用的权限只会让用户对你的小程序更警惕。`service` 尤其要慎重——
声明了它的小程序会被宿主在用户没打开它的时候后台拉起。

## 4. SDK 参考

异步 JSAPI 返回 Promise，事件订阅/文本行解析等同步工具除外。失败时 reject 的 Error 带
`code`（见第 7 节）与 `api` 字段。当前 ant.version 为 6，环境 sdkVersion 仍为 5；
用具体方法是否存在判断新能力，避免只比较版本数字。

### 4.1 环境与日志

```js
const info = await ant.env.getSystemInfo();
// { platform:'android'|'ios'|'macos'|'windows', osVersion, isTV,
//   appId, appName, appVersion, appVersionCode, devMode, permissions, sdkVersion }

ant.log('任何字符串');   // 进宿主日志与容器内的日志面板
```

`console.log` 也会被容器捕获进日志面板，调试期不用刻意换成 `ant.log`。

### 4.2 网络

```js
const res = await ant.request({
  url: 'https://api.example.com/list',
  method: 'GET',          // GET/POST/PUT/DELETE/HEAD/PATCH
  headers: { 'User-Agent': 'my-app' },
  data: { page: 1 },      // POST 等方法的 body
  timeout: 8000,          // ms，上限 30000
  responseType: 'text',   // 'text'（缺省）| 'base64'
  followRedirects: true   // false 时不跟随，自己读 302 的 Location
});
// { statusCode: 200, headers: {...}, data: '原始响应字符串',
//   responseType: 'text', url: '重定向后的最终地址' }

const json = await ant.requestJson({ url: '...' });   // 非 2xx 或非法 JSON 会 reject
```

请求走宿主的 HTTP 客户端，**不受浏览器 CORS 限制**——这是相对纯 H5 的最大优势。

限制：外网只允许 http/https，直接指定的回环/内网地址会被拒绝；宿主解析的 `miniapp://<appId>/path`
服务及其注册端点是受控例外。响应体上限 10MB；`host`、`content-length`、`connection` 请求头不允许自定义。
当前普通/流请求 timeout 缺省 15 秒、夹在 1~600 秒，流请求参数不保证整体/空闲时长。

**二进制响应**要显式要：

```js
const bytes = await ant.requestBytes({ url: '...' });        // → Uint8Array
const res = await ant.request({ url: '...', responseType: 'base64' });
const same = ant.base64ToBytes(res.data);                    // 手工转换
```

缺省的 `'text'` 会让宿主按响应头里的 charset 解码，protobuf、gzip/brotli、GBK 网页经此
一遭就毁了。`byteLength` 是原始字节数，10MB 上限按它算（base64 串本身会大 4/3）。

### 4.3 存储

按 appId 隔离，别的小程序读不到。配额 5MB，key 上限 256 字符。

```js
await ant.storage.set('key', 'value');       // 值会被 String() 转换
const v = await ant.storage.get('key');      // 不存在返回 null

await ant.storage.setJSON('profile', { id: 1, tags: ['a'] });
const p = await ant.storage.getJSON('profile', {});   // 第二个参数是解析失败/不存在时的兜底

await ant.storage.remove('key');
await ant.storage.clear();
const keys = await ant.storage.keys();
```

> 也可以用浏览器自带的 `localStorage`，但每次启动小程序的 origin 端口都不同，**`localStorage` 不保证跨启动保留**。要持久化就用 `ant.storage`。

### 4.4 界面

```js
await ant.ui.toast('提示文字');

await ant.ui.loading('加载中…');
await ant.ui.hideLoading();

const ok = await ant.ui.confirm({
  title: '确认', content: '要删除吗？',
  confirmText: '删除', cancelText: '算了'
});   // → boolean

const index = await ant.ui.actionSheet(['选项一', '选项二']);  // → 下标，取消为 -1

await ant.clipboard.set('复制的内容');
const text = await ant.clipboard.get();
```

### 4.5 导航

```js
await ant.navigateTo('page2.html');           // 相对入口解析
await ant.navigateTo('pages/detail.html?id=7');
await ant.redirectTo('index.html');
const moved = await ant.navigateBack();       // false 表示没有历史了
await ant.exitMiniApp();                      // 关掉整个小程序
```

只能跳自身 origin 内的地址，以及 `network.allowlist` 里写了的域名（在线站点型小程序的登录域、页面 CDN）；其余会 reject `CROSS_ORIGIN`。要打开真正的外部网页，让用户点一个真实的 `<a href="https://…" target="_blank">`——容器会弹确认框后交给系统浏览器。

物理返回键/手势返回会先走 WebView 的历史栈，没有历史了才退出容器，不用自己处理。

打开另一个**已经安装**的小程序需要在 manifest 声明 `miniapp` 权限：

```js
const result = await ant.miniApp.open({
  appId: 'com.foo.target',
  path: 'pages/detail.html?id=7', // 可省略；相对目标入口，不能跨域或越出包目录
  params: { id: 7, from: 'recommend' }
});
// { opened:true, appId, name, resumed, path? }
// 用户取消时 resolved 为 { opened:false, ... }，不是异常。
```

宿主会先确认目标已安装，再显示「来源要打开目标」确认框；只有当前可见的前台小程序能发起。目标已在后台时复用原 WebView，`resumed` 为 `true`；带 `path` 时会换到指定页面，不带则保持原页面。`params` 必须是 JSON 对象且不超过 64KB。

目标小程序读取参数不需要 `miniapp` 权限。启动时应尽早注册 `onOpen`；也可以在任意时刻主动读取宿主缓存的最近一次参数：

```js
ant.miniApp.onOpen(options => {
  console.log(options.sourceAppId, options.path, options.params);
});

const options = await ant.miniApp.getLaunchOptions();
// 从小程序中心直接启动时为 null
```

### 4.6 播放器

把地址交给宿主播放页，自动复用 M3U8 代理、去广告、内核切换整条链路。

```js
await ant.player.open({ url: 'https://.../movie.m3u8', title: '片名' });

// 需要鉴权/防盗链的源：带上取流请求头
await ant.player.open({
  url: 'https://.../movie.m3u8',
  title: '片名',
  headers: { Referer: 'https://site.com/', 'User-Agent': 'Mozilla/5.0', Cookie: 'sid=...' }
});

const state = await ant.player.getState();
// { active:false } 或 { active:true, playing, position, duration }（毫秒）

const off = ant.player.onStateChange(s => console.log(s.playing, s.position));
ant.player.onClose(() => console.log('用户退出播放页了'));
off();   // 取消监听
```

`headers` 会一路带到播放器内核和 M3U8 代理（分片取流也带），`ant.source.play()` 返回的 `header` 可以直接原样传进来（单数字段名也认）：

```js
const play = await ant.source.play({ siteKey, flag: '', id: 'xxx' });
await ant.player.open({ url: play.url, title: '片名', headers: play.header });
```

限制：最多 32 条，单个值最长 8192 字符，`Host` / `Content-Length` / `Connection` 会被丢弃（由播放器自己算）。超限报 `INVALID_PARAMS`。

**需要宿主解析的线路（`parse` / `jx` 为 `'1'`）。** 这时 `play.url` 是网页地址而不是媒体直链，得靠宿主的解析器 + 网页嗅探取真实地址——小程序自己做不到。做法是把整份 `play` 传回去，别只挑 `url`：

```js
const play = await ant.source.play({ siteKey, flag: line.name, id: episode.id });
await ant.player.open({ ...play, url: play.url, title: '片名', headers: play.header });
// 宿主按 parse / jx / playUrl / flag / jxFrom / key 决定跑哪些解析源，
// 都不命中就退回网页嗅探。返回值的 sniff 字段说明这次是不是走了这条路。
```

自己抓站点、手里没有这些 TVBox 字段时，用 `sniff` 显式声明「这是个网页地址，请宿主嗅探」：

```js
await ant.player.open({ url: 'https://site.com/watch/123', title: '片名', sniff: true });
```

播放页里这条线路显示成 `嗅探`，嗅探不出来用户可以手动切 `直链` 再试。

两点限制只在要宿主解析时生效：`url` 与 `playUrl` 必须是 http/https 且不能指向本机或内网（和 `ant.request` 同一套判定），否则报 `INVALID_URL` / `FORBIDDEN_HOST`；`click` 字段不接受（宿主只认站点自己配的点击规则，传 `key` 指过去）。直链播放不受影响。

外挂字幕暂不支持。播放是整页跳转，退出后回到小程序（会收到 `player.close`）。

### 4.7 采集源

调用宿主里用户已经配好的站点。

```js
const sites = await ant.source.list();
// [{ key, name, type, searchable }]

const home   = await ant.source.home(sites[0].key);
const list   = await ant.source.category({ siteKey, tid: '1', page: 1, ext: {} });
const detail = await ant.source.detail({ siteKey, id: 'xxx' });
const play   = await ant.source.play({ siteKey, flag: '', id: 'xxx' });
const found  = await ant.source.search({ siteKey, wd: '关键词', page: 1 });
// found.list → [{ vod_id, vod_name, vod_pic, vod_remarks, ... }]
```

返回结构与宿主内部的 CMS/TVBox 数据模型一致（`vod_*` 蛇形字段）。

注意：
- 用户可能一个站点都没配，`list()` 返回空数组要处理
- 单次调用超时 60s，同时最多 3 个在飞，超了 reject `TOO_MANY_REQUESTS`
- 拿到 `play` 的地址后接 `ant.player.open()` 就是一条完整的看片链路；`play.header` 一起传过去，鉴权源才播得动
- `play.parse` / `play.jx` 为 `'1'` 的线路拿到的是网页地址，把整份 `play` 交给 `ant.player.open()`，宿主会去解析和嗅探（见 4.6）

### 4.8 事件与生命周期

```js
ant.onShow(d => {});     // 页面加载完成 / 应用回前台 / 从后台切回
ant.onHide(d => {});     // 应用进入后台、或者被用户最小化（该停轮询了）

const off = ant.on('player.stateChange', s => {});   // 通用监听
ant.once('player.close', () => {});
ant.off('player.stateChange');                        // 移除该事件所有监听
```

事件表：`app.show`、`app.hide`、`player.open`、`player.stateChange`、`player.close`、`keydown`。

`app.show` / `app.hide` 的 `reason` 区分三种来源：`lifecycle`（整个应用切前后台）、
`minimize`（用户点了悬浮球的「最小化」，或者在没有页面历史时按了返回键）、
`restore`（从小程序中心的「运行中」切回）。

**最小化不等于退出**：小程序被最小化后 WebView、定时器、本地服务都还在跑，切回时
不会重新加载，`window` 上的状态原样保留。所以别把「重新初始化」写在 `onShow` 里，
按 `reason` 判断更稳。真正被结束时不会有事件——那时页面已经销毁了。

离屏期间浏览器会按后台标签页节流 `requestAnimationFrame`，纯动画在切回瞬间会跳一下；
`setTimeout` / `setInterval` 和音频不受影响。

### 4.9 TV 遥控

TV 上 WebView 不参与系统焦点，方向键由容器转发进来：

```js
ant.tv.onKey(e => {
  // e.key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter'
});
```

内置示例 `assets/miniapp/demo/app.js` 末尾有一份可直接抄的实现：按 DOM 顺序在所有 `button` 间移动 `focus()`，`Enter` 触发 `click()`，并 `scrollIntoView`。**不处理这个事件的小程序在电视上基本没法操作**，如果你要支持 TV 就必须实现。

配合 CSS 给出明显的焦点样式：

```css
button:focus-visible { outline: 3px solid #ffb020; outline-offset: 2px; }
```

### 4.10 反向服务：让宿主调你

需要 `service` 权限。用 `ant.serve` 注册一个 HTTP 处理器，宿主自己的代码就能把你这段 JS
当本地服务用——播放器的弹幕源就是这么接的。

```js
ant.serve(async (req) => {
  // req = { method, path, query, params, headers, body, url }
  if (req.path === '/api/v2/search/episodes') {
    const data = await search(req.params.anime, req.params.episode);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  }
  return { status: 404, body: 'not found' };
});
```

`req.path` 已经剥掉了宿主的令牌与 `__service` 前缀，是干净的业务路径；`req.url` 是拼好的
完整地址，写成 Cloudflare Worker 那种风格的服务可以直接 `new URL(req.url)`。

返回值三种写法都认：标准 `Response` 对象、`{status, headers, body}`（二进制放
`bodyBase64`）、或者一个字符串（当 200 text）。返回 `null` 宿主会收到 503。

宿主侧用 **`miniapp://<appId>[/path]`** 引用你的服务。真地址里的端口和令牌每次启动都不
一样，所以设置里存的是这个逻辑地址，用的时候才解析。解析时宿主会：

1. 没跑就**后台拉起**你的小程序，用户不需要先手动打开；
2. 等 `ant.serve` 注册好（页面脚本跑完）再发第一个请求；
3. 之后 WebView 一直挂在屏幕外，JS、定时器、`ant.request` 全都照常。

要注意的：

- handler 必须能在**页面不可见**时工作。别依赖 `requestAnimationFrame`、别等用户点击、
  别把状态只存在 DOM 里。
- 单次调用 60s 超时，请求体上限 1MB。
- 同时保活的实例上限是 3 个，超了要回收；声明了 `service` 的实例排在最后被回收，
  不会被用户随手打开的小程序挤掉。
- 用户在小程序中心手动结束它，服务就断了——弹幕这类调用方会退化成「没有可用源」。

现成的例子：`danmu_api` 仓库的 `miniapp/`（`build-miniapp.js` 打包），把整个弹幕聚合
服务塞进小程序，播放器把弹幕 API 填成 `miniapp://com.logvar.danmu` 就能用。

#### 共享到局域网

小程序详情页里有个「局域网共享」开关（默认关，只对声明了 `service` 的小程序显示）；
「小程序设置 → 局域网共享」里也有一份，那一页能一眼看全所有服务的开关和地址。开了之后宿主
会另起一个绑在 `0.0.0.0:9321` 的服务，把请求转发到你的 handler，地址形如：

```
http://192.168.1.7:9321/<lanToken>
```

同一网络里的别的设备（另一台装着本 app 的电视、第三方播放器）填这个地址就能共用一份服务。
几点要知道：

- **多个服务可以同时开**：共用同一个端口（防火墙只放行一个就够），靠地址里的 token 区分。
  token 互不相同，泄露一个不影响别的服务，单独重置某一个也不动其它。
- 地址里的 `lanToken` 是**持久化**的，重启后不变——不然别的设备每次都要重配。
  「重置地址」会换掉它，已经发出去的旧地址立刻失效。
- 只有 `__service` 被暴露，**包内文件一个都碰不到**；来源 IP 不是私有网段直接 403。
- 这个 token 就是唯一凭证。公共 WiFi 下开等于把你这个服务的能力（包括它的
  `ant.request` 出网能力）交给同网段所有人。
- 服务自己那一层的鉴权照常生效——比如 danmu_api 改过 `TOKEN` 的话，路径要写成
  `http://IP:9321/<lanToken>/<你的TOKEN>/api/v2/…`。

### 4.11 Node.js 服务：把后端跑进宿主的 node 里

`ant.serve` 跑在 WebView 里，写不了文件、起不了原生依赖。如果你的服务本来就是一个
Node 程序（express/fastify、npm 依赖、ffmpeg 脚本），可以直接把它打进小程序包，
宿主会用内嵌 node（worker_threads）把它当独立 worker 跑起来。

**manifest 声明**（需要 `node` 权限，这是重权限，安装详情里会显眼展示）：

```json
{
  "appId": "com.logvar.danmu",
  "entry": "index.html",
  "permissions": ["node"],
  "node": {
    "entry": "server/index.js",
    "config": "server/index.config.js"
  }
}
```

- `node.entry`：服务端主文件，**必须导出 `start(config)`**（可另导出 `stop()` 做清理）。
- `node.config`：可选；不写时宿主会找 `entry` 同目录的 `index.config.js`，两个都没有
  则 `start(null)`。
- `entry`（WebView 入口页）仍然必填——你的包可以同时有前端页面和 Node 后端；
  纯后端没有页面的，放一个占位 `index.html` 即可。
- 包内可以带 `node_modules/`（上限 200MB / 10000 个文件），宿主不会跳过它，
  `require` 包内依赖直接可用。

**服务端代码契约**：

```js
// server/index.js
module.exports = {
  start: (config) => {
    // config 来自 index.config.js（或 node.config），没有则为 null
    // 监听端口用环境变量，别写死：
    const port = Number(process.env.DEV_HTTP_PORT);
    app.listen(port, '127.0.0.1');
  },
  stop: () => app.close(), // 可选，宿主停止服务时调用
};
```

要在宿主的状态页里正确显示「运行中」，请用宿主注入的 `globalThis.catServerFactory`
当 serverFactory（fastify/express 适配器里传一下即可）；不配也能跑，只是宿主探测
就绪会更慢一些。

**宿主怎么用你**：和 4.10 一样填 **`miniapp://<appId>[/path]`**，消费方零改动。声明了
`node` 块的小程序**不需要**再声明 `service` 权限。解析时宿主会：

1. 确保内嵌 node 管理器在跑；
2. 以你的 appId 为 key、独立分组启动一个 worker（和视频源、别的小程序服务互不影响）；
3. 轮询你的 `/check` 就绪（约 20s 超时）后返回实际端口地址。

**生命周期**：

- **按需自启**：任何一次解析地址都会拉起，不需要用户先打开小程序；
- **手动启停**：小程序详情页有「Node 服务」区块（状态 + 启动/停止按钮）；
  手动**停止只停当下**，下次消费方请求仍会自动拉起——彻底停用只能卸载；
- **崩溃自愈**：worker 意外退出后，下次解析自动重启；
- **升级/卸载**：宿主会先停 worker 再动安装目录。

**平台限制**：Android x86 模拟器没有内嵌 node 运行时（与 Python 源同限制），这类设备
上解析会按「无可用服务」处理。真机（ARM）和桌面端都支持。

### 4.12 Python 后端与 ant.python.call

```json
{"permissions":["python","storage","ui"], "python":{"entry":"app.py"}}
```

```python
def hello(payload, extra=0):
    return {"message": f"你好，{payload.get('name', '世界')}", "sum": extra + 3}

def serve(request):
    if request['path'] == '/check':
        return {'ok': True}
    return {'_status': 404, 'error': 'not found'}
```

```js
const result = await ant.python.call('hello', {name:'读者'}, 2);
```

调用包内入口的顶层函数，位置参数/返回值按 JSON 传递；直接拿函数返回值，不解 result 包装层。
类式爬虫需在入口增加顶层函数封装。Python 的 requests 不走 ant.request 权限/域名门禁，
采集代码自己控制地址、重定向、超时和响应大小。

HTTP 服务导出 serve(request) 或可调用的 Flask/WSGI app；WSGI 优先。不要 app.run()，不要自建端口。
serve 的 dict 响应使用 `_status` / `_headers`，其余字段为 JSON body，与 JS ant.serve 契约不同。
宿主通过 miniapp://<appId>/path 按需加载，Python 后端无需 service 权限；同样可由宿主共享到局域网。

Python 使用共享内嵌 CPython，Android 仅 ARM 支持（x86 模拟器不可用），其它平台也需要完整运行时构建。
入口 __file__ 的文件名由 key 派生，使用父目录寻址；避免共享 sys.modules 的同名 import 串包。
宿主已带 requests/beautifulsoup4/flask 等，requirements.txt 不会触发 pip 安装；原生扩展必须针对目标平台。
没有 WSGI app 的函数式入口可能重复加载，不依赖模块内存保存数据。

脚手架和本地联调：

```bash
python3 skills/miniapp-dev/scripts/new_miniapp.py --app-id com.example.python --name Python示例 --python
python3 skills/miniapp-dev/scripts/dev_python.py miniapps/python --port 3000
```

宿主 dev server 调试不读取 manifest/Python，最终导入 zip 验证内嵌执行和权限。
完整契约与小说移植见 [Python 开发参考](../skills/miniapp-dev/references/python.md)。
示例：miniapps/python-demo（最小调用）、miniapps/sudugu-reader（书城/搜索/目录/分页正文/书架/进度）。

### 4.13 私有文件与流式网络

```js
await ant.file.write('notes/chapter.txt', '正文'); // filesystem；单文件 5MB，总配额 20MB
const text = await ant.file.read('notes/chapter.txt');
const entries = await ant.file.list('notes');
await ant.file.delete('notes/chapter.txt');
const stream = await ant.requestStream({url:'miniapp://com.example.python/events',
  onData(text) { console.log(text); }, onDone() {}, onError(error) { console.warn(error); }});
await stream.abort();
await ant.requestSSE({url:'miniapp://com.example.python/events'}, dataLine => console.log(dataLine));
const url = await ant.resolveService('miniapp://com.example.python/check'); // miniapp 权限
```

file 同样提供 stat/mkdir/rename，支持 text/base64 编码。read 直接返回字符串，list 返回同级条目数组。
流请求需要 network 权限，句柄 Promise resolve 不代表流结束，完成由 onDone 通知；
requestSSE 仅解析 data 行，多行事件自行合并。解析出的真实服务地址仅供当次 fetch/媒体标签使用，
不要推导或持久化真实端口、token、Python key。

## 5. 打包与发版

```bash
cd my-app
zip -r ../my-app-v2.zip . -x '.*' -x '__MACOSX*'
```

发新版本只有一件事必须做对：**`versionCode` 递增**。宿主按它判断"更新"，装上后旧版本目录会被自动清掉，`ant.storage` 的数据保留。

限制：单文件 ≤20MB，解压后总量 ≤100MB，文件数 ≤2000。包里不能有符号链接。

改 `appId` 等于换了一个小程序：数据不会迁移，权限要重新授权。

## 6. 分发给别人（市场 JSON）

把 zip 传到任何能直链下载的地方，再提供一个 JSON 列表地址，用户在「市场」Tab 把地址换成你的即可（该 Tab 默认填的是宿主内置的官方市场，清空后点「加载」会恢复成它）：

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
      "size": 20480,
      "icon": "https://cdn.example.com/hello.png",
      "author": "yourname",
      "description": "一句话介绍"
    }
  ]
}
```

- `appId`、`url` 缺一不可，其余可选；缺字段的条目会被静默跳过
- 提供 `md5` 时宿主会校验，不匹配拒绝安装（`md5 -q hello-v2.zip` 可以算出来）
- `versionCode` 高于用户本地版本时按钮显示"更新"
- 顶层用 `apps` / `list` / `data` 或直接给一个数组都能识别
- 在线站点型小程序把 `url` 指向 `manifest.json` 即可，宿主按内容分流；只有一个小程序、懒得做列表时，让用户走「+ → 从链接安装」填同一个地址也一样

## 7. 错误码对照

```js
try {
  await ant.request({ url: 'https://evil.com' });
} catch (e) {
  console.log(e.code, e.message);
}
```

| code | 含义 | 怎么改 |
|---|---|---|
| `PERMISSION_DENIED` | 权限没声明 | 在 manifest 补 `permissions` |
| `UNKNOWN_API` | API 名写错，或宿主版本太老 | 查拼写；用 `sdkVersion` 做能力判断 |
| `INVALID_PARAMS` | 必填参数缺失或非法 | 看 message 里点名的参数 |
| `INVALID_URL` | 不是 http/https，或地址不合法 | — |
| `FORBIDDEN_HOST` | 访问了回环/内网地址 | 这是硬限制，改不了 |
| `HOST_NOT_ALLOWED` | 域名不在 `network.allowlist` 里 | 补白名单 |
| `REQUEST_FAILED` | 网络层失败（超时、DNS、连接） | 重试或检查地址 |
| `RESPONSE_TOO_LARGE` | 响应超过 10MB | 分页拉取 |
| `QUOTA_EXCEEDED` | 键值存储或私有文件超出配额 | 清理旧数据 |
| `PYTHON_ENTRY_MISSING` / `PYTHON_RUNTIME_UNAVAILABLE` / `PYTHON_CALL_FAILED` | Python 入口、运行时或调用不可用 | 核对 python 块/权限、设备运行时和函数参数，见 4.12 |
| `INVALID_PATH` / `NOT_FOUND` / `FILE_TOO_LARGE` | 私有文件路径、存在性或大小错误 | 使用包外私有相对路径并分批读写 |
| `INVALID_KEY` | storage key 为空或超 256 字符 | — |
| `CROSS_ORIGIN` | 想跳到小程序之外的地址 | 把域名写进 `network.allowlist`，或用 `<a target="_blank">` 让用户确认后走浏览器 |
| `APP_NOT_INSTALLED` | `miniApp.open` 的目标尚未安装 | 引导用户先从小程序中心安装 |
| `SAME_APP` | 用 `miniApp.open` 打开自己 | 改用 `navigateTo` |
| `NOT_FOREGROUND` | 后台或被其它页面遮住时尝试打开小程序 | 回到前台后由用户操作触发 |
| `BUSY` | 上一个跨小程序确认框仍未处理 | 等待前一次调用结束 |
| `UNAVAILABLE` | 宿主对应模块未就绪（如没有播放模块） | 降级处理 |
| `SITE_NOT_FOUND` / `SITE_UNAVAILABLE` | siteKey 不存在 / 该站点没有可用接口 | 先 `source.list()` 拿到真实 key |
| `TOO_MANY_REQUESTS` | 采集源并发超过 3 | 串行化你的请求 |
| `TIMEOUT` | 采集源 60s 没返回 | 换站点 |
| `SOURCE_FAILED` | 站点自身报错 | 看 message |
| `INTERNAL_ERROR` | 宿主内部异常 | 看容器日志面板，必要时反馈给宿主维护者 |

## 8. 容器内的调试手段

小程序**全屏运行，没有顶栏**。容器操作收在一个可拖动的**悬浮球**里（默认贴右侧中部，
拖到哪儿在本次运行内都记着），点一下展开：

| 按钮 | 作用 | 出现条件 |
|---|---|---|
| 重新加载 | 重载当前页面（改了 dev server 上的代码后点它） | 一直有 |
| 日志 | 打开日志面板：JSAPI 调用与返回、被拒的权限、`console.*`、加载错误。可全部复制 | 小程序中心右上角「调试」里打开**调试功能**开关后；dev server 调试实例强制可见 |
| 关闭 | 退出并销毁实例 | 一直有 |

调试功能开关改完对下一次启动生效。除了悬浮球，系统返回键 / TV 返回键 / 桌面端 Esc
都能退出；TV 遥控用菜单键开合悬浮球（展开时方向键归焦点导航，不再转发给小程序）。

日志行前缀 `[APP]` 是你打的、`[API]` 是 JSAPI 调用、`[SYS]` 是容器生命周期、`[ERR]` 是失败。

想要秒级改代码看效果，用调试模式——见[脱离宿主开发调试](miniapp-standalone-dev.md)。

## 9. 实践建议

- **先在浏览器里写完 UI**，再进宿主验证真实能力。往返一次打包安装太慢了，方法见另一篇文档。
- **能力探测而不是版本判断**：`if (ant.player) {...}`，比对 `sdkVersion` 更耐用。
- **自己画背景色**。容器的 WebView 背景是透明的，你不设 `body { background }` 会看到宿主的背景图透上来。
- **给出加载与失败态**。`ant.request` 走的是真实网络，采集源更慢（可能几十秒）。
- **别在 `onHide` 之后继续轮询**，用户切后台了。
- **`viewport-fit=cover` + `env(safe-area-inset-*)`**，刘海屏和手势条区域要留出来。
- **深色模式**：宿主可以是深色主题，用 `prefers-color-scheme` 跟随，别硬写白底黑字。
- **移动端点击**：直接用 `click` 事件即可，不需要 fastclick 之类的老方案。
