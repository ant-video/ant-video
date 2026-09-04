/*!
 * ant-sdk.js —— 小程序容器注入的 JS SDK。
 *
 * 由宿主在 document-start 注入，页面无需手动引入。所有能力都要在
 * manifest.json 的 permissions 里声明，未声明的调用会以
 * PERMISSION_DENIED 失败。
 */
(function () {
  'use strict';

  if (window.ant) return;

  var seq = 0;
  var listeners = {};

  function bridgeReady() {
    return new Promise(function (resolve) {
      var ok = function () {
        return window.flutter_inappwebview && window.flutter_inappwebview.callHandler;
      };
      if (ok()) return resolve();
      var timer = setInterval(function () {
        if (ok()) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  }

  /** 调用一个 JSAPI，失败时 reject 一个带 code 的 Error。 */
  function invoke(api, params) {
    var callId = ++seq;
    return bridgeReady()
      .then(function () {
        return window.flutter_inappwebview.callHandler('antInvoke', {
          api: api,
          params: params || {},
          callId: callId
        });
      })
      .then(function (res) {
        if (!res || res.ok !== true) {
          var error = new Error((res && res.message) || 'JSAPI 调用失败');
          error.code = (res && res.code) || 'UNKNOWN';
          error.api = api;
          throw error;
        }
        return res.data;
      });
  }

  /* ---------------- 事件 ---------------- */

  function on(event, handler) {
    if (typeof handler !== 'function') return function () {};
    (listeners[event] = listeners[event] || []).push(handler);
    return function () {
      off(event, handler);
    };
  }

  function off(event, handler) {
    var list = listeners[event];
    if (!list) return;
    if (!handler) {
      delete listeners[event];
      return;
    }
    var index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  function once(event, handler) {
    var dispose = on(event, function (data) {
      dispose();
      handler(data);
    });
    return dispose;
  }

  /** 宿主 → 小程序的事件入口，由 Dart 侧 evaluateJavascript 调用。 */
  window.__antEmit = function (payload) {
    if (!payload || !payload.event) return;
    var list = (listeners[payload.event] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](payload.data);
      } catch (e) {
        console.error('[ant] 事件处理异常: ' + payload.event, e);
      }
    }
  };

  /* ---------------- 反向服务 ---------------- */

  var serveHandler = null;

  /**
   * 注册一个「宿主可以调用的 HTTP 处理器」，需要 service 权限。
   *
   * 宿主的 loopback 服务会把 `/<token>/__service/*` 上收到的请求转成对象交给
   * handler，再把返回值变回 HTTP 响应，于是宿主自己的 Dart 代码（例如播放器
   * 取弹幕）能把这段 JS 当本地服务用。声明了 service 权限的小程序会在宿主
   * 需要时被后台拉起，所以 handler 必须能在页面不可见的情况下工作。
   *
   * handler 收到 `{method, path, query, headers, body}`，可以返回：
   *   - 标准 `Response` 对象（Web 风格的 handler 直接透传即可）
   *   - `{status, headers, body}`，二进制用 `bodyBase64`
   *   - 一个字符串（当作 200 text）
   *
   * @returns {function} 取消注册
   */
  function serve(handler) {
    serveHandler = typeof handler === 'function' ? handler : null;
    return function () {
      if (serveHandler === handler) serveHandler = null;
    };
  }

  /** 把 handler 的返回值归一化成宿主认识的响应结构。 */
  function normalizeServeResponse(res) {
    if (res === null || res === undefined) return null;
    if (typeof res === 'string') return { status: 200, headers: {}, body: res };

    // 标准 Response：Cloudflare Worker 风格的 handler 直接产出这个，
    // 支持它意味着这类服务几乎不用写适配层。
    if (typeof Response !== 'undefined' && res instanceof Response) {
      var headers = {};
      if (res.headers && typeof res.headers.forEach === 'function') {
        res.headers.forEach(function (value, key) {
          headers[key] = value;
        });
      }
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
  }

  /** 宿主 → 小程序的请求入口，由 Dart 侧 callAsyncJavaScript 调用。 */
  window.__antServe = function (payload) {
    if (!serveHandler) return Promise.resolve(null);
    return Promise.resolve()
      .then(function () {
        return serveHandler(payload || {});
      })
      .then(normalizeServeResponse)
      .catch(function (e) {
        console.error('[ant] 服务处理异常', e);
        return {
          status: 500,
          headers: {},
          body: String((e && e.message) || e)
        };
      });
  };

  /* ---------------- 网络 ---------------- */

  /**
   * 发起请求。走宿主的 Dio，因此不受浏览器 CORS 限制，
   * 但域名要落在 manifest 的 network.allowlist 内。
   *
   * `responseType: 'base64'` 时 data 是 base64 串而不是文本——响应是
   * protobuf / gzip / brotli 这类二进制时必须这样取，按文本解码会毁掉字节。
   * @returns {Promise<{statusCode:number, headers:object, data:string,
   *   responseType:string, byteLength?:number}>}
   */
  function request(options) {
    var opts = typeof options === 'string' ? { url: options } : options || {};
    return invoke('request', {
      url: opts.url,
      method: opts.method || 'GET',
      headers: opts.headers || null,
      data: opts.data,
      timeout: opts.timeout,
      responseType: opts.responseType || 'text',
      followRedirects: opts.followRedirects !== false
    });
  }

  /** base64 串 → Uint8Array。 */
  function base64ToBytes(base64) {
    var binary = atob(base64 || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /** request 的二进制便捷版，直接给 Uint8Array。 */
  function requestBytes(options) {
    var opts = typeof options === 'string' ? { url: options } : options || {};
    opts.responseType = 'base64';
    return request(opts).then(function (res) {
      return base64ToBytes(res.data);
    });
  }

  /** request 的 JSON 便捷版，非 2xx 会 reject。 */
  function requestJson(options) {
    return request(options).then(function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        var error = new Error('HTTP ' + res.statusCode);
        error.code = 'HTTP_' + res.statusCode;
        error.response = res;
        throw error;
      }
      try {
        return JSON.parse(res.data);
      } catch (e) {
        var parseError = new Error('响应不是合法 JSON');
        parseError.code = 'INVALID_JSON';
        parseError.response = res;
        throw parseError;
      }
    });
  }

  /* ---------------- 存储 ---------------- */

  var storage = {
    get: function (key) {
      return invoke('storage.get', { key: key });
    },
    set: function (key, value) {
      return invoke('storage.set', { key: key, value: String(value) });
    },
    getJSON: function (key, fallback) {
      return storage.get(key).then(function (value) {
        if (value === null || value === undefined) return fallback;
        try {
          return JSON.parse(value);
        } catch (e) {
          return fallback;
        }
      });
    },
    setJSON: function (key, value) {
      return storage.set(key, JSON.stringify(value));
    },
    remove: function (key) {
      return invoke('storage.remove', { key: key });
    },
    clear: function () {
      return invoke('storage.clear', {});
    },
    keys: function () {
      return invoke('storage.keys', {});
    }
  };

  /* ---------------- 界面 ---------------- */

  var ui = {
    toast: function (message) {
      return invoke('ui.toast', { message: String(message) });
    },
    loading: function (message) {
      return invoke('ui.loading', { message: message });
    },
    hideLoading: function () {
      return invoke('ui.hideLoading', {});
    },
    /** @returns {Promise<boolean>} */
    confirm: function (options) {
      var opts = typeof options === 'string' ? { content: options } : options || {};
      return invoke('ui.confirm', opts).then(function (res) {
        return !!(res && res.confirmed);
      });
    },
    /** @returns {Promise<number>} 选中下标，取消为 -1 */
    actionSheet: function (items) {
      return invoke('ui.actionSheet', { items: items }).then(function (res) {
        return res ? res.index : -1;
      });
    }
  };

  /* ---------------- 播放器 ---------------- */

  var player = {
    /**
     * 推到宿主全屏播放页；退出播放页会收到 player.close 事件。
     *
     * options.headers 是取流请求头（Referer / User-Agent / Cookie / 鉴权头），
     * ant.source.play 返回的 header 可以直接原样传进来。
     */
    open: function (options) {
      var opts = typeof options === 'string' ? { url: options } : options || {};
      return invoke('player.open', {
        url: opts.url,
        title: opts.title,
        headers: opts.headers || opts.header
      });
    },
    getState: function () {
      return invoke('player.getState', {});
    },
    onStateChange: function (handler) {
      return on('player.stateChange', handler);
    },
    onClose: function (handler) {
      return on('player.close', handler);
    }
  };

  /* ---------------- 采集源 ---------------- */

  var source = {
    /** 宿主已配置的可用站点列表。 */
    list: function () {
      return invoke('source.list', {}).then(function (res) {
        return (res && res.sites) || [];
      });
    },
    home: function (siteKey) {
      return invoke('source.home', { siteKey: siteKey });
    },
    category: function (options) {
      var opts = options || {};
      return invoke('source.category', {
        siteKey: opts.siteKey,
        tid: opts.tid,
        page: opts.page || 1,
        ext: opts.ext || {}
      });
    },
    detail: function (options) {
      var opts = options || {};
      return invoke('source.detail', { siteKey: opts.siteKey, id: opts.id });
    },
    play: function (options) {
      var opts = options || {};
      return invoke('source.play', {
        siteKey: opts.siteKey,
        flag: opts.flag || '',
        id: opts.id
      });
    },
    search: function (options) {
      var opts = options || {};
      return invoke('source.search', {
        siteKey: opts.siteKey,
        wd: opts.wd,
        page: opts.page || 1
      });
    }
  };

  /* ---------------- 其它 ---------------- */

  var env = {
    getSystemInfo: function () {
      return invoke('env.getSystemInfo', {});
    }
  };

  var clipboard = {
    get: function () {
      return invoke('clipboard.get', {}).then(function (res) {
        return res ? res.text : '';
      });
    },
    set: function (text) {
      return invoke('clipboard.set', { text: String(text) });
    }
  };

  var tv = {
    /** TV 遥控按键。宿主把方向键/OK/返回转发到这里。 */
    onKey: function (handler) {
      return on('keydown', handler);
    }
  };

  window.ant = {
    /** SDK 协议版本，与宿主 env.getSystemInfo().sdkVersion 对应。 */
    version: 2,
    invoke: invoke,
    on: on,
    off: off,
    once: once,
    env: env,
    log: function (message) {
      return invoke('log', { message: String(message) });
    },
    request: request,
    requestJson: requestJson,
    requestBytes: requestBytes,
    base64ToBytes: base64ToBytes,
    serve: serve,
    storage: storage,
    ui: ui,
    clipboard: clipboard,
    player: player,
    source: source,
    tv: tv,
    navigateTo: function (url) {
      return invoke('navigateTo', { url: url });
    },
    redirectTo: function (url) {
      return invoke('redirectTo', { url: url });
    },
    navigateBack: function () {
      return invoke('navigateBack', {});
    },
    exitMiniApp: function () {
      return invoke('exitMiniApp', {});
    },
    /** 生命周期：宿主页面重新可见 / 进入后台。 */
    onShow: function (handler) {
      return on('app.show', handler);
    },
    onHide: function (handler) {
      return on('app.hide', handler);
    }
  };
})();
