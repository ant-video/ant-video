# 脱离宿主开发调试小程序

宿主是个 Flutter 应用，编译一次几分钟，打包安装一次也要十几秒。**不要在宿主里写代码**。这篇讲怎么在浏览器里把小程序写完，最后才进宿主验收。

配套文档：[开发引导](miniapp-developer-guide.md) · [JSAPI 参考](../skills/miniapp-dev/references/jsapi.md)（技术设计文档在宿主仓库 `docs/miniapp/` 下）

---

## 1. 三个阶段

| 阶段 | 跑在哪 | 改一行代码的反馈 | 能验证 | 不能验证 |
|---|---|---|---|---|
| ① 纯浏览器 | Chrome / Safari + mock SDK | 刷新即可，热更新更快 | 布局、交互、业务逻辑、状态管理 | 真实 JSAPI 行为、权限、播放器、采集源 |
| ② 宿主调试模式 | 宿主容器直连你的 dev server | 点一下「重新加载」 | 全部真实能力、TV 遥控、真机表现 | 安装流程、`manifest` 校验（含权限声明） |
| ③ 打包安装 | 宿主，正式安装 | 重新打包 + 导入 | manifest 校验、升级、卸载、分发 | — |

90% 的时间应该待在阶段 ①。

## 2. 阶段① 纯浏览器 + mock SDK

### 2.1 起一个静态服务

小程序在宿主里是通过 HTTP 加载的（不是 `file://`），所以本地也要用 HTTP，否则 `fetch`、模块化、`localStorage` 的行为都跟真实环境不一致。

```bash
cd my-app
python3 -m http.server 3000
# 或者
npx serve -l 3000
# 或者
npx vite            # 有构建流程时
```

打开 `http://localhost:3000`。

### 2.2 引入 mock SDK

把下面这份代码存成 `ant-mock.js` 放在你的项目里，在入口 HTML 的**最前面**引入：

```html
<head>
  <meta charset="utf-8" />
  <!-- 只在浏览器里生效；宿主里 window.ant 已由容器注入，这份会自动退让 -->
  <script src="ant-mock.js"></script>
</head>
```

打包时把它排除掉，或者干脆留着——它检测到宿主注入的真 SDK 会直接不干活，留着也无害（只多几 KB）。

### 2.3 ant-mock.js

