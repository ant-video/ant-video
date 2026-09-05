(function () {
  'use strict';

  var APP_ID = 'com.leospring.cms_t4_bridge';
  var STORAGE_KEY = 'cms-t4-config';
  var keyInput = document.getElementById('key');
  var nameInput = document.getElementById('name');
  var urlInput = document.getElementById('url');
  var siteList = document.getElementById('site-list');
  var siteEditorTitle = document.getElementById('site-editor-title');
  var status = document.getElementById('status');
  var output = document.getElementById('config-output');
  var current = { sites: [], selectedKey: '' };
  var editingKey = '';

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
      paintConfig();
      setStatus(message || '配置已保存，T4 服务已启用。', 'ok');
    });
  }

  function configDescriptor() {
    return { sites: current.sites.map(function (site) {
      return {
        key: site.key,
        name: site.name,
        type: 4,
        api: 'miniapp://' + APP_ID + '?site=' + encodeURIComponent(site.key)
      };
    }) };
  }

  function paintConfig() {
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
      item.querySelector('[data-key="edit"]').addEventListener('click', function () { editingKey = site.key; paintConfig(); });
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
    output.textContent = JSON.stringify(configDescriptor(), null, 2);
  }

  function siteKeyFromRequest(req) {
    return String(req && req.params && req.params.site || '').trim();
  }

  function serviceApiBase(req) {
    var headers = req && req.headers || {};
    var lanBase = headers['X-Ant-Lan-Base'] || headers['x-ant-lan-base'];
    if (lanBase) return String(lanBase).replace(/\/$/, '');
    return 'miniapp://' + APP_ID;
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
    return readConfig().then(function (config) {
      var path = req.path || '/';
      if (path === '/health' || path === '/api/health') {
        return jsonResponse({ code: 0, msg: 'ok', data: { appId: APP_ID, configured: config.sites.length > 0, sites: config.sites.length } });
      }
      if (path === '/config' || path === '/api/config' || path === '/api/v1/config') {
        var apiBase = serviceApiBase(req);
        return jsonResponse({ sites: config.sites.map(function (site) {
          return { key: site.key, name: site.name, type: 4, api: apiBase + '?site=' + encodeURIComponent(site.key) };
        }) });
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
      paintConfig();
      setStatus('配置已清除，服务暂不可用。');
    }).catch(function (e) { setStatus('清除失败：' + e.message, 'error'); });
  });

  document.getElementById('copy').addEventListener('click', function () {
    if (!current.sites.length) { setStatus('请先保存配置。', 'error'); return; }
    ant.clipboard.set(output.textContent).then(function () { setStatus('配置 JSON 已复制。', 'ok'); });
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
  });

  readConfig().then(function (config) {
    current = normalizeConfig(config);
    paintConfig();
    if (current.sites.length) setStatus('已加载 ' + current.sites.length + ' 个 CMS 站点，T4 服务运行中。', 'ok');
  }).catch(function (e) { setStatus('读取配置失败：' + e.message, 'error'); });
})();
