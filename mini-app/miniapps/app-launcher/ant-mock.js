/*!
 * ant-mock.js —— 浏览器里的 window.ant 模拟实现，仅用于开发。
 *
 * 宿主容器会在 document-start 注入真 SDK，此时本文件自动退让，
 * 所以打包时留着无害（只多几 KB）。
 *
 * 引入前可设置这几个全局变量来配置行为：
 *   window.__antMockPermissions = ['ui','storage']   // 与 manifest.permissions 保持一致
 *   window.__antMockAppId       = 'com.foo.bar'
 *   window.__antMockTV          = false              // true 时 isTV 为真
 *   window.__antMockLaunchOptions = { sourceAppId:'com.foo.source', params:{} }
 *   window.__antMockFixtures    = { sites:[], search:{list:[]}, play:{url:''} }
 *
 * 浏览器里没有宿主，所以 `ant.serve` 注册的 handler 只是挂到 `window.__antServe`
 * 上，自己在 devtools 里调它验证：
 *   await __antServe({ method:'GET', path:'/api/v2/x', query:'a=1',
 *                      params:{a:'1'}, headers:{}, body:null,
 *                      url: location.origin + '/api/v2/x?a=1' })
 */
(function () {
  'use strict';
  if (window.ant) return;                       // 真 SDK 已在，什么都不做

  var listeners = {};
  var KEY_PREFIX = 'ant-mock:';
  var miniAppLaunchOptions = window.__antMockLaunchOptions || null;

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
    if (event === 'miniApp.open') miniAppLaunchOptions = data || null;
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
    version: 3,
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
          sdkVersion: 3,
          mock: true
        });
      }
    },

    log: function (m) { console.log('[ant.log]', m); return Promise.resolve(); },

    /* 浏览器里走 fetch —— 会受 CORS 限制，真机不会 */
    request: function (options) {
      var o = typeof options === 'string' ? { url: options } : (options || {});
      var denied = need('network');
      if (denied) return denied;
      var wantsBytes = o.responseType === 'base64';
      var init = { method: o.method || 'GET', headers: o.headers || undefined };
      if (o.redirect === 'manual' || o.followRedirects === false) {
        init.redirect = 'manual';
      }
      if (o.data !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
        init.body = typeof o.data === 'string' ? o.data : JSON.stringify(o.data);
      }
      return fetch(o.url, init).then(function (res) {
        var headers = {};
        res.headers.forEach(function (v, k) { headers[k] = [v]; });
        var body = wantsBytes
          ? res.arrayBuffer().then(function (buffer) {
              return window.ant.bytesToBase64(new Uint8Array(buffer));
            })
          : res.text();
        return body.then(function (data) {
          return {
            statusCode: res.status,
            headers: headers,
            data: data,
            responseType: wantsBytes ? 'base64' : 'text',
            url: res.url
          };
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
    requestBytes: function (options) {
      var o = typeof options === 'string' ? { url: options } : (options || {});
      o.responseType = 'base64';
      return window.ant.request(o).then(function (res) {
        return window.ant.base64ToBytes(res.data);
      });
    },
    base64ToBytes: function (base64) {
      var binary = atob(base64 || '');
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    },
    /** mock 专用：真机上宿主直接给 base64，浏览器里要自己编。 */
    bytesToBase64: function (bytes) {
      var binary = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    },

    /**
     * 注册宿主可调用的处理器。
     *
     * 浏览器里没有宿主，所以只把 handler 挂到 `window.__antServe` 上，
     * 你可以在 devtools 里手动调它来验证：
     *   await __antServe({ method: 'GET', path: '/api/v2/search/anime',
     *                      query: 'keyword=x', params: { keyword: 'x' },
     *                      headers: {}, body: null,
     *                      url: location.origin + '/api/v2/search/anime?keyword=x' })
     */
    serve: function (handler) {
      var denied = need('service');
      if (denied) return function () {};
      window.__antServe = function (payload) {
        return Promise.resolve()
          .then(function () { return handler(payload || {}); })
          .then(function (res) {
            if (res === null || res === undefined) return null;
            if (typeof res === 'string') return { status: 200, headers: {}, body: res };
            if (typeof Response !== 'undefined' && res instanceof Response) {
              var headers = {};
              res.headers.forEach(function (v, k) { headers[k] = v; });
              var status = res.status;
              return res.text().then(function (body) {
                return { status: status, headers: headers, body: body };
              });
            }
            return {
              status: res.status || res.statusCode || 200,
              headers: res.headers || {},
              body: res.body,
              bodyBase64: res.bodyBase64
            };
          });
      };
      console.log('[ant.serve] 已注册处理器，devtools 里可以直接调 __antServe(...)');
      return function () { window.__antServe = null; };
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

    miniApp: {
      open: function (options) {
        var o = typeof options === 'string' ? { appId: options } : (options || {});
        var denied = need('miniapp'); if (denied) return denied;
        var opened = window.confirm('模拟打开小程序：' + (o.appId || ''));
        if (opened) console.warn('[ant-mock] 浏览器里不会真的切换小程序');
        return Promise.resolve({
          opened: opened,
          appId: o.appId,
          name: o.appId,
          resumed: false,
          path: o.path
        });
      },
      getLaunchOptions: function () { return Promise.resolve(miniAppLaunchOptions); },
      onOpen: function (h) { return on('miniApp.open', h); }
    },

    onShow: function (h) { return on('app.show', h); },
    onHide: function (h) { return on('app.hide', h); },

    player: {
      /* 用一个全屏 <video> 顶替宿主播放页，事件序列与真机一致 */
      open: function (options) {
        var o = typeof options === 'string' ? { url: options } : (options || {});
        var denied = need('player'); if (denied) return denied;
        var headers = o.headers || o.header;
        if (headers && Object.keys(headers).length) {
          /* <video src> 发不出自定义头，真机上宿主会带上，浏览器里只能提示 */
          console.warn('[ant-mock] player.open 的 headers 在浏览器里无法生效（真机宿主会带上）:', Object.keys(headers).join(', '));
        }
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

    /* 采集源没法模拟，返回 window.__antMockFixtures 里你自己准备的假数据 */
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
