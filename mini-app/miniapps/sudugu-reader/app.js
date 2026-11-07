(function () {
  'use strict';
  const view = document.getElementById('view');
  const state = {categories: [], list: [], category: 'all', keyword: '', page: 1, pagecount: 1,
    shelf: {}, progress: {}, settings: {}, details: new Map(), routeToken: 0, catalogPage: 1, catalogQuery: '', reverse: false};
  let reading = null;
  let scrollTimer = null;
  let saveQueue = Promise.resolve();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const readHash = (id, index, url) => '#read/' + id + '/' + index + (url ? '/' + encodeURIComponent(url) : '');
  const route = () => (location.hash.slice(1) || 'home').split('/');
  const notify = message => ant.ui.toast(message).catch(error => console.warn('提示失败', error));
  async function call(method, ...args) {
    if (!ant.python || typeof ant.python.call !== 'function') throw new Error('当前应用尚不支持此阅读器，请更新应用后重试');
    const result = await ant.python.call(method, ...args);
    if (!result || result.error) throw new Error((result && result.error) || '没有收到阅读数据，请重试');
    return result;
  }
  function store(key, value) {
    // 快速连续操作也按顺序写入，避免较早的进度覆盖较新的记录。
    const snapshot = JSON.parse(JSON.stringify(value));
    saveQueue = saveQueue.then(() => ant.storage.setJSON(key, snapshot)).catch(error => {
      console.warn('保存失败', error); notify('保存失败，请检查本地存储后重试');
    });
    return saveQueue;
  }
  function settings() {
    if (state.settings.theme) document.body.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty('--font-size', (state.settings.fontSize || 21) + 'px');
    document.documentElement.style.setProperty('--line-height', state.settings.lineHeight || 1.95);
  }
  function cover(book) {
    const image = /^https:\/\//i.test(book.vod_pic || '') ? '<img loading="lazy" src="' + esc(book.vod_pic) + '" alt="">' : '';
    return '<div class="cover"><span>' + esc(book.vod_name) + '</span>' + image + '</div>';
  }
  function bindImageFallbacks() {
    view.querySelectorAll('.cover img').forEach(img => img.addEventListener('error', () => img.remove(), {once: true}));
  }
  function bookCards(books, shelf = false) {
    if (!books.length) return '<div class="empty"><h2>' + (shelf ? '书架还空着' : '没有找到小说') + '</h2><p>' + (shelf ? '去书城挑一本，把想读的故事放在这里。' : '换个书名、作者或分类再试试。') + '</p>' + (shelf ? '<a href="#home"><button>去书城看看</button></a>' : '') + '</div>';
    return '<div class="book-grid">' + books.map(book => {
      const progress = state.progress[book.vod_id];
      const href = shelf && progress ? readHash(book.vod_id, progress.index, progress.url) : '#book/' + book.vod_id;
      return '<div class="' + (shelf ? 'shelf-card' : '') + '"><a class="book-card" href="' + esc(href) + '">' + cover(book) + '<div class="book-info"><h3>' + esc(book.vod_name) + '</h3><p>' + esc(book.vod_actor || '速读谷') + '</p><p class="remark">' + esc(book.vod_remarks || '打开查看目录') + '</p>' + (progress ? '<div class="continue-note">读至 ' + esc(progress.title) + '</div>' : '') + '</div></a>' + (shelf ? '<button class="remove-book" data-remove="' + esc(book.vod_id) + '">移出书架</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function resumeBanner() {
    const entries = Object.entries(state.progress).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    if (!entries.length) return '';
    const [id, progress] = entries[0];
    return '<div class="resume-banner"><p>' + esc(progress.bookName) + '<small>上次读到 ' + esc(progress.title) + '</small></p><a href="' + esc(readHash(id, progress.index, progress.url)) + '"><button>继续阅读</button></a></div>';
  }
  function pagination(page, count, kind) {
    return '<div class="pager"><button data-page="' + (page - 1) + '" data-kind="' + kind + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + page + ' / ' + Math.max(page, count) + ' 页</span><button data-page="' + (page + 1) + '" data-kind="' + kind + '"' + (page >= count ? ' disabled' : '') + '>下一页</button></div>';
  }
  function renderList() {
    const searching = route()[0] === 'search';
    const title = searching ? '搜索结果' : '今天，读哪一本？';
    view.innerHTML = '<div class="intro-row"><div><h1>' + title + '</h1><p class="subtext">' + (searching ? '与「' + esc(state.keyword) + '」相关的小说' : '从书城选一本，也可以接着上次的故事。') + '</p></div></div>' + (searching ? '' : resumeBanner() + '<div class="categories" aria-label="小说分类">' + state.categories.map(c => '<button data-category="' + esc(c.type_id) + '" aria-pressed="' + (c.type_id === state.category) + '">' + esc(c.type_name.replace('小说', '')) + '</button>').join('') + '</div>') + '<div class="section-title"><h2>' + (searching ? '找到的小说' : esc((state.categories.find(c => c.type_id === state.category) || {type_name:'书城推荐'}).type_name)) + '</h2><span>第 ' + state.page + ' 页</span></div>' + bookCards(state.list) + pagination(state.page, state.pagecount, 'list');
    bindImageFallbacks();
  }
  async function getDetail(id) {
    if (state.details.has(id)) return state.details.get(id);
    const book = await call('detail', id);
    state.details.set(id, book);
    return book;
  }
  function renderCatalog(book) {
    let items = book.chapters.map((chapter, index) => ({...chapter, index}));
    if (state.catalogQuery) items = items.filter(chapter => chapter.title.includes(state.catalogQuery));
    if (state.reverse) items.reverse();
    const count = Math.max(1, Math.ceil(items.length / 100));
    state.catalogPage = Math.min(state.catalogPage, count);
    const current = state.progress[book.vod_id];
    const content = items.slice((state.catalogPage - 1) * 100, state.catalogPage * 100);
    document.getElementById('chapter-items').innerHTML = '<div class="chapter-grid">' + content.map(c => '<a class="chapter-link' + (current && current.index === c.index ? ' current' : '') + '" href="' + readHash(book.vod_id, c.index) + '">' + esc(c.title) + '</a>').join('') + '</div>' + (items.length ? pagination(state.catalogPage, count, 'catalog') : '<p class="empty">没有找到这个章节，换个关键词试试。</p>');
  }
  function renderBook(book) {
    const current = state.progress[book.vod_id];
    const saved = !!state.shelf[book.vod_id];
    view.innerHTML = '<a class="back-link" href="#home">返回书城</a><section class="book-detail">' + cover(book) + '<div class="detail-text"><h1>' + esc(book.vod_name) + '</h1><p class="meta">' + esc(book.vod_actor || '速读谷') + '<br>' + esc(book.vod_remarks || '') + '　共 ' + book.chapters.length + ' 章</p><div class="actions"><a href="' + esc(readHash(book.vod_id, current ? current.index : 0, current && current.url)) + '"><button class="primary">' + (current ? '继续阅读' : '开始阅读') + '</button></a><button id="save-book" data-save="' + esc(book.vod_id) + '">' + (saved ? '已在书架' : '加入书架') + '</button></div></div></section><p class="description">' + esc(book.vod_content || '暂无简介') + '</p><section class="catalog"><div class="catalog-tools"><h2>章节目录</h2><input id="chapter-query" type="search" placeholder="查找章节" aria-label="查找章节" value="' + esc(state.catalogQuery) + '"><button data-order> ' + (state.reverse ? '恢复正序' : '倒序排列') + '</button></div><div id="chapter-items"></div></section>';
    renderCatalog(book); bindImageFallbacks();
    document.getElementById('chapter-query').addEventListener('input', event => {
      state.catalogQuery = event.target.value.trim(); state.catalogPage = 1; renderCatalog(book);
    });
  }
  function captureProgress() {
    if (!reading || !document.querySelector('.reader-content')) return;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const progress = {index: reading.index, url: reading.chapter.url, ratio: Math.min(1, scrollY / max),
      title: reading.chapter.title, bookName: reading.book.vod_name, updatedAt: Date.now()};
    state.progress[reading.book.vod_id] = progress;
    document.getElementById('progress-fill').style.width = Math.round(progress.ratio * 100) + '%';
  }
  function saveProgress() { captureProgress(); return store('progress', state.progress); }
  function renderReader(book, index, chapter) {
    const saved = state.progress[book.vod_id];
    reading = {book, index, chapter};
    const nextHref = chapter.nextPageUrl ? readHash(book.vod_id, index, chapter.nextPageUrl) : readHash(book.vod_id, index + 1);
    const prevHref = chapter.previousPageUrl ? readHash(book.vod_id, index, chapter.previousPageUrl) : readHash(book.vod_id, index - 1);
    view.innerHTML = '<article class="reader"><div class="reader-bar"><a href="#book/' + book.vod_id + '"><button>目录</button></a><span class="book-label">' + esc(book.vod_name) + '</span><button data-save="' + book.vod_id + '">' + (state.shelf[book.vod_id] ? '已在书架' : '加入书架') + '</button><button id="settings-button" aria-expanded="false" aria-controls="reading-settings">阅读设置</button></div><div class="reading-progress"><span id="progress-fill"></span></div><div class="reader-content"><h1>' + esc(chapter.title) + '</h1><div class="chapter-body">' + chapter.content.split(/\n+/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('') + '</div><div class="chapter-bottom">' + (index > 0 || chapter.previousPageUrl ? '<a href="' + esc(prevHref) + '"><button>' + (chapter.previousPageUrl ? '上一页正文' : '上一章') + '</button></a>' : '<button disabled>上一章</button>') + '<span>' + (index + 1) + ' / ' + book.chapters.length + '</span>' + (index < book.chapters.length - 1 || chapter.nextPageUrl ? '<a href="' + esc(nextHref) + '"><button>' + (chapter.nextPageUrl ? '下一页正文' : '下一章') + '</button></a>' : '<button disabled>已读到最后</button>') + '</div></div><p class="reader-note">正文来自速读谷</p></article><aside id="reading-settings" class="settings" hidden aria-label="阅读设置"><h2>阅读设置</h2><label>文字大小 <input id="font-size" type="range" min="16" max="32" step="1" value="' + (state.settings.fontSize || 21) + '"></label><label>行间距 <input id="line-height" type="range" min="1.5" max="2.5" step="0.05" value="' + (state.settings.lineHeight || 1.95) + '"></label><div class="theme-buttons">' + [['day','清爽'],['warm','护眼'],['night','夜间']].map(([key,name]) => '<button data-theme="' + key + '" aria-pressed="' + (state.settings.theme === key) + '">' + name + '</button>').join('') + '</div><div class="actions"><button data-settings-close>完成</button></div></aside>';
    document.getElementById('font-size').addEventListener('input', event => { state.settings.fontSize = Number(event.target.value); settings(); store('settings', state.settings); });
    document.getElementById('line-height').addEventListener('input', event => { state.settings.lineHeight = Number(event.target.value); settings(); store('settings', state.settings); });
    // 恢复同一章节、同一正文分页的位置；等布局就绪再滚动。
    requestAnimationFrame(() => {
      if (!reading || reading.chapter !== chapter) return;
      const ratio = saved && saved.index === index && saved.url === chapter.url ? saved.ratio : 0;
      window.scrollTo(0, ratio * Math.max(0, document.documentElement.scrollHeight - innerHeight));
      captureProgress(); store('progress', state.progress);
    });
  }
  async function navigate() {
    if (reading) await saveProgress();
    reading = null;
    const token = ++state.routeToken;
    const [page, id, rawIndex, part] = route();
    document.body.classList.toggle('reading', page === 'read');
    document.querySelectorAll('[data-tab]').forEach(a => a.setAttribute('aria-current', a.dataset.tab === page ? 'page' : 'false'));
    view.setAttribute('aria-busy', 'true');
    view.innerHTML = '<p class="status">' + (page === 'read' ? '正在加载正文…' : '正在加载…') + '</p>';
    window.scrollTo(0, 0);
    try {
      if (page === 'shelf') {
        view.innerHTML = '<div class="intro-row"><div><h1>我的书架</h1><p class="subtext">想读的故事，随时接着读。</p></div></div>' + resumeBanner() + bookCards(Object.values(state.shelf), true);
        bindImageFallbacks();
      } else if (page === 'book' || page === 'read') {
        const book = await getDetail(id);
        if (token !== state.routeToken) return;
        if (page === 'book') renderBook(book);
        else {
          const parsedIndex = Number(rawIndex);
          const index = Math.min(Math.max(Number.isInteger(parsedIndex) ? parsedIndex : 0, 0), book.chapters.length - 1);
          const chapter = await call('chapter', part ? decodeURIComponent(part) : book.chapters[index].url);
          if (token !== state.routeToken) return;
          renderReader(book, index, chapter);
        }
      } else if (page === 'search') {
        state.keyword = decodeURIComponent(id || ''); state.page = Math.max(1, Number(rawIndex) || 1);
        document.getElementById('keyword').value = state.keyword;
        const result = await call('search', state.keyword, state.page);
        if (token !== state.routeToken) return;
        state.list = result.list; state.pagecount = result.pagecount; renderList();
      } else {
        state.category = id || 'all'; state.page = Math.max(1, Number(rawIndex) || 1);
        if (!state.categories.length) {
          const home = await call('home');
          if (token !== state.routeToken) return;
          state.categories = home.categories;
        }
        const result = await call('listing', state.category, state.page);
        if (token !== state.routeToken) return;
        state.list = result.list; state.pagecount = result.pagecount; renderList();
      }
    } catch (error) {
      if (token !== state.routeToken) return;
      view.innerHTML = '<div class="error-box"><h2>暂时没能打开</h2><p>' + esc(error.message) + '</p><button data-retry>重试</button> <a href="#home"><button>返回书城</button></a></div>';
      console.warn('阅读加载失败', error);
    } finally { if (token === state.routeToken) view.setAttribute('aria-busy', 'false'); }
  }
  document.getElementById('search-form').addEventListener('submit', event => {
    event.preventDefault(); const keyword = document.getElementById('keyword').value.trim();
    if (!keyword) { notify('请输入书名或作者'); return; }
    location.hash = '#search/' + encodeURIComponent(keyword) + '/1';
  });
  view.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-retry')) { navigate(); return; }
    if (button.dataset.category) { location.hash = '#home/' + button.dataset.category + '/1'; return; }
    if (button.dataset.page) {
      if (button.dataset.kind === 'catalog') { state.catalogPage = Number(button.dataset.page); renderCatalog(state.details.get(route()[1])); }
      else location.hash = route()[0] === 'search' ? '#search/' + encodeURIComponent(state.keyword) + '/' + button.dataset.page : '#home/' + state.category + '/' + button.dataset.page;
      return;
    }
    if (button.hasAttribute('data-order')) { state.reverse = !state.reverse; state.catalogPage = 1; renderBook(state.details.get(route()[1])); return; }
    if (button.dataset.save) {
      const book = state.details.get(button.dataset.save); if (!book || state.shelf[book.vod_id]) return;
      state.shelf[book.vod_id] = {vod_id: book.vod_id, vod_name: book.vod_name, vod_pic: book.vod_pic,
        vod_actor: book.vod_actor, vod_remarks: book.vod_remarks};
      await store('shelf', state.shelf); button.textContent = '已在书架'; notify('已加入书架'); return;
    }
    if (button.dataset.remove) {
      delete state.shelf[button.dataset.remove]; await store('shelf', state.shelf); navigate(); return;
    }
    if (button.id === 'settings-button' || button.hasAttribute('data-settings-close')) {
      const panel = document.getElementById('reading-settings'); panel.hidden = !panel.hidden;
      document.getElementById('settings-button').setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) panel.querySelector('input').focus(); return;
    }
    if (button.dataset.theme) {
      state.settings.theme = button.dataset.theme; settings(); store('settings', state.settings);
      view.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    }
  });
  window.addEventListener('scroll', () => {
    if (!reading) return; captureProgress(); clearTimeout(scrollTimer); scrollTimer = setTimeout(saveProgress, 350);
  }, {passive: true});
  window.addEventListener('hashchange', navigate);
  ant.onHide(() => { if (reading) saveProgress(); });
  window.addEventListener('pagehide', () => { if (reading) saveProgress(); });
  ant.tv.onKey(event => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Select'].includes(event.key)) return;
    if (event.key === 'Enter' || event.key === 'Select') {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.click(); return;
    }
    if (reading && document.getElementById('reading-settings').hidden && ['ArrowUp','ArrowDown'].includes(event.key)) {
      window.scrollBy(0, (event.key === 'ArrowDown' ? 1 : -1) * innerHeight * .7); return;
    }
    const items = Array.from(document.querySelectorAll('a[href],button:not([disabled]),input,select')).filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + items.length) % items.length;
    items[next].focus(); items[next].scrollIntoView({block:'nearest'});
  });
  (async function init() {
    try {
      [state.shelf, state.progress, state.settings] = await Promise.all([
        ant.storage.getJSON('shelf', {}), ant.storage.getJSON('progress', {}), ant.storage.getJSON('settings', {})]);
      settings();
      document.getElementById('demo-note').hidden = !(ant.mock && new URLSearchParams(location.search).get('demo') === '1');
      await navigate();
    } catch (error) { view.innerHTML = '<div class="error-box"><h2>阅读器未能启动</h2><p>' + esc(error.message) + '</p></div>'; }
  })();
})();
