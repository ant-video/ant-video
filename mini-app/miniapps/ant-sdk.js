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
  var miniAppLaunchOptions = null;

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
    if (payload.event === 'miniApp.open') {
      miniAppLaunchOptions = payload.data || null;
    }
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

  /**
   * 发起流式请求。Dart 消费 HTTP/SSE 流，再通过 ant 事件把增量推回页面，
   * 因此不受 WebView CORS 和 ReadableStream 支持差异影响。
   *
   * options 里可传 onHeaders / onData / onError / onDone / onAbort 回调。
   * @returns {Promise<{id:string, abort:function}>}
   */
  function requestStream(options) {
    var opts = typeof options === 'string' ? { url: options } : options || {};
    var streamId = 'stream_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    var closed = false;
    var listener = on('request.stream', function (data) {
      if (!data || data.id !== streamId) return;
      if (data.kind === 'headers') {
        if (typeof opts.onHeaders === 'function') opts.onHeaders(data);
        return;
      }
      if (data.kind === 'data') {
        if (typeof opts.onData === 'function') {
          setTimeout(function () { opts.onData(data.data || ''); }, 0);
        }
        return;
      }
      if (data.kind === 'error') {
        if (closed) return;
        closed = true;
        off('request.stream', listener);
        if (typeof opts.onError === 'function') opts.onError(new Error(data.message || '请求失败'));
        return;
      }
      if (data.kind === 'abort') {
        if (closed) return;
        closed = true;
        off('request.stream', listener);
        if (typeof opts.onAbort === 'function') opts.onAbort();
        return;
      }
      if (data.kind === 'done') {
        if (closed) return;
        closed = true;
        off('request.stream', listener);
        if (typeof opts.onDone === 'function') opts.onDone();
      }
    });

    var handle = {
      id: streamId,
      abort: function () {
        return invoke('requestStream.abort', { streamId: streamId }).catch(function () {});
      }
    };
    return invoke('requestStream', {
      url: opts.url,
      method: opts.method || 'GET',
      headers: opts.headers || null,
      data: opts.data,
      timeout: opts.timeout,
      followRedirects: opts.followRedirects !== false,
      streamId: streamId
    }).then(function (res) {
      handle.statusCode = res && res.statusCode;
      return handle;
    }).catch(function (error) {
      closed = true;
      off('request.stream', listener);
      throw error;
    });
  }

  /** 逐行解析 HTTP/SSE 文本流；onEvent 收到不包含行结束符的行。 */
  function readLines(onEvent) {
    var buffer = '';
    return function (chunk) {
      buffer += String(chunk || '');
      var lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      lines.forEach(onEvent);
    };
  }

  /** 解析 SSE data 事件；返回 Promise，通过 onEvent 输出每个 data 字段。 */
  function requestSSE(options, onEvent) {
    var previous = options.onData || null;
    var feed = readLines(function (line) {
      if (line.indexOf('data:') !== 0) return;
      onEvent(line.slice(5).replace(/^ /, ''));
    });
    var opts = Object.assign({}, options);
    opts.onData = function (chunk) {
      feed(chunk);
      if (previous) previous(chunk);
    };
    return requestStream(opts);
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

  /**
   * 把 `miniapp://<appId>[/path]` 换成可直接使用的同机 http 地址。
   *
   * 导航（location / `<a>`）与 `ant.request` 能直接吃 miniapp:// 写法，但页面里的
   * `fetch` / `XMLHttpRequest` 与 `<video>` / `<img>` 的 src 用不了自定义协议，
   * 先调这个拿到真地址再用。需要 miniapp 权限。
   *
   * @returns {Promise<string>} 形如 http://127.0.0.1:<port>/<token>/__service<path>
   */
  function resolveService(url) {
    return invoke('resolveService', { url: url }).then(function (res) {
      return res && res.url;
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

  var file = {
    write: function (path, content, options) {
      var opts = options || {};
      return invoke('file.write', {
        path: path,
        content: content,
        encoding: opts.encoding || 'text',
        append: opts.append === true
      });
    },
    read: function (path, options) {
      var opts = options || {};
      return invoke('file.read', {
        path: path,
        encoding: opts.encoding || 'text'
      }).then(function (res) {
        return res ? res.data : '';
      });
    },
    stat: function (path) {
      return invoke('file.stat', { path: path });
    },
    list: function (path) {
      return invoke('file.list', { path: path || '' }).then(function (res) {
        return res ? res.entries : [];
      });
    },
    mkdir: function (path) {
      return invoke('file.mkdir', { path: path });
    },
    rename: function (from, to, options) {
      return invoke('file.rename', {
        from: from,
        to: to,
        overwrite: !!(options && options.overwrite)
      });
    },
    delete: function (path, options) {
      return invoke('file.delete', {
        path: path,
        recursive: !!(options && options.recursive)
      });
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

  /* ---------------- 小程序 ---------------- */

  var miniApp = {
    /**
     * 经用户确认后打开另一个已安装小程序，需要 miniapp 权限。
     * path 只能是目标小程序内的相对路径，params 必须是 JSON 对象。
     */
    open: function (options) {
      var opts = typeof options === 'string' ? { appId: options } : options || {};
      return invoke('miniApp.open', {
        appId: opts.appId,
        path: opts.path,
        params: opts.params || {}
      });
    },
    /** 最近一次由其它小程序打开时收到的来源、path 和 params。 */
    getLaunchOptions: function () {
      return invoke('miniApp.getLaunchOptions', {}).then(function (options) {
        miniAppLaunchOptions = options || null;
        return miniAppLaunchOptions;
      });
    },
    /** 监听本页存活期间后续收到的跨小程序打开请求。 */
    onOpen: function (handler) {
      return on('miniApp.open', handler);
    }
  };

  /* ---------------- 播放器 ---------------- */

  /* source.play 的结果里「怎么解析这个地址」的字段，原样透传给宿主播放页。
     click 不在其中：点击规则宿主只认站点配置里的那份，传 key 让它去查。 */
  var PLAY_INFO_FIELDS = ['parse', 'jx', 'playUrl', 'flag', 'jxFrom', 'key'];

  var player = {
    /**
     * 推到宿主全屏播放页；退出播放页会收到 player.close 事件。
     *
     * options.headers 是取流请求头（Referer / User-Agent / Cookie / 鉴权头），
     * ant.source.play 返回的 header 可以直接原样传进来。
     *
     * 需要解析的线路（source.play 返回 parse / jx 为 '1'，url 是网页地址而不是
     * 媒体直链）把整份结果传回来即可：`ant.player.open({...play, title})`，
     * 宿主会跑自己的解析竞速 + 网页嗅探。自己抓站点、没有这些字段的小程序用
     * options.sniff = true 显式声明同一件事。
     */
    open: function (options) {
      var opts = typeof options === 'string' ? { url: options } : options || {};
      var params = {
        url: opts.url,
        title: opts.title,
        headers: opts.headers || opts.header
      };
      if (opts.sniff) params.sniff = true;
      for (var i = 0; i < PLAY_INFO_FIELDS.length; i++) {
        var name = PLAY_INFO_FIELDS[i];
        if (opts[name] !== undefined && opts[name] !== null) {
          params[name] = opts[name];
        }
      }
      return invoke('player.open', params);
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

  /* ---------------- Python ---------------- */

  /**
   * 调用包内 manifest.python.entry 暴露的函数，需要 python 权限。
   * method 必须是入口 .py 文件里的顶层函数名；args 按 JSON 值传参。
   */
  var python = {
    call: function (method) {
      var args = Array.prototype.slice.call(arguments, 1);
      return invoke('python.call', { method: method, args: args });
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
    version: 6,
    invoke: invoke,
    on: on,
    off: off,
    once: once,
    env: env,
    log: function (message) {
      return invoke('log', { message: String(message) });
    },
    request: request,
    requestStream: requestStream,
    readLines: readLines,
    requestSSE: requestSSE,
    requestJson: requestJson,
    requestBytes: requestBytes,
    resolveService: resolveService,
    base64ToBytes: base64ToBytes,
    serve: serve,
    storage: storage,
    file: file,
    ui: ui,
    miniApp: miniApp,
    clipboard: clipboard,
    player: player,
    source: source,
    python: python,
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

  /* ---------------- 故障上报 ---------------- */

  /*
   * 未捕获异常、未处理的 Promise 拒绝、子资源加载失败，一律送进宿主日志面板。
   *
   * 这三类都**不经过 console.***，所以宿主的 onConsoleMessage 抓不到；子资源
   * 加载失败在 iOS 上也不会触发 onReceivedError。少了这一段，「页面画出来了但
   * 功能没起来」在日志里就是一片空白——最典型的是 <script type="module"> 里
   * 有一条这台设备的 WebKit 不认的语法（如 iOS 16.4 之前的正则后行断言），
   * 整个模块一行都不执行，页面只会一直停在它自己的「加载中」上。
   */
  var reportCount = 0;
  var reportLimit = 30;

  function report(text) {
    if (reportCount >= reportLimit) return;
    reportCount++;
    var message = text;
    if (reportCount === reportLimit) message += '（达到上限，后续错误不再上报）';
    try {
      // 必须吃掉这里的 reject：上报失败再产生一次 unhandledrejection 就是死循环。
      invoke('log', { message: message, level: 'error' }).catch(function () {});
    } catch (e) {
      /* 上报本身不能再抛 */
    }
  }

  function describeError(error) {
    if (error === null || error === undefined) return '';
    var text = error.message ? String(error.message) : String(error);
    if (error.name && text.indexOf(error.name) !== 0) {
      text = error.name + ': ' + text;
    }
    if (error.stack) {
      var frames = String(error.stack).split('\n').slice(0, 4).join(' ← ');
      if (frames) text += ' | ' + frames;
    }
    return text;
  }

  // capture 阶段才能收到 script/img/link 的加载失败，它们不冒泡。
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        var url = target.src || target.href;
        var tag = String(target.tagName || '?').toLowerCase();
        report('资源加载失败 <' + tag + '> ' + url);
        probeResource(url);
        return;
      }
      var detail =
        describeError(event.error) || String(event.message || '未知错误');
      var where = event.filename
        ? ' @' + event.filename + ':' + event.lineno + ':' + event.colno
        : '';
      report('未捕获异常 ' + detail + where);
    },
    true
  );

  /*
   * `<script>` 的 error 事件不区分原因：取不到（网络/404/MIME 被拒）和
   * 取到了但解析失败（module 里有本机 WebKit 不认的语法）都是同一个事件。
   * 所以再取一次同一个地址，把 HTTP 状态和长度报出来——两类原因由此分开，
   * 不然只能看到一句「资源加载失败」，什么也定不了。
   */
  function probeResource(url) {
    if (typeof fetch !== 'function') return;
    try {
      fetch(url, { cache: 'no-store' })
        .then(function (res) {
          // 不读 body：这类文件动辄上兆，读进 JS 只是白占内存。
          try {
            if (res.body && res.body.cancel) res.body.cancel();
          } catch (e) {
            /* 取消失败就交给浏览器自己收尾 */
          }
          if (!res.ok) {
            report('↳ 复查: HTTP ' + res.status + '，这个地址确实取不到');
            return;
          }
          report(
            '↳ 复查: HTTP ' +
              res.status +
              '，Content-Type=' +
              (res.headers.get('content-type') || '?') +
              '，Content-Length=' +
              (res.headers.get('content-length') || '?') +
              '。能取到却报加载失败 → 是脚本本身解析/执行失败，' +
              'module 脚本常见于用了本机 WebKit 不支持的语法'
          );
        })
        .catch(function (e) {
          report('↳ 复查失败: ' + ((e && e.message) || e));
        });
    } catch (e) {
      /* 复查是尽力而为 */
    }
  }

  window.addEventListener('unhandledrejection', function (event) {
    report('未处理的 Promise 拒绝 ' + (describeError(event.reason) || '(无原因)'));
  });
})();
