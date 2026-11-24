(function () {
  'use strict';

  const game = window.PuzzleGame;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const routes = ['practice', 'online', 'ranking'];
  const expiredRoom = (error) => ['NOT_FOUND', 'ROOM_GONE'].includes(error.code);
  let service;
  let mode;
  let practice;
  let room;
  let savedRoom;
  let savedDraft;
  let pending = {};
  let rankSync;
  let draftKey;
  let saveQueue = Promise.resolve();
  let readPending;
  let stopWatch;
  let watchEpoch = 0;
  let startingWatch = false;
  let lobbyBusy = false;
  let actionBusy = false;
  let rankBusy = false;
  let disconnected = false;
  let hostVisible = true;
  let hostBound = false;
  let noticeTimer;
  let dialogFocus;

  const editor = game.mount({ changed: saveDraft, announce: (value) => text('editor-message', value), submit });

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
    service ||= window.PuzzleCloud.connect(api, game);
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

  function keyFor(room) { return `${room.roomId}:${room.puzzles.length}`; }

  function saveDraft() {
    text('editor-message', '');
    if (mode === 'practice' && practice) {
      practice = { ...practice, draft: editor.draft() };
      write('practice', practice);
    } else if (mode === 'online' && room?.phase === 'running') {
      savedDraft = { key: keyFor(room), value: editor.draft() };
      write('match-draft', savedDraft);
    }
  }

  function newPractice(level) {
    const previous = practice ? [practice.puzzle] : [];
    practice = { puzzle: game.create(level, previous), level, startedAt: Date.now(), finishedAt: null, draft: null };
    draftKey = null;
    write('practice', practice);
    render();
  }

  function status(title, detail) {
    text('status-title', title);
    text('status-detail', detail);
  }

  function timer() {
    const online = mode === 'online' && room;
    if (!online && mode !== 'practice') return;
    const countdown = online && ['waiting', 'running'].includes(room.phase);
    let duration;
    if (!online) duration = (practice.finishedAt || Date.now()) - practice.startedAt;
    else if (countdown) duration = room.deadline - Date.now();
    else duration = (room.results[room.results.length - 1]?.seconds || 0) * 1000;
    const seconds = Math.max(0, countdown ? Math.ceil(duration / 1000) : Math.floor(duration / 1000));
    text('clock', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    $('clock').classList.toggle('urgent', Boolean(online && room.phase === 'running' && seconds <= 10));
    if (online && room.phase === 'running' && !seconds) {
      editor.lock(true);
      status('本题时间到', '等待房间同步本题结果。');
    }
  }

  function openPuzzle(key, puzzle, draft, locked) {
    if (key !== draftKey) {
      draftKey = key;
      text('editor-message', '');
      editor.open(puzzle, draft);
    }
    editor.lock(locked);
  }

  function renderMatch() {
    const round = room.puzzles.length;
    const roundEnd = room.phase === 'round-end';
    const finished = room.phase === 'finished';
    $('next-round').hidden = !roundEnd;
    $('next-round').disabled = actionBusy;
    $('return-lobby').hidden = !finished;
    $('close-room').hidden = finished;
    $('close-room').disabled = actionBusy;
    text('connection', disconnected ? '正在重连' : '已连接');
    $('connection').classList.toggle('lost', disconnected);
    text('left-player', `${room.players[0].name}${room.side === 0 ? '（你）' : ''}`);
    text('right-player', room.players[1] ? `${room.players[1].name}${room.side === 1 ? '（你）' : ''}` : '等待好友');
    if (game.rounds > 1) {
      text('left-result', `${room.scores[0]} 题`);
      text('right-result', `${room.scores[1]} 题`);
    }
    if (!round) {
      text('invite-code', room.code);
      status(finished ? (room.reason === 'expired' ? '房间已过期' : '房间已关闭') : '尚未开局', finished ? '可以返回大厅创建新房间。' : '好友加入后会收到同一道题。');
      return;
    }
    const key = keyFor(room);
    openPuzzle(key, room.puzzles[round - 1], savedDraft?.key === key ? savedDraft.value : null, room.phase !== 'running' || actionBusy || room.deadline <= Date.now());
    const last = room.results[room.results.length - 1];
    if (finished && room.reason === 'closed') {
      status('对战已结束', '你可以返回大厅再开一局。');
    } else if (roundEnd || finished) {
      const title = finished
        ? (room.winner === null ? '平局' : room.side === room.winner ? '你赢了' : '好友获胜')
        : (last.winner === null ? '本题超时' : room.side === last.winner ? '你拿下本题' : '好友拿下本题');
      const answer = game.describeAnswer(room.puzzles[round - 1], last.answer);
      const summary = finished && game.rounds > 1 ? `最终比分 ${room.scores.join(' : ')}` : last.winner === null ? '本题无人解出' : `用时 ${last.seconds} 秒`;
      const uploading = finished && pending[room.roomId] ? ' · 胜场待同步' : '';
      status(title, `${answer ? `${answer} · ` : ''}${summary}${uploading}`);
    } else {
      status(actionBusy ? '正在提交' : '开始解题', disconnected ? '连接中断，正在重连。' : '好友正在解同一道题。');
    }
  }

  function render() {
    if (!mode || !practice) return;
    const isPractice = mode === 'practice';
    const match = mode === 'online' ? room : null;
    const playing = isPractice || Boolean(match);
    $('play-view').hidden = !playing;
    $('lobby-view').hidden = mode !== 'online' || Boolean(room);
    $('rank-view').hidden = mode !== 'ranking';
    if (!playing) return;
    const round = match?.puzzles.length || 0;
    $('workspace').hidden = !isPractice && !round;
    $('waiting-card').hidden = !match || match.phase !== 'waiting';
    $('versus').hidden = isPractice;
    $('practice-options').hidden = !isPractice;
    $('room-options').hidden = isPractice;
    $('hint').disabled = Boolean(practice.finishedAt);
    text('play-title', isPractice ? '离线练习' : '好友对战');
    text('play-description', isPractice ? game.practiceIntro : game.matchIntro);
    text('summary-heading', isPractice ? '练习' : '对局状态');
    const label = isPractice ? game.levels?.[practice.level] : game.levels?.[match.level] || (round ? `第 ${round} / ${game.rounds} 题` : '');
    $('round-number').hidden = !label;
    text('round-number', label || '');
    if (isPractice) {
      openPuzzle(`practice:${practice.startedAt}`, practice.puzzle, practice.draft, Boolean(practice.finishedAt));
      status(practice.finishedAt ? '练习完成' : '练习中', practice.finishedAt ? game.success : game.tip);
    } else {
      renderMatch();
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
      if (snapshot.reason === 'match' && snapshot.winner === snapshot.side && previous?.phase !== 'finished' && !pending[snapshot.roomId]) {
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
      else if (snapshot.phase === 'running') {
        const target = $('workspace').querySelector('button[tabindex="0"], button:not([tabindex])');
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
    savedDraft = null;
    write('active-room', null);
    write('match-draft', null);
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
      notice(explanation(error));
      await sync();
    } finally {
      actionBusy = false;
      render();
    }
  }

  function submit() {
    const online = mode === 'online';
    if (online && (room?.phase !== 'running' || actionBusy || room.deadline <= Date.now())) return;
    if (!online && (mode !== 'practice' || practice.finishedAt)) return;
    const round = online ? room.puzzles.length - 1 : 0;
    const puzzle = online ? room.puzzles[round] : practice.puzzle;
    const answer = editor.answer();
    try {
      game.check(puzzle, answer);
    } catch (error) {
      text('editor-message', error.message);
      return;
    }
    if (online) {
      updateRoom((id) => cloud().submit(id, round, answer));
    } else {
      practice = { ...practice, finishedAt: Date.now(), draft: editor.draft() };
      write('practice', practice);
      render();
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
    const destination = routes.includes(target) ? target : 'practice';
    if (destination === mode) return;
    mode = destination;
    document.querySelectorAll('[data-view]').forEach((link) => {
      if (link.dataset.view === mode) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    render();
    if (mode === 'online') openLobby();
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
    return [...scope.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
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
    if (active.tagName === 'SELECT' && ['ArrowUp', 'ArrowDown'].includes(key)) {
      const next = active.selectedIndex + offsets[key][1];
      if (next >= 0 && next < active.options.length) {
        active.selectedIndex = next;
        active.dispatchEvent(new Event('change', { bubbles: true }));
      }
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

  function initLevels() {
    if (!game.levels) return;
    for (const id of ['practice-level', 'room-level']) {
      Object.entries(game.levels).forEach(([value, label]) => $(id).add(new Option(label, value)));
      $(`${id}-row`).hidden = false;
      $(id).value = id === 'practice-level' ? practice.level : 'normal';
    }
    $('practice-level').addEventListener('change', (event) => newPractice(event.target.value));
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
    $('copy-code').addEventListener('click', copyCode);
    $('new-puzzle').addEventListener('click', () => newPractice(practice.level));
    $('hint').addEventListener('click', () => editor.hint());
    $('create-room').addEventListener('click', () => lobby(async () => accept(await cloud().create($('room-level').value || 'normal'))));
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
    $('next-round').addEventListener('click', () => {
      const index = room.puzzles.length - 1;
      updateRoom((id) => cloud().next(id, index));
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
    });
    $('reload-rank').addEventListener('click', loadRanking);

    const [storedPractice, storedRoom, storedDraft, storedWins] = await Promise.all([
      read('practice'), read('active-room'), read('match-draft'), read('pending-wins'),
    ]);
    savedRoom = typeof storedRoom === 'string' ? storedRoom : null;
    savedDraft = storedDraft;
    pending = storedWins || {};
    if (game.valid(storedPractice?.puzzle) && Number.isFinite(storedPractice.startedAt)) practice = storedPractice;
    else newPractice('normal');
    initLevels();
    route();
    window.addEventListener('hashchange', route);
    setInterval(timer, 250);
    setInterval(checkOnline, 3500);
  }

  init().catch((error) => {
    console.error('游戏启动失败', error);
    notice('游戏加载失败，请重新打开');
  });
})();
