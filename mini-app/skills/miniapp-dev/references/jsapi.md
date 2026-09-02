# ant JSAPI 参考（SDK v1）

本文件是 skill 自带的完整参考，**不依赖宿主仓库**。在宿主仓库里工作时可以额外读
`docs/miniapp/` 下的三篇文档（更细，含技术设计与实战示例），行为有疑问时以宿主的
`assets/miniapp/ant-sdk.js` 与 `lib/miniapp/bridge/` 为准。

## manifest.json

必须在包根。除它之外文件怎么组织都行，子目录、构建产物（`dist`）都可以。

| 字段 | 必填 | 说明 |
|---|---|---|
| `appId` | ✅ | 反向域名，至少两段，段内只允许字母数字下划线。**唯一键**：安装目录、`ant.storage` 分区、权限记录都以它为准，发布后不要改 |
| `name` | ✅ | 展示名 |
| `versionCode` | ✅ | 正整数，**升级判断只看这个**，每次发版必须 +1 |
| `version` | | 展示版本号如 `1.2.0`，不参与升级判断 |
| `renderer` | | 只能是 `webview`（缺省即此值）。`native` 是二期占位，写了会被拒绝安装 |
| `entry` | | 首屏。包内 HTML（缺省 `index.html`，可带子目录如 `pages/index.html`），或 `http`/`https` 地址＝在线站点型小程序（包里只需 manifest，容器直接开那个站点）。其它协议与 `//host/path` 拒装 |
| `permissions` | | 见下表。**没声明的能力一律调不通** |
| `network.allowlist` | | 两个用途：`ant.request` 能访问哪些域名（**不写等于不限制**）；WebView 能跳到哪些域名（**不写等于只能同源**，且导航不认 `*`，在线站点的登录域 / CDN 必须逐条写） |
| `icon` | | 图标的**网络地址**（http/https）。不写、写包内相对路径或图挂了，都退回名称首字 |
| `description` | | 一句话描述 |
| `minHostVersion` | | 最低宿主版本，低于它安装被拒（`HOST_TOO_OLD`） |
| `pages` | | 二期原生渲染用，现在写了不生效 |

`network.allowlist` 匹配规则：

| 规则 | `ant.request` | 导航（点链接 / `navigateTo` / iframe） |
|---|---|---|
| 不写这个字段 | 全部放行 | 只有入口 origin |
| `*` | 全部放行 | **不放行**（SDK 会注入进任何被加载的页面，等于把 JSAPI 权限给对方域名） |
| `*.example.com` | `api.example.com`、`a.b.example.com`，**也包括** `example.com` 自身 | 同左 |
| `api.foo.cn` | 精确匹配（大小写不敏感） | 同左 |

## 权限

| id | 覆盖的 API |
|---|---|
| `ui` | `ant.ui.*`、`ant.clipboard.*` |
| `storage` | `ant.storage.*` |
| `network` | `ant.request`、`ant.requestJson` |
| `navigate` | `ant.navigateTo` / `redirectTo` / `navigateBack` / `exitMiniApp` |
| `player` | `ant.player.*` |
| `source` | `ant.source.*` |

`ant.env.getSystemInfo()`、`ant.log()`、`ant.on/off/once`、`ant.tv.onKey` 不需要权限。

**声明了就直接可用**，运行期不再弹二次确认（安装页与详情页已完整展示过权限列表）。
没声明就调用会 reject 一个 `code === 'PERMISSION_DENIED'` 的 Error。按需申请：声明了却不用
的权限只会让用户更警惕。

## API

所有方法返回 Promise。失败时 reject 的 Error 带 `code` 与 `api` 字段。宿主在 document-start
注入 `window.ant`，**不要自己引 `ant-sdk.js`**。

### 环境与日志

```js
const info = await ant.env.getSystemInfo();
// { platform:'android'|'ios'|'macos'|'windows', osVersion, isTV,
//   appId, appName, appVersion, appVersionCode, devMode, permissions, sdkVersion }

ant.log('任何字符串');   // 进宿主日志与容器内日志面板
```

`console.*` 也会被容器捕获进日志面板，调试期不用刻意换成 `ant.log`。

### 网络

