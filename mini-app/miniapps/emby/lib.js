/*!
 * 影视库 · 共享运行时
 *
 * 只依赖宿主注入的 window.ant：
 *   ant.source.*  取数据（宿主已配置的采集源）
 *   ant.player.*  播放
 *   ant.storage.* 站点选择、观看历史、跨页传参
 *   ant.ui.*      提示
 *   ant.tv.onKey  遥控器焦点
 */
(function () {
  'use strict';

  var App = (window.App = { site: null, sites: [] });

  /* ---------------- 工具 ---------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /** 并发池。采集源在宿主侧的并发上限是 3，这里保守用 2。 */
  function pool(items, size, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    function next() {
      if (cursor >= items.length) return Promise.resolve();
      var index = cursor++;
      return Promise.resolve()
        .then(function () { return worker(items[index], index); })
        .then(function (value) { results[index] = value; })
        .catch(function (e) { results[index] = { __error: e }; })
        .then(next);
    }
    var runners = [];
    for (var i = 0; i < Math.min(size, items.length); i++) runners.push(next());
    return Promise.all(runners).then(function () { return results; });
  }

  function errText(e) {
    if (!e) return '未知错误';
    return (e.code ? e.code + ' · ' : '') + (e.message || String(e));
  }

  function toast(message) {
    try { ant.ui.toast(message); } catch (e) { /* ui 权限缺失时静默 */ }
  }

  /* ---------------- 顶栏 ---------------- */

  function renderHeader(active) {
    var host = document.getElementById('app-header');
    if (!host) return;
    var tabs = [
      { id: 'home', name: '首页', href: 'index.html' },
      { id: 'library', name: '媒体库', href: 'library.html' },
      { id: 'search', name: '搜索', href: 'search.html' }
    ];
    host.className = 'header';
    host.innerHTML =
      '<div class="brand"><i>▶</i>影视库</div>' +
      '<nav class="nav">' +
      tabs.map(function (t) {
        return '<a data-focus href="' + t.href + '" class="' +
          (t.id === active ? 'on' : '') + '">' + t.name + '</a>';
      }).join('') +
      '</nav>' +
      '<button data-focus class="site-chip" id="site-chip">' +
      '<span>源</span><b>…</b></button>';

    var chip = document.getElementById('site-chip');
    if (chip) chip.addEventListener('click', switchSite);
  }

  function paintSiteChip() {
    var chip = document.getElementById('site-chip');
    if (!chip) return;
    var name = App.site ? App.site.name : '未配置';
    chip.innerHTML = '<span>源</span><b>' + esc(name) + '</b>';
  }

  function switchSite() {
    if (App.sites.length < 2) {
      toast('只有一个可用采集源');
      return;
    }
    var names = App.sites.map(function (s) { return s.name; });
    ant.ui.actionSheet(names).then(function (index) {
      if (index < 0 || !App.sites[index]) return;
      var next = App.sites[index];
      if (App.site && next.key === App.site.key) return;
      return ant.storage.set('site', next.key).then(function () {
        location.reload();
      });
    }).catch(function (e) { toast('切换失败：' + errText(e)); });
  }

  /* ---------------- 启动 ---------------- */

  function stateHtml(icon, title, detail, actionHtml) {
    return '<div class="state"><div class="ico">' + icon + '</div><h3>' +
      esc(title) + '</h3><p>' + detail + '</p>' + (actionHtml || '') + '</div>';
  }

  /**
   * 解析站点、渲染顶栏、装上遥控焦点。
   * 返回 false 表示环境不满足，调用方应停止后续渲染。
   */
  function boot(options) {
    var opts = options || {};
    var main = document.getElementById('app-main');

    if (typeof window.ant === 'undefined') {
      if (main) {
        main.innerHTML = stateHtml(
          '🧩', '需要在宿主里运行',
          '这个页面依赖宿主注入的 <code>window.ant</code>。<br/>' +
          '在浏览器里开发请先引入 ant-mock.js。'
        );
      }
      return Promise.resolve(false);
    }

    renderHeader(opts.active);
    initTvFocus();

    return ant.source.list().then(function (sites) {
      App.sites = sites || [];
      if (!App.sites.length) {
        paintSiteChip();
        if (main) {
          main.innerHTML = stateHtml(
            '📡', '还没有可用的采集源',
            '这个小程序复用宿主已配置的采集源。<br/>请先在宿主的影视模块里添加配置源，再回来刷新。'
          );
        }
        return false;
      }
      return ant.storage.get('site').then(function (saved) {
        App.site = null;
        for (var i = 0; i < App.sites.length; i++) {
          if (App.sites[i].key === saved) { App.site = App.sites[i]; break; }
        }
        if (!App.site) App.site = App.sites[0];
        paintSiteChip();
        return true;
      });
    }).catch(function (e) {
      if (main) {
        main.innerHTML = stateHtml('⚠️', '采集源读取失败', esc(errText(e)));
      }
      return false;
    });
  }

  /* ---------------- 卡片 ---------------- */

  function posterHtml(vod) {
    var pic = vod.vod_pic || '';
    var name = vod.vod_name || '';
    var inner = pic
      ? '<img loading="lazy" src="' + esc(pic) + '" alt="" ' +
        'onerror="this.parentNode.innerHTML=\'<div class=&quot;ph&quot;>' +
        esc(name.slice(0, 1)) + '</div>\'"/>'
      : '<div class="ph">' + esc(name.slice(0, 1)) + '</div>';
    var badge = vod.vod_remarks
      ? '<div class="badge">' + esc(vod.vod_remarks) + '</div>' : '';
    var bar = vod.__progress
      ? '<div class="progress"><i style="width:' + vod.__progress + '%"></i></div>' : '';
    return '<div class="poster">' + inner + badge + bar + '</div>';
  }

  function cardHtml(vod, index) {
    var sub = vod.vod_year || vod.vod_type || vod.vod_area || '';
    return '<button data-focus class="card" data-index="' + index + '">' +
      posterHtml(vod) +
      '<div class="card-name">' + esc(vod.vod_name || '未命名') + '</div>' +
      (sub ? '<div class="card-sub">' + esc(sub) + '</div>' : '') +
      '</button>';
  }

  /** 渲染一批卡片并绑定点击 → 详情页。 */
  function renderCards(container, list, options) {
    var opts = options || {};
    if (!container) return;
    if (!list || !list.length) {
      container.innerHTML =
        '<div class="hint" style="padding:18px 0">' +
        esc(opts.empty || '没有内容') + '</div>';
      return;
    }
    container.innerHTML = list.map(cardHtml).join('');
    container.querySelectorAll('.card').forEach(function (node) {
      node.addEventListener('click', function () {
        openDetail(list[Number(node.dataset.index)]);
      });
    });
  }

  /** wrapClass 传 null 时只返回骨架单元，方便塞进已有的容器。 */
  function skeleton(count, wrapClass) {
    var one = '<div><div class="sk sk-poster"></div>' +
      '<div class="sk sk-line" style="width:82%"></div>' +
      '<div class="sk sk-line" style="width:52%"></div></div>';
    var cells = '';
    for (var i = 0; i < count; i++) cells += one;
    if (wrapClass === null) return cells;
    return '<div class="' + (wrapClass || 'rail') + '">' + cells + '</div>';
  }

  /* ---------------- 页面跳转 ---------------- */

  /**
   * vod_id 在爬虫源里可能是很长的 JSON 串，放 URL 不可靠，
   * 所以摘要走 ant.storage 传递，URL 只带 id 兜住刷新场景。
   */
  function openDetail(vod) {
    if (!vod) return;
    ant.storage
      .setJSON('nav.detail', {
        siteKey: App.site ? App.site.key : '',
        vod: vod
      })
      .then(function () {
        return ant.navigateTo(
          'detail.html?id=' + encodeURIComponent(vod.vod_id || '')
        );
      })
      .catch(function (e) { toast('打开失败：' + errText(e)); });
  }

  function openLibrary(typeId, typeName) {
    ant.navigateTo(
      'library.html?tid=' + encodeURIComponent(typeId) +
      '&name=' + encodeURIComponent(typeName || '')
    );
  }

  /* ---------------- 观看历史 ---------------- */

  var HISTORY_MAX = 20;

  function getHistory() {
    return ant.storage.getJSON('history', []).then(function (list) {
      return Array.isArray(list) ? list : [];
    });
  }

  function pushHistory(siteKey, vod) {
    if (!vod || !vod.vod_id) return Promise.resolve();
    return getHistory().then(function (list) {
      var kept = list.filter(function (item) {
        return !(item.siteKey === siteKey && item.vodId === String(vod.vod_id));
      });
      kept.unshift({
        siteKey: siteKey,
        vodId: String(vod.vod_id),
        vod_id: vod.vod_id,
        vod_name: vod.vod_name,
        vod_pic: vod.vod_pic,
        vod_remarks: vod.vod_remarks,
        vod_year: vod.vod_year,
        at: Date.now()
      });
      return ant.storage.setJSON('history', kept.slice(0, HISTORY_MAX));
    });
  }

  function epKey(siteKey, vodId) {
    return 'ep:' + siteKey + ':' + vodId;
  }

  function getLastEp(siteKey, vodId) {
    return ant.storage.getJSON(epKey(siteKey, vodId), null);
  }

  function setLastEp(siteKey, vodId, record) {
    return ant.storage.setJSON(epKey(siteKey, vodId), record);
  }

  /* ---------------- 线路与选集 ---------------- */

  /**
   * 把 vod_play_from / vod_play_url 解析成线路数组。
   * 宿主返回时这两个字段已经是数组（按 $$$ 切好），线内格式是
   * `名称$地址#名称$地址`。
   */
  function parseLines(vod) {
    var froms = vod && vod.vod_play_from ? vod.vod_play_from : [];
    var urls = vod && vod.vod_play_url ? vod.vod_play_url : [];
    var lines = [];

    for (var i = 0; i < Math.max(froms.length, urls.length); i++) {
      var raw = String(urls[i] == null ? '' : urls[i]);
      if (!raw) continue;
      var episodes = raw.split('#').map(function (chunk) {
        var text = String(chunk).trim();
        if (!text) return null;
        var at = text.indexOf('$');
        if (at < 0) return { name: text, id: text };
        return {
          name: text.slice(0, at).trim() || '播放',
          id: text.slice(at + 1).trim()
        };
      }).filter(Boolean);

      if (!episodes.length) continue;
      var name = String(froms[i] == null ? '' : froms[i]).trim();
      lines.push({ name: name || '线路' + (i + 1), episodes: episodes });
    }
    return lines;
  }

  /** 从 source.play 的返回里挑出一个可播地址。 */
  function pickUrl(info) {
    if (!info) return '';
    var url = info.url;
    if (typeof url === 'string') return url.trim();
    if (Array.isArray(url)) {
      for (var i = 0; i < url.length; i++) {
        var item = url[i];
        if (typeof item === 'string' && /^https?:/i.test(item)) return item;
      }
    }
    return '';
  }

  /**
   * 解析并播放一集。
   *
   * 统一走 source.play：CMS 源会原样回显地址，爬虫源会去解析，
   * 两种情况调用方都不用区分。
   */
  function playEpisode(siteKey, vod, line, episode) {
    var title = (vod.vod_name || '播放') + ' · ' + episode.name;
    // ant.ui.loading('正在解析…');

    return ant.source
      .play({ siteKey: siteKey, flag: line.name, id: episode.id })
      .then(function (info) {
        var url = pickUrl(info);
        var needSniff =
          info && (String(info.parse) === '1' || String(info.jx) === '1');

        if (needSniff) {
          var e = new Error('这条线路需要宿主内置解析，小程序里放不了，换一条线路试试');
          e.code = 'NEED_SNIFF';
          throw e;
        }
        if (!url && /^https?:/i.test(episode.id)) url = episode.id;
        if (!url) {
          var e2 = new Error('没有拿到可播放地址');
          e2.code = 'NO_URL';
          throw e2;
        }
        if (info && info.header && Object.keys(info.header).length) {
          ant.log('该地址带请求头，当前 player.open 不支持下发，可能取流失败');
        }
        return ant.player.open({ url: url, title: title });
      })
      .then(function () {
        return setLastEp(siteKey, String(vod.vod_id), {
          line: line.name,
          name: episode.name,
          id: episode.id,
          at: Date.now()
        });
      })
      .then(function () { return ant.ui.hideLoading(); })
      .catch(function (e) {
        return ant.ui.hideLoading().then(function () {
          toast(e && e.code === 'NEED_SNIFF' ? e.message : '播放失败：' + errText(e));
          throw e;
        });
      });
  }
  /* ---------------- 遥控器焦点 ---------------- */

  var focusEl = null;

  function focusCandidates() {
    return Array.prototype.filter.call(
      document.querySelectorAll('[data-focus]'),
      function (node) {
        var r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
    );
  }

  function centerOf(node) {
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function setFocus(node) {
    if (!node) return;
    if (focusEl) focusEl.classList.remove('tv-focus');
    focusEl = node;
    node.classList.add('tv-focus');
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * 按几何位置找同方向最近的可聚焦元素。
   * 比按 DOM 顺序走靠谱得多——横向 rail 和网格混排时，DOM 顺序和视觉顺序常常不一致。
   */
  function moveFocus(direction) {
    var items = focusCandidates();
    if (!items.length) return;
    if (!focusEl || items.indexOf(focusEl) < 0) {
      setFocus(items[0]);
      return;
    }

    var from = centerOf(focusEl);
    var best = null;
    var bestScore = Infinity;

    items.forEach(function (node) {
      if (node === focusEl) return;
      var to = centerOf(node);
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      var main;
      var cross;

      if (direction === 'ArrowLeft') { main = -dx; cross = Math.abs(dy); }
      else if (direction === 'ArrowRight') { main = dx; cross = Math.abs(dy); }
      else if (direction === 'ArrowUp') { main = -dy; cross = Math.abs(dx); }
      else { main = dy; cross = Math.abs(dx); }

      if (main <= 2) return;                 // 不在这个方向上
      var score = main + cross * 2.2;        // 偏向同一排 / 同一列
      if (score < bestScore) { bestScore = score; best = node; }
    });

    if (best) setFocus(best);
  }

  function initTvFocus() {
    if (!window.ant || !ant.tv || initTvFocus.done) return;
    initTvFocus.done = true;

    ant.tv.onKey(function (event) {
      var key = event && event.key;
      if (key === 'Enter') {
        if (focusEl) focusEl.click();
        else moveFocus('ArrowDown');
        return;
      }
      if (key && key.indexOf('Arrow') === 0) moveFocus(key);
    });

    // 鼠标/触摸点过的元素同步成当前焦点，避免遥控接管后焦点跳回开头
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.closest
        ? event.target.closest('[data-focus]')
        : null;
      if (node) setFocus(node);
    }, true);
  }

  /* ---------------- 导出 ---------------- */

  window.EmbyUI = {
    esc: esc,
    qs: qs,
    pool: pool,
    errText: errText,
    toast: toast,
    boot: boot,
    stateHtml: stateHtml,
    skeleton: skeleton,
    posterHtml: posterHtml,
    cardHtml: cardHtml,
    renderCards: renderCards,
    openDetail: openDetail,
    openLibrary: openLibrary,
    getHistory: getHistory,
    pushHistory: pushHistory,
    getLastEp: getLastEp,
    setLastEp: setLastEp,
    parseLines: parseLines,
    playEpisode: playEpisode,
    setFocus: setFocus
  };
})();
