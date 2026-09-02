# 小程序开发引导

写给要给这个宿主做小程序的开发者。只需要会 HTML/JS/CSS，不需要碰 Flutter，也不需要重新编译宿主。

配套文档：[脱离宿主开发调试](miniapp-standalone-dev.md) · [JSAPI 参考](../skills/miniapp-dev/references/jsapi.md)（技术设计文档在宿主仓库 `docs/miniapp/` 下）

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
| `icon` | | 图标的**网络地址**（http/https）。不写、写成包内相对路径或者图挂了，宿主都用名称首字当图标 |
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

## 3. 权限

| id | 覆盖的 API |
|---|---|
| `ui` | `ant.ui.*`、`ant.clipboard.*` |
| `storage` | `ant.storage.*` |
| `network` | `ant.request`、`ant.requestJson` |
| `navigate` | `ant.navigateTo` / `redirectTo` / `navigateBack` / `exitMiniApp` |
| `player` | `ant.player.*` |
| `source` | `ant.source.*` |

`ant.env.getSystemInfo()` 和 `ant.log()` 不需要任何权限。

**声明了就能直接用**，运行期不会再弹确认框——用户在安装和详情页已经看得到完整的权限列表。

没声明就调用会 reject 一个 `code === 'PERMISSION_DENIED'` 的 Error。

**按需申请**：声明了但没用的权限只会让用户对你的小程序更警惕。

## 4. SDK 参考

所有方法返回 Promise。失败时 reject 的 Error 带 `code`（见第 7 节）与 `api` 字段。

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
  timeout: 8000           // ms，上限 30000
});
// { statusCode: 200, headers: {...}, data: '原始响应字符串' }

const json = await ant.requestJson({ url: '...' });   // 非 2xx 或非法 JSON 会 reject
```

请求走宿主的 HTTP 客户端，**不受浏览器 CORS 限制**——这是相对纯 H5 的最大优势。

限制：只允许 http/https；不允许访问 `localhost`、`127.x`、`10.x`、`172.16-31.x`、`192.168.x`、`169.254.x` 等回环与内网地址；响应体上限 10MB；`host`、`content-length`、`connection` 三个请求头不允许自定义。

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

### 4.6 播放器

把地址交给宿主播放页，自动复用 M3U8 代理、去广告、内核切换整条链路。

```js
await ant.player.open({ url: 'https://.../movie.m3u8', title: '片名' });

const state = await ant.player.getState();
// { active:false } 或 { active:true, playing, position, duration }（毫秒）

const off = ant.player.onStateChange(s => console.log(s.playing, s.position));
ant.player.onClose(() => console.log('用户退出播放页了'));
off();   // 取消监听
```

**当前只支持 `url` 和 `title`**。自定义请求头、外挂字幕暂不支持。播放是整页跳转，退出后回到小程序（会收到 `player.close`）。

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
- 拿到 `play` 的地址后接 `ant.player.open()` 就是一条完整的看片链路

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

## 5. 打包与发版

```bash
cd my-app
zip -r ../my-app-v2.zip . -x '.*' -x '__MACOSX*'
```

发新版本只有一件事必须做对：**`versionCode` 递增**。宿主按它判断"更新"，装上后旧版本目录会被自动清掉，`ant.storage` 的数据保留。

限制：单文件 ≤20MB，解压后总量 ≤100MB，文件数 ≤2000。包里不能有符号链接。

改 `appId` 等于换了一个小程序：数据不会迁移，权限要重新授权。

## 6. 分发给别人（市场 JSON）

把 zip 传到任何能直链下载的地方，再提供一个 JSON 列表地址，用户在「市场」Tab 填这个地址即可：

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
| `PERMISSION_DENIED` | 权限没声明，或用户拒绝了 | 在 manifest 补 `permissions` |
| `UNKNOWN_API` | API 名写错，或宿主版本太老 | 查拼写；用 `sdkVersion` 做能力判断 |
| `INVALID_PARAMS` | 必填参数缺失或非法 | 看 message 里点名的参数 |
| `INVALID_URL` | 不是 http/https，或地址不合法 | — |
| `FORBIDDEN_HOST` | 访问了回环/内网地址 | 这是硬限制，改不了 |
| `HOST_NOT_ALLOWED` | 域名不在 `network.allowlist` 里 | 补白名单 |
| `REQUEST_FAILED` | 网络层失败（超时、DNS、连接） | 重试或检查地址 |
| `RESPONSE_TOO_LARGE` | 响应超过 10MB | 分页拉取 |
| `QUOTA_EXCEEDED` | `ant.storage` 超 5MB | 清理旧数据 |
| `INVALID_KEY` | storage key 为空或超 256 字符 | — |
| `CROSS_ORIGIN` | 想跳到小程序之外的地址 | 把域名写进 `network.allowlist`，或用 `<a target="_blank">` 让用户确认后走浏览器 |
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