```js
/*!
 * ant-mock.js —— 浏览器里的 window.ant 模拟实现，仅用于开发。
 * 宿主容器会在 document-start 注入真 SDK，此时本文件自动退让。
 */
(function () {
  'use strict';
  if (window.ant) return;                       // 真 SDK 已在，什么都不做

  var listeners = {};
  var KEY_PREFIX = 'ant-mock:';

  function on(event, handler) {
    if (typeof handler !== 'function') return function () {};
    (listeners[event] = listeners[event] || []).push(handler);
    return function () { off(event, handler); };
  }
  function off(event, handler) {
    var list = listeners[event];
    if (!list) return;
    if (!handler) { delete listeners[event]; return; }
    var i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }
  function once(event, handler) {
    var dispose = on(event, function (d) { dispose(); handler(d); });
    return dispose;
  }
  function emit(event, data) {
    (listeners[event] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[ant-mock] ' + event, e); }
    });
  }
  window.__antEmit = function (p) { if (p && p.event) emit(p.event, p.data); };

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return Promise.reject(e);
  }

  /* 权限门禁也模拟一下，否则真机上才发现忘了声明 */
  var declared = (window.__antMockPermissions || null);
  function need(permission) {
    if (declared === null) return null;         // 没配就不检查
    if (declared.indexOf(permission) >= 0) return null;
    return fail('PERMISSION_DENIED', 'manifest 未声明 ' + permission + ' 权限（mock 检查）');
  }

  /* ---- toast / loading 的极简 DOM 实现 ---- */
  function toastEl(text) {
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:99999;' +
      'max-width:80%;padding:10px 16px;border-radius:8px;background:rgba(0,0,0,.82);' +
      'color:#fff;font-size:14px;line-height:1.4;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2000);
  }
  var loadingEl = null;

  window.ant = {
    version: 1,
    mock: true,

    invoke: function (api, params) {
      console.warn('[ant-mock] 未实现的 API: ' + api, params);
      return fail('UNKNOWN_API', 'mock 未实现: ' + api);
    },
    on: on, off: off, once: once,

    env: {
      getSystemInfo: function () {
        return Promise.resolve({
          platform: 'browser',
          osVersion: navigator.userAgent,
          isTV: !!window.__antMockTV,
          appId: window.__antMockAppId || 'dev.mock',
          appName: 'mock',
          appVersion: '0.0.0',
          appVersionCode: 0,
          devMode: true,
          permissions: declared || [],
          sdkVersion: 1,
          mock: true
        });
      }
    },

    log: function (m) { console.log('[ant.log]', m); return Promise.resolve(); },

    /* 浏览器里走 fetch —— 会受 CORS 限制，真机不会，见文档第 2.5 节 */
    request: function (options) {
      var o = typeof options === 'string' ? { url: options } : (options || {});
      var denied = need('network');
      if (denied) return denied;
      var init = { method: o.method || 'GET', headers: o.headers || undefined };
      if (o.data !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
        init.body = typeof o.data === 'string' ? o.data : JSON.stringify(o.data);
      }
      return fetch(o.url, init).then(function (res) {
        return res.text().then(function (text) {
          var headers = {};
          res.headers.forEach(function (v, k) { headers[k] = [v]; });
          return { statusCode: res.status, headers: headers, data: text };
        });
      }).catch(function (e) {
        return fail('REQUEST_FAILED', String(e && e.message || e));
      });
    },
    requestJson: function (options) {
      return window.ant.request(options).then(function (res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          var e = new Error('HTTP ' + res.statusCode);
          e.code = 'HTTP_' + res.statusCode;
          throw e;
        }
        return JSON.parse(res.data);
      });
    },

    storage: {
      get: function (k) {
        var denied = need('storage'); if (denied) return denied;
        return Promise.resolve(localStorage.getItem(KEY_PREFIX + k));
      },
      set: function (k, v) {
        var denied = need('storage'); if (denied) return denied;
        localStorage.setItem(KEY_PREFIX + k, String(v));
        return Promise.resolve();
      },
      getJSON: function (k, fb) {
        return window.ant.storage.get(k).then(function (v) {
          if (v === null) return fb;
          try { return JSON.parse(v); } catch (e) { return fb; }
        });
      },
      setJSON: function (k, v) { return window.ant.storage.set(k, JSON.stringify(v)); },
      remove: function (k) { localStorage.removeItem(KEY_PREFIX + k); return Promise.resolve(); },
      clear: function () {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(KEY_PREFIX) === 0) localStorage.removeItem(k);
        });
        return Promise.resolve();
      },
      keys: function () {
        return Promise.resolve(Object.keys(localStorage)
          .filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; })
          .map(function (k) { return k.slice(KEY_PREFIX.length); }));
      }
    },

    ui: {
      toast: function (m) { toastEl(String(m)); return Promise.resolve(); },
      loading: function (m) {
        if (!loadingEl) {
          loadingEl = document.createElement('div');
          loadingEl.style.cssText =
            'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.35);color:#fff;font-size:14px';
          document.body.appendChild(loadingEl);
        }
        loadingEl.textContent = m || '加载中...';
        return Promise.resolve();
      },
      hideLoading: function () {
        if (loadingEl) { loadingEl.remove(); loadingEl = null; }
        return Promise.resolve();
      },
      confirm: function (options) {
        var o = typeof options === 'string' ? { content: options } : (options || {});
        return Promise.resolve(window.confirm((o.title ? o.title + '\n\n' : '') + (o.content || '')));
      },
      actionSheet: function (items) {
        var text = (items || []).map(function (s, i) { return i + ': ' + s; }).join('\n');
        var input = window.prompt('选择一项（输入下标，取消为 -1）\n' + text, '0');
        var index = parseInt(input, 10);
        return Promise.resolve(isNaN(index) ? -1 : index);
      }
    },

    clipboard: {
      set: function (t) { return (navigator.clipboard ? navigator.clipboard.writeText(String(t)) : Promise.resolve()); },
      get: function () { return (navigator.clipboard ? navigator.clipboard.readText() : Promise.resolve('')); }
    },

    navigateTo: function (url) { location.href = url; return Promise.resolve({ url: url }); },
    redirectTo: function (url) { location.replace(url); return Promise.resolve({ url: url }); },
    navigateBack: function () { history.back(); return Promise.resolve({ moved: true }); },
    exitMiniApp: function () { console.warn('[ant-mock] exitMiniApp（浏览器里无操作）'); return Promise.resolve(); },

    onShow: function (h) { return on('app.show', h); },
    onHide: function (h) { return on('app.hide', h); },

    player: {
      /* 用一个全屏 <video> 顶替宿主播放页，事件序列与真机一致 */
      open: function (options) {
        var o = typeof options === 'string' ? { url: options } : (options || {});
        var denied = need('player'); if (denied) return denied;
        emit('player.open', { url: o.url, title: o.title || o.url });

        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000';
        var video = document.createElement('video');
        video.src = o.url;
        video.controls = true;
        video.autoplay = true;
        video.style.cssText = 'width:100%;height:100%';
        var close = document.createElement('button');
        close.textContent = '关闭';
        close.style.cssText = 'position:absolute;top:12px;left:12px;z-index:1;padding:8px 14px';
        wrap.appendChild(video);
        wrap.appendChild(close);
        document.body.appendChild(wrap);

        var timer = setInterval(function () {
          emit('player.stateChange', {
            playing: !video.paused,
            position: Math.round(video.currentTime * 1000),
            duration: Math.round((video.duration || 0) * 1000)
          });
        }, 500);
        window.__antMockVideo = video;

        close.addEventListener('click', function () {
          clearInterval(timer);
          wrap.remove();
          window.__antMockVideo = null;
          emit('player.close', { url: o.url });
        });
        return Promise.resolve({ route: '/mock', url: o.url });
      },
      getState: function () {
        var v = window.__antMockVideo;
        if (!v) return Promise.resolve({ active: false });
        return Promise.resolve({
          active: true,
          playing: !v.paused,
          position: Math.round(v.currentTime * 1000),
          duration: Math.round((v.duration || 0) * 1000)
        });
      },
      onStateChange: function (h) { return on('player.stateChange', h); },
      onClose: function (h) { return on('player.close', h); }
    },

    /* 采集源没法模拟，返回你自己准备的假数据 */
    source: (function () {
      function fx(name, fallback) {
        var all = window.__antMockFixtures || {};
        return Promise.resolve(all[name] !== undefined ? all[name] : fallback);
      }
      function guarded(fn) {
        return function () {
          var denied = need('source');
          return denied || fn.apply(null, arguments);
        };
      }
      return {
        list: guarded(function () {
          return fx('sites', [{ key: 'mock', name: '假站点', type: 1, searchable: 1 }]);
        }),
        home: guarded(function () { return fx('home', { class: [] }); }),
        category: guarded(function () { return fx('category', { list: [] }); }),
        detail: guarded(function () { return fx('detail', {}); }),
        play: guarded(function () { return fx('play', { url: '' }); }),
        search: guarded(function () { return fx('search', { list: [] }); })
      };
    })(),

    tv: {
      onKey: function (h) { return on('keydown', h); }
    }
  };

  /* 浏览器里用真键盘模拟遥控器 */
  window.addEventListener('keydown', function (e) {
    var map = {
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Enter: 'Enter'
    };
    if (map[e.key]) emit('keydown', { key: map[e.key] });
  });

  /* 页面可见性 → app.show / app.hide */
  document.addEventListener('visibilitychange', function () {
    emit(document.hidden ? 'app.hide' : 'app.show', { reason: 'lifecycle' });
  });
  window.addEventListener('load', function () {
    emit('app.show', { url: location.href });
  });

  console.info('[ant-mock] 已启用浏览器模拟 SDK');
})();
```

