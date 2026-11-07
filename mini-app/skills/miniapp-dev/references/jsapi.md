# ant JSAPI 参考（当前 SDK v6）

本文件是 skill 自带的完整参考，**不依赖宿主仓库**。在宿主仓库里工作时可以额外读
`docs/miniapp/` 下的三篇文档（更细，含技术设计与实战示例），行为有疑问时以宿主的
`assets/miniapp/ant-sdk.js` 与 `lib/miniapp/bridge/` 为准。

当前 `ant.version` 是 6，宿主 `getSystemInfo().sdkVersion` 仍为 5；优先检查具体方法是否存在。
老宿主上新增方法可能是 undefined 或返回 UNKNOWN_API。Python 后端详细说明见
[python.md](python.md)，需要时再读。

| 版本 | 新增 |
|---|---|
| v2 | `ant.request` 的 `responseType` / `followRedirects`、`ant.requestBytes`、`ant.base64ToBytes`、`ant.serve` 与 `service` 权限 |
| v3 | `ant.miniApp.open` / `getLaunchOptions` / `onOpen` 与 `miniapp` 权限 |
| v4 | `ant.player.open` 收 `sniff` 与 `source.play` 的解析字段：`parse`/`jx` 为 `'1'` 的线路能交给宿主嗅探 |
| 当前版本 | `ant.python.call`、python 服务块、`ant.file` 与 filesystem 权限、`ant.requestStream/requestSSE/readLines`、`ant.resolveService` |

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
| `node` | | 包内 Node.js 服务：`{"entry": "server/index.js", "config": "server/index.config.js"}`（`config` 可选，缺省找 entry 同目录的 `index.config.js`，都没有则 `start(null)`）。声明了就必须有 `node` 权限，入口/配置文件必须存在于包内；宿主以 worker 运行 `entry`（需导出 `start(config)`，监听 `process.env.DEV_HTTP_PORT`），可带 `node_modules`（上限 200MB / 10000 文件），寻址同样用 `miniapp://<appId>`。见开发引导 §4.11 |
| `network.allowlist` | | 两个用途：`ant.request` 能访问哪些域名（**不写等于不限制**）；WebView 能跳到哪些域名（**不写等于只能同源**，且导航不认 `*`，在线站点的登录域 / CDN 必须逐条写） |
| `python` | | `{"entry":"app.py"}`，必须有 python 权限且入口在包内，与 node 块互斥。顶层函数用于 ant.python.call；HTTP 服务导出 serve(request) 或 Flask/WSGI app，宿主负责加载/端口。后端包上限 200MB / 10000 文件 |
| `icon` | | http/https 图标或包内相对路径，缺失/加载失败时回退名称首字 |
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
| `filesystem` | `ant.file.*` |
| `network` | `ant.request`、`ant.requestJson`、`ant.requestBytes`、`ant.requestStream`、`ant.requestSSE` |
| `miniapp` | `ant.miniApp.open`、`ant.resolveService`（接收启动参数不需权限） |
| `python` | `ant.python.call` 与 manifest.python 本地后端 |
| `navigate` | `ant.navigateTo` / `redirectTo` / `navigateBack` / `exitMiniApp` |
| `player` | `ant.player.*` |
| `source` | `ant.source.*` |
| `service` | `ant.serve`（反过来给宿主提供 HTTP 服务） |
| `node` | manifest 的 `node` 块：包内 Node.js 服务由宿主以 worker 运行（manifest 级权限，没有对应的 `ant.*`） |

`ant.env.getSystemInfo()`、`ant.log()`、`ant.on/off/once`、`ant.tv.onKey` 不需要权限。

**声明了就直接可用**，运行期不再弹二次确认（安装页与详情页已完整展示过权限列表）。
没声明就调用会 reject 一个 `code === 'PERMISSION_DENIED'` 的 Error。按需申请：声明了却不用
的权限只会让用户更警惕。

`service` 比其它几个重：声明了它的小程序会被宿主在**用户没打开它的时候**后台拉起。
没有这个需求就别写。

## API

异步 JSAPI 返回 Promise；事件注册、readLines、base64 转换等同步工具不返回 Promise。失败时 reject 的 Error 带 `code` 与 `api` 字段。宿主在 document-start
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
  timeout: 8000,          // ms，缺省 15000，当前接收上限 600000
  responseType: 'text',   // 'text'（缺省）| 'base64'
  followRedirects: true   // false 时自己读 302 的 Location
});
// { statusCode: 200, headers: {...}, data: '原始响应字符串',
//   responseType: 'text', url: '重定向后的最终地址' }

