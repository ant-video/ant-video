(function () {
  'use strict';

  const game = window.DuelGame;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const routes = ['local', 'online', 'ranking'];
  const expiredRoom = (error) => ['NOT_FOUND', 'ROOM_GONE'].includes(error.code);
  let service;
  let mode;
  let local;
  let botRequest;
  let room;
  let savedRoom;
  let pending = {};
  let rankSync;
  let saveQueue = Promise.resolve();
  let readPending;
  let stopWatch;
  let watchEpoch = 0;
  let startingWatch = false;
  let lobbyBusy = false;
  let refreshPublicRooms;
  let actionBusy = false;
  let rankBusy = false;
  let disconnected = false;
  let hostVisible = true;
  let hostBound = false;
  let noticeTimer;
  let dialogFocus;

  const editor = game.mount({ commit, announce: (value) => text('editor-message', value), refresh: render });

  async function read(key) {
    try {
      if (window.ant && ant.storage) return await ant.storage.getJSON(key, null);
      return JSON.parse(sessionStorage.getItem(`${game.id}:${key}`));
    } catch (error) {
      console.warn('读取游戏进度失败', error);
      return null;
    }
  }

  function write(key, value) {
    saveQueue = saveQueue.then(async () => {
      if (window.ant && ant.storage) await ant.storage.setJSON(key, value);
      else sessionStorage.setItem(`${game.id}:${key}`, JSON.stringify(value));
    }).catch((error) => console.warn('保存游戏进度失败', error));
    return saveQueue;
  }

  function cloud() {
    const api = window.ant && ant.cloud;
    if (typeof api?.identity !== 'function' || typeof api.room?.create !== 'function' || typeof api.leaderboard?.list !== 'function') {
      throw Object.assign(new Error('请在已开通联网能力的蚂蚁影视中打开'), { code: 'UNAVAILABLE' });
    }
    service ||= window.DuelCloud.connect(api, game);
    return service;
  }

  function explanation(error) {
    if (['RULE', 'UNAVAILABLE', 'ROOM_GONE'].includes(error.code)) return error.message;
    if (error.code === 'NOT_FOUND') return '房间不存在或已到期，请核对房间码';
    if (error.code === 'CLOUD_NOT_DEPLOYED') return '当前宿主的联网服务尚未开通';
    if (error.code === 'QUOTA_EXCEEDED') return '已达到宿主联网配额，请稍后再试';
    return '暂时无法连接，请稍后重试';
  }

  function notice(message) {
    text('notice', message);
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 2800);
  }

  function status(title, detail) {
    text('status-title', title);
    text('status-detail', detail);
  }

  function beginLocal() {
    botRequest = null;
    local = { id: Date.now(), startedAt: Date.now(), finishedAt: null, position: game.initial(), action: null, undo: null };
    editor.stop();
    text('editor-message', '');
    write('local-match', local);
    render();
  }

  function saveLocal(position, action) {
    const undo = game.bot && local.position.turn === 0 ? local.position : local.undo;
    local = { ...local, position, action, undo, finishedAt: position.reason ? Date.now() : null };
    write('local-match', local);
    render();
    startRobot();
  }

  function startRobot() {
    if (mode !== 'local' || !game.bot || !local || local.position.turn !== 1 || local.position.reason || botRequest) return;
    const ticket = { id: local.id, ply: local.position.ply };
    botRequest = ticket;
    game.bot(local.position).then((action) => {
      if (botRequest !== ticket || local.id !== ticket.id || local.position.ply !== ticket.ply) return;
      botRequest = null;
      if (action) saveLocal(game.apply(local.position, action), action);
    }).catch((error) => {
      if (botRequest === ticket) botRequest = null;
      console.warn('机器人走子失败', error);
      notice('机器人暂时无法走子，可以悔棋后重试');
    });
  }

  function undoLocal() {
    if (!local.undo) return;
    botRequest = null;
    local = { ...local, position: local.undo, action: null, undo: null, finishedAt: null };
    text('editor-message', '');
    write('local-match', local);
    render();
  }

  function timer() {
    const match = mode === 'online' ? room : null;
    if (!match && mode !== 'local') return;
    const countdown = match && match.phase !== 'finished';
    const duration = match ? (countdown ? match.deadline - Date.now() : 0) : (local.finishedAt || Date.now()) - local.startedAt;
    const seconds = Math.max(0, countdown ? Math.ceil(duration / 1000) : Math.floor(duration / 1000));
    $('clock').hidden = Boolean(match && !countdown);
    text('clock', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    $('clock').classList.toggle('urgent', Boolean(match?.phase === 'playing' && seconds <= 10));
    if (match?.phase === 'playing' && !seconds && !editor.animating?.()) status('本回合时间到', '等待房间同步结果。');
  }

  const finishReasons = { ...game.reasons, closed: '房间已关闭', expired: '等待好友超时', resign: '玩家认输', timeout: '玩家行动超时' };

  function describeResult(position, match) {
    const reason = match ? match.reason : position.reason;
    const winner = match ? match.winner : position.winner;
    let title;
    if (reason === 'closed' || reason === 'expired') title = finishReasons[reason];
    else if (winner === null) title = ['resign', 'timeout'].includes(reason) ? '对局已结束' : '和局';
    else if (match) title = winner === match.side ? '你赢了' : '好友获胜';
    else if (game.bot) title = winner === 0 ? '你赢了' : '机器人获胜';
    else title = `${game.color(winner)}获胜`;
    const upload = match && pending[match.roomId] ? ' · 胜场待同步' : '';
    status(title, `${finishReasons[reason] || '对局结束'}${upload}`);
  }

  function render() {
    if (!mode || !local) return;
    const isLocal = mode === 'local';
    const match = mode === 'online' ? room : null;
    const visible = isLocal || Boolean(match);
    $('play-view').hidden = !visible;
    $('lobby-view').hidden = mode !== 'online' || Boolean(room);
    $('rank-view').hidden = mode !== 'ranking';
    if (!visible) return;
    const position = match ? match.position : local.position;
    const waiting = match?.phase === 'waiting';
    const ended = match ? match.phase === 'finished' : Boolean(position?.reason);
    const allowed = Boolean(position && !ended && !actionBusy && (match
      ? position.turn === match.side && match.deadline > Date.now() : !game.bot || position.turn === 0));
    $('workspace').hidden = !position;
    $('waiting-card').hidden = !waiting;
    $('versus').hidden = isLocal && !game.bot;
    $('local-options').hidden = !isLocal;
    $('room-options').hidden = isLocal;
    $('undo-local').hidden = !game.bot;
    $('undo-local').disabled = !local.undo;
    text('play-title', isLocal ? game.localTitle : '好友对战');
    text('play-description', isLocal ? game.localIntro : game.matchIntro);
    text('summary-heading', isLocal ? game.localTitle : '对局状态');
    if (match) {
      text('invite-code', match.code);
      text('left-player', `${match.players[0].name}${match.side === 0 ? '（你）' : ''}`);
      text('right-player', match.players[1] ? `${match.players[1].name}${match.side === 1 ? '（你）' : ''}` : '等待好友');
      text('connection', disconnected ? '正在重连' : '已连接');
      $('connection').classList.toggle('lost', disconnected);
    } else {
      text('left-player', '你'); text('right-player', '机器人');
    }
    text('left-result', game.color(0)); text('right-result', game.color(1));
    if (position) editor.show(position, { key: match?.roomId || `local:${local.id}`, side: match?.side || 0, allowed, ended,
      action: match ? match.action : local.action });
    const rolling = editor.animating?.() && Boolean(position);
    $('return-lobby').hidden = !match || !ended || rolling;
    $('close-room').hidden = !match || ended || rolling;
    $('close-room').disabled = actionBusy;
    $('new-local').disabled = Boolean(rolling);
    if (rolling) status('球在滚动', '球停稳后结算本杆。');
    else if (ended) describeResult(position, match);
    else if (waiting) status('尚未开局', '好友加入后自动开局。');
    else if (actionBusy) status('正在同步', '等待棋室确认。');
    else if (position) {
      const title = isLocal && game.bot && position.turn === 1 ? '机器人思考中' : game.turnLabel(position);
      status(title, disconnected && match ? '正在重新连接。' : game.detail(position));
    }
    timer();
  }

  function flushWins() {
    if (rankSync) return rankSync;
    if (!Object.keys(pending).length || document.hidden || !hostVisible) return Promise.resolve();
    rankSync = Promise.resolve().then(async () => {
      for (const [id, until] of Object.entries(pending)) {
        await cloud().recordWin(id, until);
        delete pending[id];
        await write('pending-wins', { ...pending });
      }
    }).catch((error) => console.warn('好友胜场将在重连后同步', error)).finally(() => {
      rankSync = null;
      render();
    });
    return rankSync;
  }

  function accept(snapshot) {
    const previous = room?.roomId === snapshot.roomId ? room : null;
    if (previous && (previous.version > snapshot.version || previous.seq > snapshot.seq)) return;
    room = snapshot;
    disconnected = false;
    if (!previous) {
      savedRoom = snapshot.roomId;
      write('active-room', savedRoom);
    }
    if (snapshot.phase === 'finished') {
      stopWatching();
      if (!$('confirm').hidden) closeDialog();
      if (snapshot.winner === snapshot.side && previous?.phase !== 'finished' && !pending[snapshot.roomId]) {
        pending[snapshot.roomId] = snapshot.until;
        write('pending-wins', { ...pending });
        flushWins();
      }
    } else {
      watch(snapshot);
    }
    render();
    if (mode === 'online' && document.body.classList.contains('tv-input') && (!previous || previous.phase === 'waiting')) {
      if (snapshot.phase === 'waiting') $('copy-code').focus();
      else if (snapshot.phase === 'playing') {
        const target = $('workspace').querySelector('[tabindex="0"], button:not([tabindex])');
        target?.focus();
      }
    }
  }

  function stopWatching() {
    watchEpoch++;
    startingWatch = false;
    if (stopWatch) stopWatch().catch((error) => console.warn('停止房间订阅失败', error));
    stopWatch = null;
  }

  async function watch(snapshot) {
    if (stopWatch || startingWatch) return;
    const epoch = watchEpoch;
    startingWatch = true;
    try {
      const cancel = await cloud().subscribe(snapshot.roomId, (event) => {
        if (epoch !== watchEpoch || room?.roomId !== snapshot.roomId) return;
        if (event.type === 'snapshot' && event.room.version > room.version) sync();
        if (event.type === 'error' && (expiredRoom(event) || event.code === 'CLOUD_FORBIDDEN')) {
          stopWatching();
          sync();
        }
      }, snapshot.seq);
      if (epoch === watchEpoch) stopWatch = cancel;
      else await cancel();
    } catch (error) {
      console.warn('实时通知暂不可用，继续读取棋局', error);
    } finally {
      if (epoch === watchEpoch) startingWatch = false;
    }
  }

  function clearRoom() {
    stopWatching();
    room = null;
    savedRoom = null;
    write('active-room', null);
    render();
  }

  function sync() {
    if (!room || room.phase === 'finished' || document.hidden || !hostVisible) return Promise.resolve();
    if (readPending) return readPending;
    const id = room.roomId;
    readPending = Promise.resolve().then(() => cloud().get(id)).then((snapshot) => {
      if (room?.roomId === id) accept(snapshot);
    }).catch((error) => {
      if (room?.roomId !== id) return;
      if (expiredRoom(error)) { clearRoom(); notice(explanation(error)); }
      else { disconnected = true; render(); }
    }).finally(() => { readPending = null; });
    return readPending;
  }

  async function updateRoom(action) {
    if (!room || actionBusy) return;
    const id = room.roomId;
    actionBusy = true;
    text('editor-message', '');
    render();
    try {
      const snapshot = await action(id);
      if (room?.roomId === id) accept(snapshot);
    } catch (error) {
      if (!error.code || error.code === 'RULE') text('editor-message', error.message);
      else notice(explanation(error));
      await sync();
    } finally {
      actionBusy = false;
      render();
    }
  }

  function commit(action) {
    text('editor-message', '');
    if (mode === 'online') {
      if (room?.phase !== 'playing' || actionBusy || room.position.turn !== room.side || room.deadline <= Date.now()) return;
      const ply = room.position.ply;
      updateRoom((id) => cloud().play(id, ply, action));
      return;
    }
    if (mode !== 'local' || local.position.reason || (game.bot && local.position.turn !== 0)) return;
    try {
      saveLocal(game.apply(local.position, action), action);
    } catch (error) {
      text('editor-message', error.message);
    }
  }

  function lobbyMessage(message) {
    text('lobby-message', message);
    $('lobby-message').hidden = !message;
  }

  async function lobby(action) {
    if (lobbyBusy) return;
    lobbyBusy = true;
    const buttons = [...$('lobby-view').querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    lobbyMessage('正在连接…');
    try {
      await action();
      lobbyMessage('');
    } catch (error) {
      lobbyMessage(explanation(error));
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      lobbyBusy = false;
    }
  }

  function openLobby() {
    if (room) { sync(); return; }
    lobby(async () => {
      if (savedRoom) {
        try { accept(await cloud().get(savedRoom)); return; }
        catch (error) { if (!expiredRoom(error)) throw error; clearRoom(); }
      }
      const player = await cloud().profile();
      if (document.activeElement !== $('nickname')) $('nickname').value = player.name;
    });
  }

  async function loadRanking() {
    if (rankBusy) return;
    rankBusy = true;
    $('reload-rank').disabled = true;
    $('rank-message').hidden = false;
    text('rank-message', '正在读取榜单…');
    try {
      await flushWins();
      const { entries, self } = await cloud().leaderboard();
      $('rank-self').hidden = false;
      text('rank-self', `${self.name}　${self.rank ? `第 ${self.rank} 名` : '尚未上榜'}　胜场 ${self.wins}`);
      $('rank-rows').textContent = '';
      entries.forEach((entry) => {
        const row = document.createElement('tr');
        row.classList.toggle('self', self.playerId === entry.playerId);
        [entry.rank, entry.name, entry.wins].forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        });
        $('rank-rows').append(row);
      });
      $('rank-table').hidden = !entries.length;
      $('rank-message').hidden = Boolean(entries.length);
      text('rank-message', '暂无胜场。和好友赢下一局即可上榜。');
    } catch (error) {
      text('rank-message', explanation(error));
    } finally {
      rankBusy = false;
      $('reload-rank').disabled = false;
    }
  }

  function route() {
    const target = location.hash.slice(1);
    const destination = routes.includes(target) ? target : 'local';
    if (destination === mode) return;
    editor.stop();
    text('editor-message', '');
    mode = destination;
    document.querySelectorAll('[data-view]').forEach((link) => {
      if (link.dataset.view === mode) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    render();
    if (mode === 'local') startRobot();
    if (mode === 'online') { openLobby(); refreshPublicRooms(); }
    if (mode === 'ranking') loadRanking();
  }

  async function copyCode() {
    if (!room) return;
    const code = room.code;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(code); notice('已复制房间码'); return; }
      catch (error) { console.debug('尝试页面内复制', error); }
    }
    const field = document.createElement('textarea');
    field.value = code;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field);
    try {
      field.select();
      notice(document.execCommand('copy') ? '已复制房间码' : `房间码 ${code}`);
    } catch (error) {
      notice(`房间码 ${code}`);
    } finally {
      field.remove();
    }
  }

  function closeDialog() {
    $('confirm').hidden = true;
    if (dialogFocus?.getClientRects().length) dialogFocus.focus();
  }

  function navigationTargets() {
    const scope = $('confirm').hidden ? document : $('confirm');
    return [...scope.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]:not(:disabled)')]
      .filter((item) => item.tabIndex >= 0 && item.getClientRects().length);
  }

  function remoteKey(key) {
    document.body.classList.add('tv-input');
    const active = document.activeElement;
    if (!$('confirm').hidden && key === 'Escape') { closeDialog(); return; }
    if ($('confirm').hidden && editor.handleKey(key)) return;
    if (key === 'Enter') {
      if (active.tagName === 'SELECT' && active.showPicker) {
        try { active.showPicker(); } catch (error) { active.click(); }
      } else if (active !== document.body) active.click();
      return;
    }
    const offsets = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!offsets[key]) return;
    if (active.type === 'range' && ['ArrowLeft', 'ArrowRight'].includes(key)) {
      if (offsets[key][0] > 0) active.stepUp(5);
      else active.stepDown(5);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const candidates = navigationTargets();
    if (!candidates.includes(active)) { candidates[0]?.focus(); return; }
    const [dx, dy] = offsets[key];
    const rect = active.getBoundingClientRect();
    const midX = rect.x + rect.width / 2;
    const midY = rect.y + rect.height / 2;
    let next;
    let best = Infinity;
    candidates.forEach((item) => {
      if (item === active) return;
      const box = item.getBoundingClientRect();
      const x = box.x + box.width / 2 - midX;
      const y = box.y + box.height / 2 - midY;
      const forward = x * dx + y * dy;
      if (forward <= 4) return;
      const score = forward + Math.abs(y * dx - x * dy) * 2.5;
      if (score < best) { best = score; next = item; }
    });
    next?.focus();
  }

  function checkOnline() { sync(); flushWins(); }

  function bindHost() {
    if (hostBound || !window.ant) return;
    hostBound = true;
    if (ant.on) {
      ant.on('app.show', () => { hostVisible = true; checkOnline(); });
      ant.on('app.hide', () => { hostVisible = false; });
    }
    if (ant.tv) ant.tv.onKey(({ key }) => remoteKey(key));
  }

  async function init() {
    bindHost();
    document.addEventListener('click', bindHost, true);
    window.addEventListener('flutterInAppWebViewPlatformReady', bindHost);
    window.addEventListener('online', checkOnline);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkOnline(); });
    document.addEventListener('keydown', (event) => {
      if (!$('confirm').hidden) {
        if (event.key === 'Escape') closeDialog();
        if (event.key === 'Tab') {
          const candidates = navigationTargets();
          const edge = event.shiftKey ? candidates[0] : candidates[candidates.length - 1];
          if (document.activeElement === edge) {
            event.preventDefault();
            candidates[event.shiftKey ? candidates.length - 1 : 0]?.focus();
          }
        }
      } else if (editor.handleKey(event.key)) event.preventDefault();
    });
    text('lobby-description', game.matchIntro);
    text('local-tab', game.localTitle);
    $('copy-code').addEventListener('click', copyCode);
    $('new-local').addEventListener('click', beginLocal);
    $('undo-local').addEventListener('click', undoLocal);
    refreshPublicRooms = window.PublicRooms.mount({
      list: () => cloud().list(),
      join: (id) => lobby(async () => accept(await cloud().join(id))).then(() => refreshPublicRooms()),
      visible: () => mode === 'online' && !room,
    });
    $('create-room').addEventListener('click', () => lobby(async () => accept(await cloud().create())));
    $('join-form').addEventListener('submit', (event) => {
      event.preventDefault();
      lobby(async () => accept(await cloud().join($('join-code').value)));
    });
    $('profile-form').addEventListener('submit', (event) => {
      event.preventDefault();
      lobby(async () => {
        const player = await cloud().profile($('nickname').value);
        $('nickname').value = player.name;
        notice('昵称已保存');
      });
    });
    $('close-room').addEventListener('click', () => {
      dialogFocus = document.activeElement;
      $('confirm').hidden = false;
      $('cancel-close').focus();
    });
    $('cancel-close').addEventListener('click', closeDialog);
    $('confirm-close').addEventListener('click', () => { closeDialog(); updateRoom((id) => cloud().close(id)); });
    $('return-lobby').addEventListener('click', () => {
      const id = room.roomId;
      clearRoom();
      cloud().leave(id).catch((error) => console.warn('退出房间失败', error));
      openLobby();
      refreshPublicRooms();
    });
    $('reload-rank').addEventListener('click', loadRanking);

    const [storedLocal, storedRoom, storedWins] = await Promise.all([
      read('local-match'), read('active-room'), read('pending-wins'),
    ]);
    savedRoom = typeof storedRoom === 'string' ? storedRoom : null;
    pending = storedWins || {};
    if (game.valid(storedLocal?.position) && Number.isFinite(storedLocal.startedAt)) local = storedLocal;
    else beginLocal();
    route();
    window.addEventListener('hashchange', route);
    setInterval(timer, 250);
    setInterval(checkOnline, 3500);
    setInterval(refreshPublicRooms, 5000);
  }

  init().catch((error) => {
    console.error('游戏启动失败', error);
    notice('游戏加载失败，请重新打开');
  });
})();