### 2.4 配置 mock 的行为

在引入 `ant-mock.js` **之前**设置这几个全局变量：

```html
<script>
  // 让 mock 也做权限检查，值要和 manifest.permissions 保持一致。
  // 不设置则不检查——建议设置，否则真机上才发现漏声明。
  window.__antMockPermissions = ['ui', 'storage', 'network', 'player'];

  window.__antMockAppId = 'com.yourname.hello';
  window.__antMockTV = false;            // 想验证 TV 焦点逻辑时改 true

  // 采集源的假数据，字段结构照抄宿主返回的 vod_* 蛇形命名
  window.__antMockFixtures = {
    sites: [{ key: 'demo', name: '演示站', type: 1, searchable: 1 }],
    search: {
      list: [
        { vod_id: '1', vod_name: '测试影片', vod_pic: '', vod_remarks: '全 12 集' }
      ]
    },
    play: { url: 'https://media.w3.org/2010/05/sintel/trailer.mp4' }
  };
</script>
<script src="ant-mock.js"></script>
```

采集源的真实返回结构可以这样抓：在宿主调试模式下跑一次 `ant.source.search(...)`，日志面板里能看到完整返回，复制出来当 fixture。

### 2.5 CORS：浏览器阶段唯一的硬伤

`ant.request` 在宿主里走的是 Dart 侧的 HTTP 客户端，**没有 CORS 概念**；mock 用 `fetch`，会被浏览器拦。三种解法：