```js
const res = await ant.request({
  url: 'https://api.example.com/list',
  method: 'GET',          // GET/POST/PUT/DELETE/HEAD/PATCH
  headers: { 'User-Agent': 'my-app' },
  data: { page: 1 },      // POST 等方法的 body
  timeout: 8000           // ms，缺省 15000，夹在 1000~30000
});
// { statusCode: 200, headers: {...}, data: '原始响应字符串' }

const json = await ant.requestJson({ url: '...' });   // 非 2xx 或非法 JSON 会 reject
```

走宿主的 Dio，**不受浏览器 CORS 限制**——这是相对纯 H5 的最大优势。
限制：只允许 http/https；回环与内网地址一律 `FORBIDDEN_HOST`；响应体上限 10MB；
`host`、`content-length`、`connection` 三个请求头会被忽略。

### 存储

按 appId 隔离，别的小程序读不到。配额 5MB，key 上限 256 字符。

```js
await ant.storage.set('key', 'value');       // 值会被 String() 转换
const v = await ant.storage.get('key');      // 不存在返回 null
await ant.storage.setJSON('profile', { id: 1 });
const p = await ant.storage.getJSON('profile', {});   // 第二参数是兜底值
await ant.storage.remove('key');
await ant.storage.clear();
const keys = await ant.storage.keys();
```

`localStorage` 也能用，但每次启动小程序的 origin 端口都不同，**不保证跨启动保留**。

### 界面与剪贴板

```js
await ant.ui.toast('提示文字');
await ant.ui.loading('加载中…');
await ant.ui.hideLoading();

const ok = await ant.ui.confirm({
  title: '确认', content: '要删除吗？', confirmText: '删除', cancelText: '算了'
});                                              // → boolean
const index = await ant.ui.actionSheet(['选项一', '选项二']);   // → 下标，取消为 -1

await ant.clipboard.set('复制的内容');
const text = await ant.clipboard.get();
```

### 导航

```js
await ant.navigateTo('page2.html');            // 相对入口解析
await ant.navigateTo('pages/detail.html?id=7');
await ant.redirectTo('index.html');
const moved = await ant.navigateBack();        // {moved:false} 表示没有历史了
await ant.exitMiniApp();                       // 关掉整个小程序
```

只能跳自身 origin 内的地址，以及 `network.allowlist` 里写了的域名；其余 reject `CROSS_ORIGIN`。
要开真正的外部网页就放一个真实的 `<a href="https://…" target="_blank">`，容器会弹确认框后交给
系统浏览器。

物理返回键 / 手势返回 / 桌面 Esc 会先走 WebView 历史栈，没历史了才退出容器，不用自己处理。

### 播放器

把地址交给宿主播放页，自动复用 M3U8 代理、去广告、内核切换整条链路。

```js
await ant.player.open({ url: 'https://.../movie.m3u8', title: '片名' });
// → { route, url }；地址不可播放时 reject INVALID_URL

const state = await ant.player.getState();
// { active:false } 或 { active:true, playing, position, duration }（毫秒）

const off = ant.player.onStateChange(s => console.log(s.playing, s.position));
ant.player.onClose(() => {/* 用户退出播放页了 */});
off();   // 取消监听
```

**只支持 `url` 和 `title`**，自定义请求头与外挂字幕暂不支持。播放是整页跳转，
退出后回到小程序并收到 `player.close`。`stateChange` 由宿主按 500ms 节流推送。

### 采集源

调用宿主里用户已经配好的站点，返回结构与宿主内部的 CMS/TVBox 数据模型一致（`vod_*` 蛇形字段）。

```js
const sites = await ant.source.list();                         // [{key,name,type,searchable}]
const home   = await ant.source.home(sites[0].key);
const list   = await ant.source.category({ siteKey, tid: '1', page: 1, ext: {} });
const detail = await ant.source.detail({ siteKey, id: 'xxx' });
const play   = await ant.source.play({ siteKey, flag: '', id: 'xxx' });
const found  = await ant.source.search({ siteKey, wd: '关键词', page: 1 });
// found.list → [{ vod_id, vod_name, vod_pic, vod_remarks, ... }]
```

注意：

- 用户可能一个站点都没配，`list()` 返回空数组要处理
- 单次调用超时 60s，同时最多 3 个在飞，超了 reject `TOO_MANY_REQUESTS`
- 站点的真实 api 地址与 ext 不外泄，只能拿到 `key`
- 影视模块没初始化时整组 API reject `UNAVAILABLE`

### 事件与生命周期

