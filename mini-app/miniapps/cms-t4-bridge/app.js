(function () {
  'use strict';

  var APP_ID = 'com.leospring.cms_t4_bridge';
  var STORAGE_KEY = 'cms-t4-config';
  var LAN_KEY = 'cms-t4-lan';
  var INTERNAL_BASE = 'miniapp://' + APP_ID;

  var keyInput = document.getElementById('key');
  var nameInput = document.getElementById('name');
  var urlInput = document.getElementById('url');
  var siteList = document.getElementById('site-list');
  var siteEditorTitle = document.getElementById('site-editor-title');
  var status = document.getElementById('status');
  var output = document.getElementById('config-output');
  var configUrl = document.getElementById('config-url');
  var linkList = document.getElementById('link-list');
  var lanForm = document.getElementById('lan-form');
  var lanInput = document.getElementById('lan-base');
  var scopeHint = document.getElementById('scope-hint');
  var exportStatus = document.getElementById('export-status');
  var prefixSample = document.getElementById('prefix-sample');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

  var current = { sites: [], selectedKey: '' };
  var lan = { base: '', detected: '', detectedAt: 0 };
  var editingKey = '';
  var scope = 'internal';
  var activeConfigUrl = '';

  function jsonResponse(value, statusCode) {
    return {
      status: statusCode || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(value)
    };
  }

  function errorResponse(code, message, statusCode) {
    return jsonResponse({ code: code, msg: message, data: null }, statusCode || 400);
  }

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setExportStatus(message, kind) {
    exportStatus.textContent = message || '';
    exportStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  function copyText(text, label) {
    if (!text) { setExportStatus('没有可复制的内容。', 'error'); return; }
    ant.clipboard.set(text).then(function () {
      setExportStatus(label + '已复制。', 'ok');
    }).catch(function (e) {
      setExportStatus('复制失败：' + ((e && e.message) || e), 'error');
    });
  }

  function cleanKey(raw) {
    var value = String(raw || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(value)) {
      throw new Error('key 只能包含字母、数字、下划线和短横线，长度 1-40');
    }
    return value;
  }

  function cleanUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) throw new Error('请填写 CMS JSON 接口');
    var parsed;
    try { parsed = new URL(value); } catch (e) { throw new Error('接口地址不是合法 URL'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('接口只支持 http 或 https');
    }
    parsed.hash = '';
    return parsed.toString();
  }

  // 局域网入口必须是私有网段：回环地址只有本机能用，宿主也只放行私有来源。
  function isLanHost(hostname) {
    var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host === '::1' || /^127\./.test(host)) return false;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return /\.local$/.test(host);
  }

  // 宿主给的地址形如 http://192.168.1.7:9321/<lanToken>；
  // 允许用户把带 /config、/health、/site/xxx 或带查询串的整段地址直接粘进来。
  function cleanLanBase(raw) {
    var value = String(raw || '').trim();
    if (!value) throw new Error('请填写局域网共享地址');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'http://' + value;
    var parsed;
    try { parsed = new URL(value); } catch (e) { throw new Error('地址不是合法 URL'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('局域网地址只支持 http 或 https');
    }
    var path = String(parsed.pathname || '').replace(/\/+$/, '');
    path = path.replace(/\/(?:api\/(?:v1\/)?)?(?:config|health)$/i, '');
    path = path.replace(/\/(?:site|s)\/[^/]+$/i, '');
    path = path.replace(/\/__service$/, '');
    return parsed.protocol + '//' + parsed.host + path.replace(/\/+$/, '');
  }

  function safeLanBase(raw) {
    if (!raw) return '';
    try { return cleanLanBase(raw); } catch (e) { return ''; }
  }

  function normalizeConfig(value) {
    if (value && Array.isArray(value.sites)) {
      var seen = {};
      var sites = value.sites.map(function (site) {
        return {
          key: String(site.key || '').trim(),
          name: String(site.name || 'CMS 影视源').trim() || 'CMS 影视源',
          url: String(site.url || '').trim()
        };
      }).filter(function (site) {
        if (!site.key || !site.url || seen[site.key]) return false;
        seen[site.key] = true;
        return true;
      });
      var selected = String(value.selectedKey || '').trim();
      if (!sites.some(function (site) { return site.key === selected; })) selected = sites[0] ? sites[0].key : '';
      return { sites: sites, selectedKey: selected };
    }
    if (value && value.url) {
      return { sites: [{ key: 'default', name: String(value.name || 'CMS 影视源'), url: String(value.url) }], selectedKey: 'default' };
    }
    return { sites: [], selectedKey: '' };
  }

  function readConfig() {
    return ant.storage.getJSON(STORAGE_KEY, null).then(normalizeConfig);
  }

  function saveConfig(config, message) {
    current = normalizeConfig(config);
    return ant.storage.setJSON(STORAGE_KEY, config).then(function () {
      paint();
      setStatus(message || '配置已保存，T4 服务已启用。', 'ok');
    });
  }

  function normalizeLan(value) {
    value = value || {};
    return {
      base: safeLanBase(value.base),
      detected: safeLanBase(value.detected),
      detectedAt: Number(value.detectedAt) || 0
    };
  }

  function readLan() {
    return ant.storage.getJSON(LAN_KEY, null).then(normalizeLan);
  }

  function writeLan(next) {
    lan = normalizeLan(next);
    return ant.storage.setJSON(LAN_KEY, { base: lan.base, detected: lan.detected, detectedAt: lan.detectedAt });
  }

  // 宿主没有读取局域网地址的 JSAPI，但局域网请求打进来时 req.url 是完整入口，
  // 而 req.path 已经剥掉了前缀；两者相减就是 http://IP:9321/<lanToken>。
  function lanBaseFromRequest(req) {
    var headers = (req && req.headers) || {};
    var forwarded = headers['X-Ant-Lan-Base'] || headers['x-ant-lan-base'];
    if (forwarded) {
      var forwardedBase = safeLanBase(forwarded);
      if (forwardedBase) return forwardedBase;
    }
    var raw = req && req.url;
    if (!raw) return '';
    var parsed;
    try { parsed = new URL(String(raw)); } catch (e) { return ''; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!isLanHost(parsed.hostname)) return '';
    var full = String(parsed.pathname || '/');
    var path = String((req && req.path) || '/');
    var prefix = full;
    if (path !== '/' && full.length >= path.length && full.slice(full.length - path.length) === path) {
      prefix = full.slice(0, full.length - path.length);
    }
    prefix = prefix.replace(/\/+$/, '').replace(/\/__service$/, '');
    return prefix ? parsed.protocol + '//' + parsed.host + prefix : '';
  }

  function requestFromLan(req) {
    if (lanBaseFromRequest(req)) return true;
    var headers = (req && req.headers) || {};
    var host = headers.host || headers.Host || headers['x-forwarded-host'] || headers['X-Forwarded-Host'];
    return !!host && isLanHost(String(host).replace(/:\d+$/, ''));
  }

  // 后台拉起时内存里的 lan 可能还没读出来，所以读一遍存储再写，别覆盖手填的地址。
  function rememberLanBase(req) {
    var found = lanBaseFromRequest(req);
    if (!found) return;
    readLan().then(function (value) {
      if (value.detected === found) { lan = value; return null; }
      return writeLan({ base: value.base, detected: found, detectedAt: Date.now() }).then(function () {
        if (linkList) paintExport();
      });
    }).catch(function () {});
  }

  function effectiveLanBase() { return lan.base || lan.detected || ''; }

  function isInternalBase(base) { return String(base).indexOf('miniapp://') === 0; }

  // miniapp:// 后面直接跟查询串，http 地址要保留目录斜杠。
  function joinPath(base, path) {
    if (path === '/') return isInternalBase(base) ? base : base + '/';
    return base + path;
  }

  // 站点走路径而不是查询串：T4 调用方会往 api 后面直接接 `?ac=…`，
  // 给出 `?site=` 形式的地址会拼成两个问号。查询串形式仍然照旧受理。
  function siteApi(base, key) {
    return joinPath(base, '/site/' + encodeURIComponent(key));
  }

  function descriptor(sites, base) {
    return {
      sites: sites.map(function (site) {
        return {
          key: site.key,
          name: site.name,
          type: 4,
          api: siteApi(base, site.key),
          searchable: 1,
          quickSearch: 1,
          filterable: 1
        };
      })
    };
  }

  function resolveApiBase(req, lanRecord) {
    var params = (req && req.params) || {};
    var raw = String(params.base || params.apiBase || '').trim();
    if (/^miniapp:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    var explicit = safeLanBase(raw);
    if (explicit) return explicit;
    var detected = lanBaseFromRequest(req);
    if (detected) return detected;
    var stored = (lanRecord && (lanRecord.base || lanRecord.detected)) || '';
    if (stored && requestFromLan(req)) return stored;
    return INTERNAL_BASE;
  }

  function paintSites() {
    var editing = current.sites.find(function (site) { return site.key === editingKey; });
    if (editing) {
      keyInput.value = editing.key;
      nameInput.value = editing.name;
      urlInput.value = editing.url;
      siteEditorTitle.textContent = '编辑站点';
    }
    if (!editing && !editingKey) {
      keyInput.value = '';
      nameInput.value = '';
      urlInput.value = '';
      siteEditorTitle.textContent = '添加站点';
    }
    siteList.innerHTML = '';
    current.sites.forEach(function (site) {
      var item = document.createElement('div');
      item.className = 'site-item' + (site.key === current.selectedKey ? ' selected' : '');
      item.innerHTML = '<div class="site-meta"><strong></strong><span></span><code></code></div><div class="site-actions"><button data-key="edit">编辑</button><button data-key="default">' + (site.key === current.selectedKey ? '默认站点' : '设为默认') + '</button><button data-key="delete" class="danger">删除</button></div>';
      item.querySelector('strong').textContent = site.name;
      item.querySelector('span').textContent = 'key: ' + site.key + (site.key === current.selectedKey ? ' · 当前默认' : '');
      item.querySelector('code').textContent = site.url;
      item.querySelector('[data-key="edit"]').addEventListener('click', function () { editingKey = site.key; paintSites(); });
      item.querySelector('[data-key="default"]').addEventListener('click', function () {
        current.selectedKey = site.key;
        saveConfig(current, '已设为默认站点。');
      });
      item.querySelector('[data-key="delete"]').addEventListener('click', function () {
        current.sites = current.sites.filter(function (itemSite) { return itemSite.key !== site.key; });
        if (current.selectedKey === site.key) current.selectedKey = current.sites[0] ? current.sites[0].key : '';
        if (editingKey === site.key) editingKey = '';
        saveConfig(current, '站点已删除。');
      });
      siteList.appendChild(item);
    });
  }

  function linkRow(row) {
    var item = document.createElement('div');
    item.className = 'link-item';
    var meta = document.createElement('div');
    meta.className = 'link-meta';
    var label = document.createElement('strong');
    label.textContent = row.label;
    meta.appendChild(label);
    if (row.hint) {
      var hint = document.createElement('span');
      hint.textContent = row.hint;
      meta.appendChild(hint);
    }
    var code = document.createElement('code');
    code.textContent = row.url;
    meta.appendChild(code);
    var button = document.createElement('button');
    button.className = 'copy';
    button.textContent = '复制';
    button.setAttribute('data-focus', '');
    button.addEventListener('click', function () { copyText(row.url, row.label + '地址'); });
    item.appendChild(meta);
    item.appendChild(button);
    return item;
  }

  function paintExport() {
    var isLan = scope === 'lan';
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-scope') === scope;
      tab.className = 'tab' + (active ? ' is-active' : '');
    });
    lanForm.hidden = !isLan;
    linkList.innerHTML = '';

    var base = isLan ? effectiveLanBase() : INTERNAL_BASE;
    if (!base) {
      activeConfigUrl = '';
      configUrl.textContent = '未设置局域网地址';
      prefixSample.textContent = 'http://192.168.1.7:9321/lanToken';
      scopeHint.textContent = '在宿主里开启局域网共享，把地址填到下面即可；别的设备访问过一次后页面也会自己认出来。';
      output.textContent = '设置局域网地址后，这里给出可直接导入第三方播放器的配置 JSON。';
      return;
    }

    activeConfigUrl = joinPath(base, '/config');
    configUrl.textContent = activeConfigUrl;
    prefixSample.textContent = base;
    scopeHint.textContent = isLan
      ? (lan.base ? '手动填写的地址' : '自动识别的地址（来自最近一次局域网请求）') + '，同一网络里的设备和第三方播放器可直接用；token 泄露等于把服务交出去。'
      : '宿主内部地址，供宿主自己的设置项和其它小程序引用；出了这台设备用不了，给别的设备请切到局域网。';

    if (!current.sites.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '还没有站点，先在上面添加一个 CMS 接口；此时 config 接口返回空的 sites。';
      linkList.appendChild(empty);
    } else {
      linkList.appendChild(linkRow({
        label: '默认站点',
        hint: '省略 site 参数，走小程序里设为默认的站点',
        url: joinPath(base, '/')
      }));
      current.sites.forEach(function (site) {
        linkList.appendChild(linkRow({
          label: site.name,
          hint: 'key: ' + site.key + (site.key === current.selectedKey ? ' · 默认' : '') + ' · 后面可直接接 ?ac=…',
          url: siteApi(base, site.key)
        }));
      });
    }
    linkList.appendChild(linkRow({
      label: '健康检查',
      hint: '确认服务在线与站点数量',
      url: joinPath(base, '/health')
    }));
    output.textContent = JSON.stringify(descriptor(current.sites, base), null, 2);
  }

  function paint() {
    paintSites();
    paintExport();
  }

  // site 既可以走查询串，也可以走 /site/<key> 路径——有些调用方会吞掉查询串。
  function siteKeyFromRequest(req) {
    var fromParams = String((req && req.params && req.params.site) || '').trim();
    if (fromParams) return fromParams;
    var matched = String((req && req.path) || '').match(/^\/(?:site|s)\/([^/?#]+)/);
    return matched ? decodeURIComponent(matched[1]) : '';
  }

  function businessPath(req) {
    var path = String((req && req.path) || '/').replace(/^\/(?:site|s)\/[^/?#]+/, '');
    return path || '/';
  }

  function selectSite(config, req) {
    var requested = siteKeyFromRequest(req);
    if (requested) return config.sites.find(function (site) { return site.key === requested; });
    return config.sites.find(function (site) { return site.key === config.selectedKey; }) || config.sites[0];
  }

  function cmsUrl(config, params) {
    var url = new URL(config.url);
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && String(value) !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }

  function categoryParams(raw) {
    var params = {
      t: raw.t,
      ac: 'videolist',
      pg: raw.pg || 1
    };
    var ext = decodeExt(raw.ext);
    Object.keys(ext || {}).forEach(function (key) {
      if (key === 't' || key === 'ac' || key === 'pg') return;
      if (ext[key] !== undefined && ext[key] !== null && String(ext[key]) !== '') {
        params[key] = ext[key];
      }
    });
    return params;
  }

  function unwrap(payload) {
    if (payload && payload.data && typeof payload.data === 'object' &&
        (payload.data.list || payload.data.class || payload.data.classes)) {
      return payload.data;
    }
    return payload || {};
  }

  function asList(value) { return Array.isArray(value) ? value : []; }

  function sourceCode(data) {
    return data && data.code !== undefined ? data.code : 0;
  }

  function sourceMessage(data) {
    return data && (data.msg || data.message) ? String(data.msg || data.message) : 'success';
  }

  function normalizeHome(payload) {
    var data = unwrap(payload);
    return {
      code: sourceCode(data),
      msg: sourceMessage(data),
      class: asList(data.class || data.classes),
      filters: data.filters || {},
      list: asList(data.list),
      page: data.page || 1,
      pagecount: data.pagecount || data.pageCount || 1,
      limit: data.limit || 0,
      total: data.total || asList(data.list).length
    };
  }

  function normalizeList(payload) {
    var data = unwrap(payload);
    return {
      code: sourceCode(data),
      msg: sourceMessage(data),
      page: data.page || 1,
      pagecount: data.pagecount || data.pageCount || 1,
      limit: data.limit || 0,
      total: data.total || asList(data.list).length,
      list: asList(data.list)
    };
  }

  function normalizePlay(raw, flag) {
    var value = String(raw || '').trim();
    if (!value) throw new Error('缺少播放地址');
    // 部分调用方会保留 URL 编码；只解一次，失败时继续使用原值。
    try { value = decodeURIComponent(value); } catch (_) {}
    return {
      parse: 0,
      jx: 0,
      url: value,
      header: {},
      flag: String(flag || '')
    };
  }

  function decodeExt(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      var raw = decodeURIComponent(String(value));
      if (raw.charAt(0) === '{') return JSON.parse(raw);
    } catch (_) {}
    try {
      var text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      try { return JSON.parse(decodeURIComponent(escape(atob(value)))); } catch (_) { return {}; }
    }
  }

  function fetchJson(config, params) {
    return ant.request({
      url: cmsUrl(config, params),
      timeout: 60000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'okhttp/4.12.0'
      }
    }).then(function (response) {
      var statusCode = Number(response && response.statusCode || 0);
      var rawData = response && response.data;
      if (statusCode < 200 || statusCode >= 300) {
        var errorBody = typeof rawData === 'string' ? rawData : JSON.stringify(rawData || '');
        var httpError = new Error('CMS HTTP ' + statusCode + (errorBody ? ': ' + errorBody.slice(0, 160) : ''));
        httpError.code = 'CMS_HTTP_' + statusCode;
        throw httpError;
      }
      // 兼容宿主旧版本或其它实现把 JSON 文本自动解析成对象的情况。
      if (rawData && typeof rawData === 'object') return rawData;
      var body = String(rawData || '').replace(/^\uFEFF/, '').trim();
      try {
        return JSON.parse(body);
      } catch (error) {
        // 个别 CMS 会把 JSON 放进 <pre>，或返回 JSONP；尽量剥掉包装再解析。
        var candidate = body.replace(/^\s*<pre[^>]*>/i, '').replace(/<\/pre>\s*$/i, '').trim();
        var jsonp = candidate.match(/^[\w$]+\s*\((.*)\)\s*;?$/s);
        if (jsonp) candidate = jsonp[1].trim();
        try {
          return JSON.parse(candidate);
        } catch (_) {
          var parseError = new Error('CMS 返回的不是 JSON：' + (body.slice(0, 180) || '空响应'));
          parseError.code = 'CMS_INVALID_JSON';
          throw parseError;
        }
      }
    });
  }

  function handleService(req) {
    rememberLanBase(req);
    return Promise.all([readConfig(), readLan()]).then(function (loaded) {
      var config = loaded[0];
      var path = businessPath(req);
      if (path === '/health' || path === '/api/health') {
        return jsonResponse({ code: 0, msg: 'ok', data: {
          appId: APP_ID,
          configured: config.sites.length > 0,
          sites: config.sites.length,
          siteKeys: config.sites.map(function (site) { return site.key; })
        } });
      }
      if (path === '/config' || path === '/api/config' || path === '/api/v1/config') {
        return jsonResponse(descriptor(config.sites, resolveApiBase(req, loaded[1])));
      }
      if (!config.sites.length) return errorResponse('NOT_CONFIGURED', '请先在小程序内配置 CMS 接口', 503);
      var site = selectSite(config, req);
      if (!site) return errorResponse('SITE_NOT_FOUND', '找不到 CMS 站点: ' + siteKeyFromRequest(req), 404);

      var params = req.params || {};
      var ac = String(params.ac || '').toLowerCase();
      if (params.play !== undefined && String(params.play) !== '') {
        return jsonResponse(normalizePlay(params.play, params.flag));
      }
      if (params.wd !== undefined && String(params.wd) !== '') {
        return fetchJson(site, { ac: 'detail', wd: params.wd, pg: params.pg || 1 })
          .then(normalizeList)
          .then(function (data) { return jsonResponse(data); });
      }
      if (ac === 'detail' && params.ids !== undefined && String(params.ids) !== '') {
        return fetchJson(site, { ac: 'detail', ids: params.ids })
          .then(normalizeList)
          .then(function (data) { return jsonResponse(data); });
      }
      if (params.t !== undefined && String(params.t) !== '') {
        return fetchJson(site, categoryParams(params))
          .then(normalizeList)
          .then(function (data) { return jsonResponse(data); });
      }
      return fetchJson(site, { filter: 'true' })
        .then(normalizeHome)
        .then(function (data) { return jsonResponse(data); });
    }).catch(function (error) {
      var message = (error && error.message) || String(error);
      return errorResponse(error && error.code ? error.code : 'UPSTREAM_FAILED', message, 502);
    });
  }

  // 先注册服务，再读配置；后台拉起时没有 DOM 也能正常处理请求。
  ant.serve(handleService);

  document.getElementById('save').addEventListener('click', function () {
    var config;
    try {
      var key = cleanKey(keyInput.value);
      var site = { key: key, name: String(nameInput.value || '').trim() || 'CMS 影视源', url: cleanUrl(urlInput.value) };
      var duplicate = current.sites.some(function (item) { return item.key === key && item.key !== editingKey; });
      if (duplicate) throw new Error('key 已存在，请使用其他 key');
      var sites = current.sites.filter(function (item) { return item.key !== editingKey && item.key !== key; });
      sites.push(site);
      config = { sites: sites, selectedKey: current.selectedKey || key };
      if (!config.selectedKey || !sites.some(function (item) { return item.key === config.selectedKey; })) config.selectedKey = key;
    } catch (e) {
      setStatus(e.message, 'error');
      return;
    }
    editingKey = '';
    saveConfig(config).catch(function (e) { setStatus('保存失败：' + e.message, 'error'); });
  });

  document.getElementById('test').addEventListener('click', function () {
    var config;
    try {
      config = {
        key: String(keyInput.value || '').trim() || 'test',
        name: String(nameInput.value || '').trim() || 'CMS 影视源',
        url: cleanUrl(urlInput.value)
      };
    }
    catch (e) { setStatus(e.message, 'error'); return; }
    setStatus('正在请求 CMS 首页…');
    fetchJson(config, { filter: 'true' }).then(function (data) {
      var normalized = normalizeHome(data);
      setStatus('接口正常：返回 ' + normalized.class.length + ' 个分类、' + normalized.list.length + ' 条推荐。', 'ok');
    }).catch(function (e) { setStatus('接口测试失败：' + ((e && e.message) || e), 'error'); });
  });

  document.getElementById('reset').addEventListener('click', function () {
    ant.storage.remove(STORAGE_KEY).then(function () {
      current = { sites: [], selectedKey: '' };
      editingKey = '';
      nameInput.value = '';
      urlInput.value = '';
      paint();
      setStatus('站点配置已清除，服务暂不可用（局域网地址保留）。');
    }).catch(function (e) { setStatus('清除失败：' + e.message, 'error'); });
  });

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      scope = tab.getAttribute('data-scope') === 'lan' ? 'lan' : 'internal';
      setExportStatus('');
      paintExport();
    });
  });

  document.getElementById('copy-config-url').addEventListener('click', function () {
    copyText(activeConfigUrl, 'config 接口');
  });

  document.getElementById('copy').addEventListener('click', function () {
    if (!current.sites.length) { setExportStatus('请先添加站点。', 'error'); return; }
    if (scope === 'lan' && !effectiveLanBase()) { setExportStatus('请先设置局域网地址。', 'error'); return; }
    copyText(output.textContent, '配置 JSON');
  });

  document.getElementById('lan-save').addEventListener('click', function () {
    var base;
    try { base = cleanLanBase(lanInput.value); }
    catch (e) { setExportStatus(e.message, 'error'); return; }
    var parsed = new URL(base);
    writeLan({ base: base, detected: lan.detected, detectedAt: lan.detectedAt }).then(function () {
      lanInput.value = base;
      scope = 'lan';
      paintExport();
      if (!isLanHost(parsed.hostname)) {
        setExportStatus('已保存，但这不像局域网地址，别的设备可能连不上。', 'error');
      } else if (!String(parsed.pathname || '').replace(/\/+$/, '')) {
        setExportStatus('已保存，但地址里缺少 token 段，请从宿主整段复制。', 'error');
      } else {
        setExportStatus('局域网地址已保存。', 'ok');
      }
    }).catch(function (e) { setExportStatus('保存失败：' + ((e && e.message) || e), 'error'); });
  });

  document.getElementById('lan-clear').addEventListener('click', function () {
    writeLan({ base: '', detected: lan.detected, detectedAt: lan.detectedAt }).then(function () {
      lanInput.value = '';
      paintExport();
      setExportStatus(lan.detected ? '已清除手填地址，改用自动识别的地址。' : '已清除局域网地址。');
    }).catch(function (e) { setExportStatus('清除失败：' + ((e && e.message) || e), 'error'); });
  });

  ant.tv.onKey(function (event) {
    var items = Array.prototype.slice.call(document.querySelectorAll('input, button:not([disabled])'));
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (index + 1) % items.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === 'Enter' || event.key === 'Select') { if (document.activeElement) document.activeElement.click(); return; }
    else return;
    items[index].focus();
    if (items[index].scrollIntoView) items[index].scrollIntoView({ block: 'nearest' });
  });

  // 回到前台时重读一次：局域网地址可能是后台请求进来时才认出来的。
  ant.onShow(function () {
    readLan().then(function (value) {
      lan = value;
      if (!lanInput.value) lanInput.value = lan.base;
      paintExport();
    }).catch(function () {});
  });

  Promise.all([readConfig(), readLan()]).then(function (loaded) {
    current = loaded[0];
    lan = loaded[1];
    lanInput.value = lan.base;
    paint();
    if (current.sites.length) setStatus('已加载 ' + current.sites.length + ' 个 CMS 站点，T4 服务运行中。', 'ok');
    else setStatus('添加站点后，下面的 config 接口就能给其它应用用了。');
  }).catch(function (e) { setStatus('读取配置失败：' + ((e && e.message) || e), 'error'); });
})();