| 解法 | 适用 | 做法 |
|---|---|---|
| 用假数据 | 大多数情况，最推荐 | 在 `__antMockFixtures` 里放假数据，或在 mock 的 `request` 前面加一层路由返回本地 JSON |
| 本地代理 | 需要打真接口 | Vite：`server.proxy`；或起个 `local-cors-proxy`，把 `ant.request` 的 url 换成代理地址 |
| 关掉浏览器安全策略 | 临时验证 | 单独开一个实例：`open -na "Google Chrome" --args --user-data-dir=/tmp/ant-dev --disable-web-security`。**只用来调试，别用这个实例上网** |

Vite 代理示例：

```js
// vite.config.js
export default {
  base: './',                        // 关键：必须是相对路径，见第 5 节
  server: {
    host: true,                      // 让局域网内的手机/电视能访问到
    port: 3000,
    proxy: { '/api': { target: 'https://api.example.com', changeOrigin: true } }
  }
};
```

### 2.6 移动端视觉与真机远程调试

- Chrome DevTools 的设备模拟（Cmd+Shift+M）先把布局压到手机尺寸
- 深色模式：DevTools → 命令面板（Cmd+Shift+P）→ `Emulate CSS prefers-color-scheme: dark`
- 安全区：模拟器不会给你 `env(safe-area-inset-*)`，这个必须真机验证

## 3. 阶段② 宿主调试模式

代码仍然跑在你的 dev server 上，但 JSAPI 是**真的**。这是唯一能验证真实播放器、真实采集源、TV 遥控的方式。

### 3.1 接上

1. dev server 必须监听 `0.0.0.0`（不是 `127.0.0.1`），否则手机连不上
   - `python3 -m http.server 3000 --bind 0.0.0.0`
   - Vite：`server.host = true`