```js
ant.onShow(d => {});     // 页面加载完成 / 应用回前台
ant.onHide(d => {});     // 应用进入后台（该停轮询了）

const off = ant.on('player.stateChange', s => {});
ant.once('player.close', () => {});
ant.off('player.stateChange');           // 移除该事件的所有监听
```

事件表：`app.show`、`app.hide`、`player.open`、`player.stateChange`、`player.close`、`keydown`。

### TV 遥控

TV 上 WebView 不参与系统焦点，方向键由容器转发进来；**不处理这个事件的小程序在电视上没法操作**。

```js
ant.tv.onKey(e => {
  // e.key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter'
});
```

脚手架的 `app.js` 末尾有一份可直接用的实现：按 DOM 顺序在可聚焦元素间移动 `focus()`，
`Enter` 触发 `click()`，并 `scrollIntoView`。配合明显的焦点样式：

```css
:focus-visible { outline: 3px solid #ffb020; outline-offset: 2px; }
```

TV 上菜单键开合容器悬浮球（展开时方向键归焦点导航，不再转发给小程序）。

## 完整看片链路

`source.*` + `player.open` 拼起来就是一条看片链路。下面这段的字段约定都是宿主实际返回的形状。

```js
/* 关键约定：
 *   vod_play_from / vod_play_url 到小程序手里已经是数组（宿主按 $$$ 切好了）
 *   线内格式是 `名称$地址#名称$地址`
 *   取播放地址统一走 source.play：CMS 源原样回显，爬虫源（T3/T4/T5）会去解析，调用方不用区分
 */
function parseLines(vod) {
  var froms = vod.vod_play_from || [];
  var urls = vod.vod_play_url || [];
  var lines = [];
  for (var i = 0; i < Math.max(froms.length, urls.length); i++) {
    var raw = String(urls[i] || '');
    if (!raw) continue;
    var episodes = raw.split('#').map(function (chunk) {
      var text = String(chunk).trim();
      if (!text) return null;
      var at = text.indexOf('$');
      return at < 0
        ? { name: text, id: text }
        : { name: text.slice(0, at).trim() || '播放', id: text.slice(at + 1).trim() };
    }).filter(Boolean);
    if (episodes.length) {
      lines.push({ name: String(froms[i] || '').trim() || '线路' + (i + 1), episodes: episodes });
    }
  }
  return lines;
}