const json = await ant.requestJson({ url: '...' });   // 非 2xx 或非法 JSON 会 reject
```

走宿主的 Dio，**不受浏览器 CORS 限制**——这是相对纯 H5 的最大优势。
限制：外网只允许 http/https；直接指定的回环与内网地址 `FORBIDDEN_HOST`；宿主解析的
`miniapp://<appId>/path` 服务及其注册端点可请求（不要猜端口/token/key）；响应体上限 10MB；
`host`、`content-length`、`connection` 三个请求头会被忽略。

**二进制响应**用 `responseType: 'base64'`，`data` 变成 base64 串（`byteLength` 是原始
字节数，10MB 上限按它算）。protobuf、gzip/brotli、GBK 网页这些都必须走这条——`'text'`
会让宿主按响应头的 charset 解码，二进制经此一遭就毁了。

```js
const bytes = await ant.requestBytes({ url: '...' });   // → Uint8Array
const same = ant.base64ToBytes(res.data);               // 手工转换
```

`window.fetch` 是浏览器原生的，**受 CORS 限制**，跨域取数据一律用 `ant.request`。
需要让第三方库无缝走宿主网络时，可以把 `globalThis.fetch` 换成一层基于
`ant.request` 的包装（`ant.serve` 那一节有完整例子的出处）。

### 流式请求、SSE 和服务地址

```js
const stream = await ant.requestStream({
  url:'https://api.example.com/events', timeout:600000,
  onHeaders(info) { /* {id,kind,statusCode,headers,url} */ },
  onData(text) { /* UTF-8 增量文本 */ },
  onError(error) { /* 异步流错误 */ },
  onDone() { /* 流已结束 */ }, onAbort() { /* 已取消 */ }
}); // {id, statusCode, abort}，拿到句柄不等于流结束
await stream.abort();
await ant.requestSSE({url:'miniapp://com.example.python/events'}, dataLine => console.log(dataLine));
const feed = ant.readLines(line => console.log(line)); // 返回喂文本块的函数，未结束的行留在 buffer
const url = await ant.resolveService('miniapp://com.example.python/path'); // [miniapp]，返回真实 http URL
```

network 权限覆盖流请求；readLines 不需权限。requestSSE 仅识别每行 data 字段，
不解析完整 SSE event/id/retry 语义。底层通知事件为 request.stream。
onError/onDone/onAbort 收尾，离开页面时按需取消；不要用 await 句柄判断业务已完成。
普通 ant.request 与流请求当前 timeout 都夹在 1~600 秒；流 timeout 主要用于连接/响应头等待，
不要把它当整体流时长或空闲超时保证。需应用级时限时自行计时 abort。
解析后的实际服务地址仅供当次使用，重新启动后端口可能改变。

### Python 函数

```js
const result = await ant.python.call('hello', {name:'读者'}, 2); // [python]，JSON 位置参数
```

需要 manifest.python.entry；调用入口文件的顶层函数，直接返回其 JSON 值。
不直接调用 Spider 的类方法；不要传 dotted 函数名。函数调用/HTTP/WSGI/依赖/平台及小说移植
见 [python.md](python.md)。

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

### 私有文件

需要 filesystem 权限，按 appId 隔离，升级保留，卸载清除；这是宿主 data/files，不是包内目录。
总配额 20MB、单文件 5MB、条目上限 2000、路径上限 512 字符；路径必须是私有目录内相对路径。

```js
await ant.file.write('notes/chapter.txt', '正文'); // 自动创建父目录，返回 stat
await ant.file.write('notes/chapter.txt', '\n后续正文', {append:true});
const text = await ant.file.read('notes/chapter.txt'); // 直接字符串
await ant.file.write('images/cover.bin', base64, {encoding:'base64'});
const data = await ant.file.read('images/cover.bin', {encoding:'base64'});
const info = await ant.file.stat('notes/chapter.txt'); // {path,type:'file'|'directory',size,modifiedAt}
const entries = await ant.file.list('notes'); // 同级条目数组，不递归；list('') 列根目录
await ant.file.mkdir('notes/archive');
await ant.file.rename('notes/chapter.txt', 'notes/archive/chapter.txt', {overwrite:false});
await ant.file.delete('notes/archive', {recursive:true});
```

当前配额检查较保守：覆盖文件也先按“已用空间 + 新内容”检查，追加后单文件可能超过读上限。
让缓存保持在上限以下，必要时先删除旧缓存再写；不要把大正文塞进 5MB 键值存储。

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
// → { route, url, sniff }；地址不可播放时 reject INVALID_URL