2. 查本机局域网 IP：`ipconfig getifaddr en0`（macOS）
3. 宿主：小程序 → 右上角 🐞 → 填 `http://192.168.x.x:3000` → 启动调试

| 目标设备 | 地址 |
|---|---|
| macOS / Windows 桌面端宿主 | `http://127.0.0.1:3000` 也可以 |
| Android / iOS 真机 | 必须用局域网 IP，且和电脑在同一 Wi-Fi |
| Android 模拟器 | `http://10.0.2.2:3000` 指向宿主机 |
| Android TV 模拟器 | 同上；注意本项目 TV 模拟器有 DNS 与时钟问题，局域网 IP 更稳 |

明文 HTTP 不用额外配置——宿主已全局允许（Android `usesCleartextTraffic`、iOS `NSAllowsArbitraryLoads`）。

### 3.2 调试模式和正式安装的区别

| | 调试模式 | 正式安装 |
|---|---|---|
| 代码来源 | 你的 dev server | 宿主沙盒里解压好的包 |
| `manifest.json` | **完全不读** | 读且严格校验 |
| 权限 | 全开，不检查 | 按 manifest 声明检查（声明了即放行，无二次确认） |
| appId | 固定 `dev.playground` | 你的 `appId` |
| `ant.storage` | 存在 `dev.playground` 分区 | 存在自己的分区 |
| 标识 | 顶部橙色横幅 | 无 |

两个直接后果：

- **调试模式验证不了权限声明**。这就是建议在 mock 里配 `__antMockPermissions` 的原因。
- **调试期存的数据，正式安装后读不到**（分区不同）。别拿调试期的数据当测试基线。

### 3.3 改代码后怎么刷新

点开悬浮球里的「重新加载」（悬浮球默认贴右侧中部，可以拖走）。dev server 自带 HMR（Vite 等）的话很多时候会自己热更新，但整包结构变化后手动点一下更可靠。

### 3.4 看真机上的 console

日志面板已经收了 `console.*`、JSAPI 调用与返回、加载失败，多数问题看它就够。要用完整 DevTools：

| 平台 | 方法 |
|---|---|
| Android | Chrome 打开 `chrome://inspect`，找到设备里的 WebView |
| iOS / macOS | Safari → 开发 菜单 → 选设备与页面 |

注意 `isInspectable` 只在 debug 构建下打开（`webview_renderer.dart`），**release 包无法 inspect**。

## 4. 阶段③ 打包验收

```bash
cd my-app
zip -r ../my-app.zip . -x '.*' -x '__MACOSX*'
```

有构建流程的话打包 `dist`：

```bash
npm run build
cd dist && zip -r ../my-app.zip . && cd ..
```

只是想在宿主里过一遍、还不打算分发的话，`+` → 「导入文件夹」直接选目录（或 `dist/`）
更快，校验规则和 zip 一样，`.git` / `node_modules` 之类会自动跳过。

导入宿主前自查这几条，它们只在正式安装时才会被检查：

- [ ] `manifest.json` 在 zip **根目录**（或唯一一层外层目录里）；导入文件夹时同理
- [ ] `entry` 指向的文件真实存在
- [ ] `permissions` 覆盖了你实际调用的所有 API
- [ ] `versionCode` 比上一版大
- [ ] `network.allowlist` 覆盖了你请求的所有域名（或者干脆不写这个字段）
- [ ] 没有符号链接；单文件 ≤20MB，总量 ≤100MB，文件数 ≤2000

装完至少走一遍：冷启动 → 每个主要交互 → 播放 → 退出播放页回到小程序 → 退出小程序 → 再次打开（验证 `ant.storage` 真的持久化了）。

如果你要做的其实是「把一个已经上线的站点装进宿主」，那不用走上面这套：`manifest.entry` 直接写线上地址，包里只留 `manifest.json`，用 `+` → 「从链接安装」装。规则见开发者指南的「在线站点型小程序」一节——重点是站点会跳到的域名都得写进 `network.allowlist`。