async function playFirstMatch(keyword) {
  const sites = await ant.source.list();
  if (!sites.length) return ant.ui.toast('宿主里还没配置采集源');
  const site = sites.find(s => s.searchable) || sites[0];

  const found = await ant.source.search({ siteKey: site.key, wd: keyword, page: 1 });
  const hit = (found.list || [])[0];
  if (!hit) return ant.ui.toast('没搜到');

  const detail = await ant.source.detail({ siteKey: site.key, id: hit.vod_id });
  const vod = (detail.list || [])[0] || hit;
  const line = parseLines(vod)[0];
  if (!line) return ant.ui.toast('这条结果没有可播线路');

  const info = await ant.source.play({
    siteKey: site.key, flag: line.name, id: line.episodes[0].id
  });
  // parse/jx 为 '1' 表示需要宿主内置嗅探，小程序里放不了，得换线路
  if (String(info.parse) === '1' || String(info.jx) === '1') {
    return ant.ui.toast('这条线路需要宿主解析，换一条试试');
  }
  const url = Array.isArray(info.url)
    ? info.url.find(u => /^https?:/i.test(u)) : String(info.url || '');
  await ant.player.open({ url: url, title: vod.vod_name + ' · ' + line.episodes[0].name });
}
```

## 错误码

```js
try { await ant.request({ url: '...' }); } catch (e) { console.log(e.code, e.message); }
```

| code | 含义 | 怎么改 |
|---|---|---|
| `PERMISSION_DENIED` | 权限没声明 | manifest 补 `permissions` |
| `UNKNOWN_API` | API 名写错，或宿主版本太老 | 查拼写；用 `sdkVersion` 做能力判断 |
| `INVALID_PARAMS` | 必填参数缺失或非法 | 看 message 里点名的参数 |
| `INVALID_URL` | 不是 http/https、地址不合法，或不是可播放地址 | — |
| `FORBIDDEN_HOST` | 访问了回环/内网地址 | 硬限制，改不了 |
| `HOST_NOT_ALLOWED` | 域名不在 `network.allowlist` 里 | 补白名单 |
| `REQUEST_FAILED` | 网络层失败（超时、DNS、连接） | 重试或检查地址 |
| `RESPONSE_TOO_LARGE` | 响应超过 10MB | 分页拉取 |
| `QUOTA_EXCEEDED` | `ant.storage` 超 5MB | 清理旧数据 |
| `INVALID_KEY` | storage key 为空或超 256 字符 | — |
| `CROSS_ORIGIN` | 想跳到小程序之外的地址 | 把域名写进 `network.allowlist`，或用 `<a target="_blank">` 让用户确认后走浏览器 |
| `UNAVAILABLE` | 宿主对应模块未就绪 | 降级处理 |
| `SITE_NOT_FOUND` / `SITE_UNAVAILABLE` | siteKey 不存在 / 站点没有可用接口 | 先 `source.list()` 拿真实 key |
| `TOO_MANY_REQUESTS` | 采集源并发超过 3 | 串行化请求 |
| `TIMEOUT` | 采集源 60s 没返回 | 换站点 |
| `SOURCE_FAILED` | 站点自身报错 | 看 message |
| `INTERNAL_ERROR` | 宿主内部异常 | 看容器日志面板 |

安装期错误码（预检脚本会提前拦下）：`MISSING_MANIFEST`、`INVALID_APP_ID`、
`INVALID_VERSION_CODE`、`UNSUPPORTED_RENDERER`、`ENTRY_MISSING`、`UNSAFE_PATH`、`HOST_TOO_OLD`。

## 硬限制汇总

| 项 | 限制 |
|---|---|
| 请求 | 只允许 http/https；回环与内网（`localhost`、`127.x`、`10.x`、`172.16-31.x`、`192.168.x`、`169.254.x`、`fc00::/7`、`fe80::/10`）一律拒绝 |
| 请求超时 | 缺省 15s，夹在 1~30s |
| 响应体 | ≤10MB |
| 被忽略的请求头 | `host`、`content-length`、`connection` |
| storage | 配额 5MB，key ≤256 字符，按 appId 隔离 |
| 采集源 | 单次 60s 超时，并发上限 3 |
| 包体 | 单文件 ≤20MB，解压后 ≤100MB，文件数 ≤2000，不能有符号链接 |

## 分发（市场 JSON）

zip 传到任何能直链下载的地方，再给一个 JSON 列表地址，用户在「市场」Tab 填这个地址：

```json
{
  "apps": [{
    "appId": "com.yourname.hello", "name": "Hello",
    "version": "1.0.1", "versionCode": 2,
    "url": "https://cdn.example.com/hello-v2.zip",
    "md5": "9e107d9d372bb6826bd81d3542a419d6", "size": 20480,
    "icon": "https://cdn.example.com/hello.png",
    "author": "yourname", "description": "一句话介绍"
  }]
}
```

- `appId`、`url` 缺一不可，其余可选；缺字段的条目会被静默跳过
- 给了 `md5` 宿主就会校验，不匹配拒绝安装（`pack_miniapp.py` 会打印 size 与 md5）
- `versionCode` 高于本地版本时按钮显示"更新"
- 顶层用 `apps` / `list` / `data` 或直接给数组都能识别

## mock 与真机的行为差异

| 项 | 浏览器 mock | 宿主真机 |
|---|---|---|
| `ant.request` CORS | 受限 | 不受限 |
| `ant.request` 内网地址 | 能打通 | `FORBIDDEN_HOST` |
| 域名白名单 | 不检查 | 检查 `network.allowlist` |
| 权限门禁 | 只在配了 `__antMockPermissions` 时检查 | 始终按 manifest 检查 |
| `ant.storage` | `localStorage` | 文件，5MB 配额 |
| `ant.player.open` | 页面内 `<video>` | 宿主全屏播放页（含 M3U8 代理与去广告） |
| `ant.source.*` | `__antMockFixtures` 假数据 | 真站点，慢且可能失败 |
| `ant.exitMiniApp` | 无操作 | 真的关掉 |
| 安全区 | 无 | 有，需要 `env(safe-area-inset-*)` |
| TV 按键 | 真键盘 | 遥控器，只转发 5 个键 |
| 背景色 | 浏览器白底 | **WebView 透明**，不设 `body` 背景会透出宿主背景图 |