// 鉴权 / 防盗链源：带取流请求头（source.play 返回的 header 可原样传，单数也认）
await ant.player.open({ url, title: '片名', headers: { Referer: 'https://site.com/', Cookie: 'sid=...' } });
// → { route, url, sniff, headerKeys }

// 要宿主解析的线路（source.play 的 parse / jx 为 '1'，url 是网页地址）：
// 把整份结果传回去，宿主跑解析器竞速 + WebView 嗅探（v4 起）
await ant.player.open({ ...play, url: play.url, title: '片名', headers: play.header });
// 自己抓的站点没有这些字段时，显式声明「这是网页地址」
await ant.player.open({ url: 'https://site.com/watch/1', title: '片名', sniff: true });

const state = await ant.player.getState();
// { active:false } 或 { active:true, playing, position, duration }（毫秒）

const off = ant.player.onStateChange(s => console.log(s.playing, s.position));
ant.player.onClose(() => {/* 用户退出播放页了 */});
off();   // 取消监听
```

`headers` 会一路带到播放器内核与 M3U8 代理（分片取流也带）。上限 32 条、单值 8192 字符，
`Host` / `Content-Length` / `Connection` 被丢弃，超限 reject `INVALID_PARAMS`。
解析字段透传 `parse` / `jx` / `playUrl` / `flag` / `jxFrom` / `key`（决定宿主挑哪些解析源、
嗅探时用哪份点击规则）；`click` 不收——宿主会去把规则地址读回来，只认站点自己配的那份。
要宿主解析时 `url` 与 `playUrl` 必须是 http/https 且不能指向本机/内网（同 `ant.request`），
否则 `INVALID_URL` / `FORBIDDEN_HOST`；直链播放不受此限。
外挂字幕暂不支持。播放是整页跳转，退出后回到小程序并收到 `player.close`。
`stateChange` 由宿主按 500ms 节流推送。

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

### 反向服务（宿主调小程序）

需要 `service` 权限。把一段业务逻辑跑在 WebView 里，让**宿主自己的 Dart 代码**当本地
HTTP 服务来用——弹幕聚合就是这么接进播放器的。

```js
ant.serve(async (req) => {
  // req = { method, path, query, params, headers, body, url }
  if (req.path === '/api/v2/search/episodes') {
    const data = await search(req.params.anime, req.params.episode);
    return { status: 200, headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(data) };
  }
  return { status: 404, body: 'not found' };
});
```

`req.path` 已经剥掉宿主的令牌和 `__service` 前缀，就是干净的业务路径；`req.url` 是拼好
的完整地址，Cloudflare Worker 风格的代码可以直接 `new URL(req.url)`。

handler 的返回值支持三种写法：

| 返回 | 说明 |
|---|---|
| `Response` | 标准 Web `Response`，Worker 风格的服务直接透传即可 |
| `{status, headers, body}` | 二进制放 `bodyBase64` |
| 字符串 | 当作 200 text |

返回 `null` 或没调 `ant.serve`，宿主收到 503。

宿主侧用 `miniapp://<appId>[/path]` 引用这个服务（真地址每次启动都变，所以设置里存的是
这个逻辑地址）。播放器的「弹幕 API」填 `miniapp://com.logvar.danmu` 就是这么工作的：

- 宿主解析时会**按需把小程序后台拉起**，用户不用先手动打开它；
- 拉起后 WebView 一直挂在屏幕外跑，JS、定时器、`ant.request` 全部照常；
- 实例数达上限要回收时，声明了 `service` 的实例排在最后，不会被随手开的小程序挤掉；
- 单次调用 60s 超时（超了宿主收到 504），请求体 ≤1MB。

因此 handler 必须能在**页面不可见**时工作：别依赖 `requestAnimationFrame`、别等用户点击、
别把状态只放在 DOM 里。

**dev server 实例测不了这块**——它没有 loopback 服务，宿主没有可回调的入口，
只能装成 zip 之后验。

#### 共享到局域网

小程序详情页、或「小程序设置 → 局域网共享」里可以开（默认关，只对声明了 `service` 的小程序
显示）。开了之后宿主另起一个绑 `0.0.0.0:9321` 的服务，给出：

```
http://192.168.1.7:9321/<lanToken>
```

同一网络里的别的设备填这个地址就能共用你这份服务。

- **多个服务能同时开**：共用这一个端口（防火墙只放行一个就够），靠各自的 token 区分。
  token 互不相同，泄露一个不影响别的，单独重置某一个也不动其它；
- `lanToken` **持久化**，重启后不变——不然别的设备每次都要重配。「重置地址」换掉它，
  已经发出去的旧地址立刻失效；