## 5. 用 Vue / React 等构建工具

唯一必须改的一项：**产物里的资源引用必须是相对路径**。小程序是挂在 `http://127.0.0.1:<port>/<token>/` 这个带前缀的路径下的，绝对路径 `/assets/index.js` 会打到 token 之外，直接 404。

| 工具 | 配置 |
|---|---|
| Vite | `base: './'` |
| Vue CLI | `publicPath: './'` |
| Create React App | `"homepage": "."`（package.json） |
| Webpack | `output.publicPath: './'` |

其它注意：

- **路由用 hash 模式**。history 模式依赖服务端 fallback，容器的静态服务不做 SPA 回退，刷新即 404。
- 把 `ant-mock.js` 放 `public/` 并在 `index.html` 里用相对路径引，或者只在开发时 `if (import.meta.env.DEV) await import('./ant-mock.js')`。

## 6. mock 与真机的行为差异

| 项 | 浏览器 mock | 宿主真机 |
|---|---|---|
| `ant.request` CORS | 受限 | 不受限 |
| `ant.request` 内网地址 | 能打通 | `FORBIDDEN_HOST` |
| `ant.request` 域名白名单 | 不检查 | 检查 `network.allowlist` |
| 权限门禁 | 只在配了 `__antMockPermissions` 时检查 | 始终按 manifest 声明检查 |
| `ant.storage` | `localStorage`，容量按浏览器 | 文件，5MB 配额，超限 `QUOTA_EXCEEDED` |
| `ant.player.open` | 页面内 `<video>` | 跳宿主全屏播放页（含 M3U8 代理与去广告） |
| `ant.source.*` | 你给的假数据 | 真站点，慢且可能失败 |
| `ant.navigateBack` | `history.back()` | WebView 历史；没有历史时返回 `{moved:false}` 并由容器接管退出 |
| `ant.exitMiniApp` | 无操作 | 真的关掉小程序 |
| 安全区 | 无 | 有，需要 `env(safe-area-inset-*)` |
| TV 按键 | 真键盘 | 遥控器，且只有 5 个键会转发 |
| 背景色 | 浏览器白底 | **WebView 透明**，不设 `body` 背景会看到宿主背景图 |

## 7. 排查表

| 现象 | 原因 |
|---|---|
| 白屏，日志里一堆 404 | 产物用了绝对路径。改 `base: './'` |
| `window.ant is undefined` | 在宿主里出现说明 SDK 注入失败（看日志面板）；在浏览器里说明忘了引 `ant-mock.js` |
| 手机连不上 dev server | server 绑了 `127.0.0.1`；或不在同一 Wi-Fi；或被防火墙拦 |
| 调试模式能跑，装包后报 `PERMISSION_DENIED` | 调试模式权限全开，`manifest.permissions` 漏了 |
| 装包后 `HOST_NOT_ALLOWED` | `network.allowlist` 没覆盖到该域名 |
| 安装报 `MISSING_MANIFEST` | zip 里多套了一层目录，或压的是父目录 |
| 安装报 `ENTRY_MISSING` | `entry` 路径写错，或构建产物里没有那个文件 |
| 安装报 `INVALID_ENTRY` / `FORBIDDEN_ENTRY_HOST` | `entry` 用了 http/https 之外的协议；或在线入口指向本机/内网（连 dev server 请用调试模式） |
| 在线站点里点站内链接弹「离开小程序」 | 那个域名没写进 `network.allowlist` |
| 安装报 `UNSAFE_PATH` | 包里有 `../` 条目，通常是压缩方式不对 |
| 装了新版但打开还是老的 | `versionCode` 没递增 |
| 数据莫名清空 | 换了 `appId`，或经历过一次卸载 |
| 背景透明能看到宿主壁纸 | 自己没设 `body { background }` |
| TV 上遥控器完全没反应 | 没实现 `ant.tv.onKey` |