- 只有服务路由被暴露，**包内文件一个都碰不到**；来源 IP 不是私有网段直接 403；
- 那个 token 就是唯一凭证。公共 WiFi 下开等于把你这个服务的能力（包括它的 `ant.request`
  出网能力）交给同网段所有人；
- 你自己那一层的鉴权照常生效，路径上叠加即可：
  `http://IP:9321/<lanToken>/<你的token>/api/…`。

现成例子：`danmu_api` 仓库的 `miniapp/`（`build-miniapp.js` 打包），整个弹幕聚合服务跑在
小程序里，播放器把弹幕源填成 `miniapp://com.logvar.danmu`。

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
  const url = Array.isArray(info.url)
    ? info.url.find(u => /^https?:/i.test(u)) : String(info.url || '');
  // info.header 是这条源的取流头，一起交给播放器，鉴权/防盗链源才播得动。
  // parse / jx 为 '1' 时 url 是网页地址：整份 info 传回去，宿主会解析 + 嗅探。
  await ant.player.open({
    ...info,
    url: url,
    title: vod.vod_name + ' · ' + line.episodes[0].name,
    headers: info.header
  });
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
| `INVALID_PATH` / `NOT_FOUND` / `FILE_TOO_LARGE` | 私有文件路径非法、不存在或大于 5MB | 使用相对路径、检查存在并分批存文件 |
| `ALREADY_EXISTS` | 文件重命名目标存在 | 显式 overwrite 或先清理；删除非空目录时明确 recursive |
| `PYTHON_ENTRY_MISSING` / `PYTHON_RUNTIME_UNAVAILABLE` / `PYTHON_CALL_FAILED` | Python 声明、运行时或调用失败 | 见 python.md |
| `SERVICE_UNAVAILABLE` | miniapp 服务未安装或无法加载 | 核对 service/node/python 与入口 |
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
| 请求超时 | 缺省 15s，当前普通/流请求参数上限 600s；流不保证整体/空闲时限 |
| 响应体 | ≤10MB |
| 被忽略的请求头 | `host`、`content-length`、`connection` |
| storage | 配额 5MB，key ≤256 字符，按 appId 隔离 |
| file | 配额 20MB，单文件 5MB、条目 2000、路径 ≤512 字符 |
| 采集源 | 单次 60s 超时，并发上限 3 |
| 反向服务 | 单次 60s 超时，请求体 ≤1MB；同时保活的实例总数 3 个 |
| 包体 | 单文件 ≤20MB，解压后 ≤100MB，文件数 ≤2000，不能有符号链接 |
| Node / Python 后端包 | 单文件 ≤20MB，解压后 ≤200MB，文件数 ≤10000，不能有符号链接 |

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
| `ant.request` 二进制 | `responseType:'base64'` 走 `arrayBuffer` 自己编码 | 宿主直接给 base64 |
| 域名白名单 | 不检查 | 检查 `network.allowlist` |
| 权限门禁 | 只在配了 `__antMockPermissions` 时检查 | 始终按 manifest 检查 |
| `ant.storage` | `localStorage` | 文件，5MB 配额 |
| `ant.file` | 独立 localStorage 模拟文件，仅验证交互 | 宿主私有文件目录、路径/配额校验 |
| `ant.python.call` | __antMockPython 假函数，或 dev_python.py 转发本机 Python | 包内入口 + 内嵌 CPython；dev server 调试不加载后端 |
| `ant.requestStream/requestSSE` | fetch + ReadableStream，受 CORS 限制 | 宿主消费流，增量通过 request.stream 事件推回 |
| `ant.resolveService` | __antMockServices 映射 | 自动加载已安装服务并返回注册端点 |
| `ant.player.open` | 页面内 `<video>` | 宿主全屏播放页（含 M3U8 代理与去广告） |
| `ant.player.open` 的 `headers` | 发不出去（只警告） | 带到内核与代理 |
| `ant.source.*` | `__antMockFixtures` 假数据 | 真站点，慢且可能失败 |
| `ant.serve` | 只把 handler 挂到 `window.__antServe`，自己在 devtools 里调 | 宿主的 loopback 服务真的会打进来 |
| 局域网共享 | 没有这回事 | 详情页/设置里开，`0.0.0.0:9321` |
| 后台运行 | 浏览器标签页节流 | 离屏但留在树里，JS 与定时器照常 |
| `ant.exitMiniApp` | 无操作 | 真的关掉 |
| 安全区 | 无 | 有，需要 `env(safe-area-inset-*)` |
| TV 按键 | 真键盘 | 遥控器，只转发 5 个键 |
| 背景色 | 浏览器白底 | **WebView 透明**，不设 `body` 背景会透出宿主背景图 |




