(function () {
  'use strict';

  const { size, center, sideAt, makeBoard, outcome, chooseMove } = window.Gomoku;
  const $ = (id) => document.getElementById(id);
  const columns = 'ABCDEFGHIJKLMNO';
  const modes = ['practice', 'online', 'ranking'];
  const levels = { easy: '入门', normal: '进阶', hard: '大师' };
  const rankTiers = [[1700, '大师'], [1450, '铂金'], [1250, '黄金'], [1100, '白银'], [100, '青铜']];
  const tier = (rating) => (rankTiers.find(([minimum]) => rating >= minimum) || rankTiers[4])[1];
  const winRate = (player) => player.games ? `${Math.round(player.wins / player.games * 100)}%` : '—';
  const color = (side) => side === 1 ? '黑' : '白';
  const coordinate = (cell) => `${columns[cell % size]}${Math.floor(cell / size) + 1}`;
  const updateText = (id, value) => {
    if ($(id).textContent !== value) $(id).textContent = value;
  };

  const boardElement = $('board');
  const cells = [];
  let focusedCell = center;
  let currentMode;
  let practice = { moves: [], difficulty: 'normal', side: 1 };
  let settings = { music: true, effects: true };
  let preferencesChanged = false;
  let soundChanged = false;
  let robotToken = 0;
  let robotTimer;
  let robot;
  let robotUnavailable = false;
  let profile;
  let game;
  let clockEnd = 0;
  let disconnected = false;
  let lobbyBusy = false;
  let refreshPublicRooms;
  let gameBusy = false;
  let rankBusy = false;
  let onlineService;
  let pendingRank = {};
  let rankSync;
  let watchEpoch = 0;
  let stopWatch;
  let watchStarting = false;
  let refreshPromise;
  let resumeId;
  let modalAction;
  let modalFocus;
  let noticeTimer;
  let saveQueue = Promise.resolve();
  let interacted = false;
  let hostVisible = true;
  let listeningForHost = false;
  let soundContext;

  const storage = {
    async read(key) {
      try {
        if (window.ant && ant.storage) return await ant.storage.getJSON(key, null);
        return JSON.parse(localStorage.getItem(`ant-gomoku:${key}`));
      } catch (error) {
        console.warn('读取五子棋设置失败', error);
        return null;
      }
    },
    write(key, value) {
      saveQueue = saveQueue.then(async () => {
        if (window.ant && ant.storage) return ant.storage.setJSON(key, value);
        localStorage.setItem(`ant-gomoku:${key}`, JSON.stringify(value));
      }).catch((error) => console.warn('保存五子棋设置失败', error));
      return saveQueue;
    },
  };

  function notice(message) {
    updateText('notice', message);
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 2800);
  }

  function refreshAudio() {
    const audio = $('music');
    audio.volume = 0.46;
    $('music-enabled').checked = settings.music;
    $('effects-enabled').checked = settings.effects;
    $('audio-open').classList.toggle('muted', !settings.music && !settings.effects);
    if (settings.music && interacted && hostVisible && !document.hidden) {
      audio.play().catch((error) => {
        if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') console.warn('背景音乐无法播放', error);
      });
    } else {
      audio.pause();
    }
  }

  function startSound() {
    if (interacted) return;
    interacted = true;
    refreshAudio();
    if (settings.effects) getSoundContext();
  }

  function getSoundContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!soundContext) soundContext = new AudioContext();
    if (soundContext.state === 'suspended') {
      soundContext.resume().catch((error) => console.warn('无法启用音效', error));
    }
    return soundContext;
  }

  function playEffect(finished = false) {
    if (!interacted || !settings.effects || !hostVisible || document.hidden) return;
    const context = getSoundContext();
    if (!context) return;
    const notes = finished ? [392, 523.25, 659.25] : [540, 203];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * (finished ? .095 : .008);
      const duration = finished ? .33 : .078;
      const key = context.createOscillator();
      const gain = context.createGain();
      key.type = finished ? 'sine' : 'triangle';
      key.frequency.setValueAtTime(frequency, start);
      if (!finished) key.frequency.exponentialRampToValueAtTime(frequency * .57, start + duration);
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(finished ? .094 : .13, start + .005);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      key.connect(gain).connect(context.destination);
      key.start(start);
      key.stop(start + duration);
    });
  }

  function setSound(key, enabled) {
    settings[key] = enabled;
    soundChanged = true;
    storage.write('sound', { ...settings });
    refreshAudio();
    if (key === 'effects' && enabled) playEffect();
  }

  function openModal(title, audio, message, label, action) {
    modalFocus = document.activeElement;
    modalAction = action;
    updateText('modal-title', title);
    updateText('confirmation-copy', message || '');
    updateText('confirm-yes', label || '确定');
    $('audio-settings').hidden = !audio;
    $('confirmation').hidden = audio;
    $('modal').hidden = false;
    $(audio ? 'music-enabled' : 'confirm-no').focus();
  }

  function closeModal() {
    $('modal').hidden = true;
    modalAction = null;
    if (modalFocus && !modalFocus.closest('[hidden]')) modalFocus.focus();
  }

  function initBoard() {
    document.querySelectorAll('.board-coordinates').forEach((line) => {
      const labels = line.classList.contains('cols') ? [...columns] : [...Array(size)].map((_, index) => index + 1);
      labels.forEach((label) => {
        const node = document.createElement('span');
        node.textContent = label;
        line.append(node);
      });
    });
    const fragment = document.createDocumentFragment();
    const stars = new Set([48, 56, center, 168, 176]);
    for (let index = 0; index < size * size; index++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = stars.has(index) ? 'cell star' : 'cell';
      cell.dataset.cell = index;
      cell.tabIndex = index === center ? 0 : -1;
      const stone = document.createElement('span');
      stone.className = 'piece';
      stone.setAttribute('aria-hidden', 'true');
      cell.append(stone);
      fragment.append(cell);
      cells.push(cell);
    }
    boardElement.append(fragment);
    boardElement.addEventListener('click', (event) => {
      const cell = event.target.closest('.cell');
      if (!cell) return;
      selectCell(Number(cell.dataset.cell), false);
      placeAt(focusedCell);
    });
    boardElement.addEventListener('keydown', (event) => {
      if (moveFocus(event.key)) event.preventDefault();
    });
  }

  function selectCell(cell, focus) {
    cells[focusedCell].tabIndex = -1;
    focusedCell = cell;
    cells[cell].tabIndex = 0;
    if (focus) cells[cell].focus({ preventScroll: true });
  }

  function moveFocus(key) {
    const offsets = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!offsets[key]) return false;
    const [dx, dy] = offsets[key];
    const x = focusedCell % size + dx;
    const y = Math.floor(focusedCell / size) + dy;
    if (x < 0 || x >= size || y < 0 || y >= size) return false;
    selectCell(y * size + x, true);
    return true;
  }

  function renderBoard(state, canMove) {
    const squares = makeBoard(state.moves);
    const last = state.moves[state.moves.length - 1];
    const winning = new Set(state.line);
    boardElement.dataset.turn = canMove ? sideAt(state.moves.length) : '';
    boardElement.classList.toggle('playable', canMove);
    cells.forEach((cell, index) => {
      const stone = squares[index];
      cell.classList.toggle('occupied', Boolean(stone));
      cell.classList.toggle('last', index === last);
      cell.classList.toggle('winning', winning.has(index));
      cell.firstChild.className = `piece ${stone === 1 ? 'black' : stone === 2 ? 'white' : ''}`;
      cell.setAttribute('aria-label', `${coordinate(index)}，${stone ? `${color(stone)}棋` : '空位'}`);
      cell.setAttribute('aria-disabled', String(Boolean(stone) || !canMove));
    });
    updateText('move-count', `第 ${state.moves.length} 手`);
    updateText('last-move', last === undefined ? '落子位置 —' : `上一手 ${coordinate(last)}`);
    if (!CSS.supports('aspect-ratio', '1')) boardElement.style.height = `${boardElement.clientWidth}px`;
  }

  function showStatus(title, detail) {
    updateText('status-title', title);
    updateText('status-detail', detail);
  }

  function renderSeat(side, name, detail, active) {
    updateText(`name-${side}`, name);
    updateText(`detail-${side}`, detail);
    $(`seat-${side}`).classList.toggle('active', active);
    $(`turn-${side}`).hidden = !active;
  }

  function renderPractice() {
    const result = outcome(practice.moves);
    const turn = sideAt(practice.moves.length);
    const playing = result.winner === null;
    const yourTurn = turn === practice.side;
    const robotName = `${levels[practice.difficulty]}棋手`;
    renderBoard({ ...result, moves: practice.moves }, playing && yourTurn);
    for (const side of [1, 2]) {
      const name = side === practice.side ? '你' : robotName;
      const description = side === 1 ? '执黑 · 先手' : '执白 · 后手';
      renderSeat(side, name, description, playing && turn === side);
    }
    if (!playing) {
      showStatus(result.winner === 0 ? '平局' : result.winner === practice.side ? '你赢了' : '棋手获胜',
        result.winner === 0 ? '棋盘已满，可以重新开局' : `执${color(result.winner)}连成五子`);
    } else if (yourTurn) {
      showStatus('轮到你了', '选择棋盘上的交叉点落子');
    } else {
      showStatus('棋手思考中', `请等待${robotName}落子`);
    }
    $('undo').disabled = practice.moves.length <= (practice.side === 2 ? 1 : 0);
    document.querySelectorAll('[data-difficulty]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === practice.difficulty));
    });
    document.querySelectorAll('[data-side]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.side) === practice.side));
    });
  }

  function renderClock() {
    if (currentMode !== 'online' || !game || game.phase !== 'playing') return;
    const seconds = Math.max(0, Math.ceil((clockEnd - performance.now()) / 1000));
    updateText('clock', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    $('clock').classList.toggle('urgent', seconds <= 15);
    if (!seconds && boardElement.classList.contains('playable')) {
      renderBoard(game, false);
      showStatus('正在确认超时结果', '等待棋室同步');
    }
  }

  function renderGame() {
    const online = currentMode === 'online';
    updateText('play-title', online ? '联网对战' : '人机对弈');
    updateText('play-description', online ? '好友约战 · 每步限时 90 秒' : '15 路棋盘，率先连成五子获胜。');
    $('rules-chip').hidden = online;
    $('online-panel').hidden = !online;
    $('practice-panel').hidden = online;
    document.querySelector('.players-panel').classList.toggle('online', online);
    $('share').hidden = !online || game.phase !== 'waiting';
    $('clock').hidden = !online || game.phase !== 'playing';
    if (!online) { renderPractice(); return; }

    const playing = game.phase === 'playing';
    const turn = sideAt(game.moves.length);
    const canMove = playing && turn === game.side && !gameBusy && clockEnd > performance.now();
    renderBoard(game, canMove);
    for (const side of [1, 2]) {
      const seat = side === 1 ? game.black : game.white;
      const player = seat && profile?.playerId === seat.playerId ? profile : seat;
      const name = player ? `${player.name}${side === game.side ? '（你）' : ''}` : '等待好友';
      const detail = player ? `执${color(side)} · ${tier(player.rating)} ${player.rating}` : '可从公开大厅加入';
      renderSeat(side, name, detail, playing && turn === side);
    }
    if (game.phase === 'waiting') {
      showStatus('等待好友加入', `房间码 ${game.code}`);
    } else if (playing) {
      if (clockEnd <= performance.now()) showStatus('正在确认超时结果', '等待棋室同步');
      else if (gameBusy) showStatus('正在提交', '等待棋室同步');
      else showStatus(turn === game.side ? '轮到你了' : '等待对手落子', disconnected ? '连接中断，正在重连' : `执${color(turn)}落子`);
    } else {
      const titles = { closed: '房间已关闭', expired: '房间已过期' };
      const reasons = { five: '连成五子', draw: '棋盘已满', resign: '玩家认输', timeout: '落子超时', closed: '你可以重新创建房间', expired: '等待时间结束，请重新创建房间' };
      const title = titles[game.reason] || (game.winner === 0 ? '平局' : game.winner === game.side ? '你赢了' : '对手获胜');
      const score = game.delta ? ` · 积分 +${game.delta}${pendingRank[game.roomId] ? '（待同步）' : ''}` : '';
      const detail = `${reasons[game.reason]}${score}`;
      showStatus(title, detail);
    }
    $('connection').classList.toggle('disconnected', disconnected);
    $('connection').lastElementChild.textContent = disconnected ? '正在重连' : '已连接';
    $('leave-room').hidden = game.phase === 'finished';
    $('leave-room').disabled = gameBusy;
    updateText('leave-room', playing ? '认输' : '关闭房间');
    $('return-lobby').hidden = game.phase !== 'finished';
    renderClock();
  }

  function renderLobbyProfile() {
    if (!profile) return;
    const input = $('nickname');
    if (document.activeElement !== input) input.value = profile.name;
    updateText('lobby-rating', `${tier(profile.rating)} · ${profile.rating} 积分`);
  }

  function render() {
    const onBoard = currentMode === 'practice' || (currentMode === 'online' && game);
    $('play-view').hidden = !onBoard;
    $('lobby-view').hidden = currentMode !== 'online' || Boolean(game);
    $('ranking-view').hidden = currentMode !== 'ranking';
    if (onBoard) renderGame();
    if (!$('lobby-view').hidden) renderLobbyProfile();
  }

  function savePractice() {
    preferencesChanged = true;
    storage.write('practice', { ...practice, moves: [...practice.moves] });
  }

  function cancelRobot() {
    robotToken++;
    clearTimeout(robotTimer);
  }

  function playPractice(cell) {
    practice.moves.push(cell);
    const result = outcome(practice.moves);
    if (currentMode === 'practice') playEffect(result.winner !== null);
    savePractice();
    render();
    scheduleRobot();
  }

  function robotResponse(token, cell) {
    if (token !== robotToken || !Number.isInteger(cell) || cell < 0 || cell >= size * size || practice.moves.includes(cell)) return;
    playPractice(cell);
  }

  function scheduleRobot() {
    cancelRobot();
    if (sideAt(practice.moves.length) === practice.side || outcome(practice.moves).winner !== null) return;
    const token = robotToken;
    const moves = [...practice.moves];
    const difficulty = practice.difficulty;
    robotTimer = setTimeout(() => {
      if (!robot && !robotUnavailable) {
        try {
          robot = new Worker('./robot.js');
          robot.onmessage = (event) => robotResponse(event.data.token, event.data.cell);
          robot.onerror = (error) => {
            console.warn('棋手工作线程启动失败', error.message);
            robot.terminate();
            robot = null;
            robotUnavailable = true;
            scheduleRobot();
          };
        } catch (error) {
          console.warn('当前环境无法创建棋手工作线程', error);
          robotUnavailable = true;
        }
      }
      if (robot) robot.postMessage({ moves, difficulty, token });
      else robotResponse(token, chooseMove(moves, difficulty));
    }, difficulty === 'easy' ? 260 : 345);
  }

  function restartPractice(difficulty = practice.difficulty, side = practice.side) {
    const restart = () => {
      practice = { moves: [], difficulty, side };
      selectCell(center, false);
      savePractice();
      render();
      scheduleRobot();
    };
    if (practice.moves.length > (practice.side === 2 ? 1 : 0) && outcome(practice.moves).winner === null) {
      openModal('重新开局', false, '当前人机棋局会结束，确定开始新的一局吗？', '重新开局', restart);
    } else restart();
  }

  function undoPractice() {
    const previous = practice.moves.length - 1;
    if ($('undo').disabled) return;
    const undoCount = sideAt(previous) === practice.side ? 1 : 2;
    practice.moves.splice(practice.moves.length - undoCount);
    savePractice();
    render();
    scheduleRobot();
  }

  function online() {
    const cloud = window.ant && ant.cloud;
    if (typeof cloud?.identity !== 'function' || typeof cloud.room?.create !== 'function' ||
        typeof cloud.leaderboard?.list !== 'function') {
      const error = new Error('请在支持联网能力的蚂蚁影视中打开');
      error.code = 'NO_CLOUD';
      throw error;
    }
    onlineService ||= window.GomokuOnline.connect(cloud);
    return onlineService;
  }

  function describeError(error) {
    if (['NO_CLOUD', 'GAME_RULE', 'RULE', 'ROOM_UNAVAILABLE', 'BUSINESS_ERROR'].includes(error.code)) return error.message;
    if (error.code === 'CLOUD_NOT_DEPLOYED') return '当前宿主的联网服务尚未开通';
    if (error.code === 'NOT_FOUND') return '房间不存在或已到期，请核对房间码';
    if (error.code === 'QUOTA_EXCEEDED') return '已达到宿主的房间配额，请待旧房间到期后重试';
    if (error.code === 'CONFLICT') return '棋局有新进展，请稍后重试';
    if (error.code === 'PERMISSION_DENIED') return '请使用完整的小程序安装版本';
    return '暂时无法连接棋室，请重试';
  }

  function unavailableRoom(error) {
    return error.code === 'NOT_FOUND' || error.code === 'ROOM_UNAVAILABLE';
  }

  function lobbyMessage(message, retry) {
    updateText('lobby-message', message);
    $('lobby-feedback').hidden = !message;
    $('retry-lobby').hidden = !retry;
  }

  function flushRank() {
    if (rankSync) return rankSync;
    if (!Object.keys(pendingRank).length || document.hidden || !hostVisible) return Promise.resolve();
    rankSync = Promise.resolve().then(async () => {
      for (const [roomId, result] of Object.entries(pendingRank)) {
        const updated = await online().settle(result);
        if (updated) profile = updated;
        delete pendingRank[roomId];
        await storage.write('pending-rank', { ...pendingRank });
      }
    }).catch((error) => {
      console.warn('休闲积分将在联网后重试', error);
    }).finally(() => {
      rankSync = null;
      render();
    });
    return rankSync;
  }

  function acceptGame(snapshot, audibly = false) {
    const previous = game && game.roomId === snapshot.roomId ? game : null;
    if (previous && (snapshot.revision < previous.revision || snapshot.seq < previous.seq)) return;
    game = snapshot;
    const seat = game.side === 1 ? game.black : game.white;
    if (profile?.playerId !== seat.playerId) profile = seat;
    disconnected = false;
    const deadline = performance.now() + snapshot.remainingMs;
    clockEnd = previous && previous.revision === snapshot.revision ? Math.min(clockEnd, deadline) : deadline;
    if (!previous) {
      storage.write('room', snapshot.roomId);
      selectCell(center, false);
    }
    if (audibly && previous && currentMode === 'online' && (previous.moves.length < snapshot.moves.length ||
        (previous.phase !== 'finished' && snapshot.phase === 'finished'))) playEffect(game.phase === 'finished');
    if (game.phase === 'finished') {
      stopWatching();
      if (game.delta && previous?.phase !== 'finished' && !pendingRank[game.roomId]) {
        pendingRank[game.roomId] = window.GomokuOnline.settlement(game);
        storage.write('pending-rank', { ...pendingRank });
        flushRank();
      }
    } else {
      watchGame(snapshot.roomId);
    }
    render();
  }

  function stopWatching() {
    watchEpoch++;
    watchStarting = false;
    if (stopWatch) {
      stopWatch().catch((error) => console.warn('停止房间订阅失败', error));
      stopWatch = null;
    }
  }

  function syncGame() {
    if (!game || game.phase === 'finished' || document.hidden || !hostVisible) return Promise.resolve();
    if (refreshPromise) return refreshPromise;
    const roomId = game.roomId;
    refreshPromise = Promise.resolve().then(() => online().get(roomId)).then((snapshot) => {
      if (game && game.roomId === roomId) acceptGame(snapshot, true);
    }).catch((error) => {
      if (!game || game.roomId !== roomId) return;
      disconnected = true;
      render();
      if (unavailableRoom(error)) {
        clearRoom();
        lobbyMessage(describeError(error), false);
      }
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function watchGame(roomId) {
    if (!game || game.phase === 'finished' || stopWatch || watchStarting) return;
    const epoch = watchEpoch;
    watchStarting = true;
    try {
      const cancel = await online().subscribe(roomId, (event) => {
        if (epoch !== watchEpoch || !game || game.roomId !== roomId) return;
        if (event.type === 'snapshot' && event.room.version > game.revision) syncGame();
        if (event.type === 'error' && ['CLOUD_FORBIDDEN', 'NOT_FOUND'].includes(event.code)) {
          stopWatching();
          syncGame();
        }
      }, game.seq);
      if (epoch === watchEpoch) stopWatch = cancel;
      else await cancel();
    } catch (error) {
      console.warn('房间通知暂时不可用', error);
    } finally {
      if (epoch === watchEpoch) watchStarting = false;
    }
  }

  function clearRoom() {
    stopWatching();
    game = null;
    disconnected = false;
    resumeId = null;
    storage.write('room', null);
    render();
  }

  async function lobbyAction(work, showLoading = false) {
    if (lobbyBusy) return;
    lobbyBusy = true;
    const buttons = $('lobby-view').querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    lobbyMessage(showLoading ? '正在连接棋室…' : '', false);
    try {
      await work();
      lobbyMessage('', false);
    } catch (error) {
      lobbyMessage(describeError(error), !['GAME_RULE', 'RULE', 'NOT_FOUND'].includes(error.code));
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      lobbyBusy = false;
      render();
    }
  }

  function loadLobby() {
    if (game || lobbyBusy) { render(); return; }
    lobbyAction(async () => {
      let snapshot = null;
      if (resumeId) {
        try {
          snapshot = await online().get(resumeId);
        } catch (error) {
          if (!unavailableRoom(error)) throw error;
          resumeId = null;
          storage.write('room', null);
        }
      }
      if (snapshot) {
        acceptGame(snapshot);
      } else {
        profile = await online().profile();
      }
    }, !profile);
  }

  function enterRoom(getRoom) {
    lobbyAction(async () => {
      acceptGame(await getRoom());
    }).then(() => refreshPublicRooms());
  }

  async function gameAction(change) {
    if (!game || gameBusy) return;
    const roomId = game.roomId;
    gameBusy = true;
    render();
    try {
      const snapshot = await change(roomId);
      if (game && game.roomId === roomId) acceptGame(snapshot, true);
    } catch (error) {
      notice(describeError(error));
      if (game && game.roomId === roomId) await syncGame();
    } finally {
      gameBusy = false;
      render();
    }
  }

  function placeAt(cell) {
    if (currentMode === 'practice') {
      if (!practice.moves.includes(cell) && sideAt(practice.moves.length) === practice.side && outcome(practice.moves).winner === null) playPractice(cell);
      return;
    }
    if (!game || game.phase !== 'playing' || game.moves.includes(cell) || sideAt(game.moves.length) !== game.side || performance.now() >= clockEnd) return;
    const ply = game.moves.length;
    gameAction((roomId) => online().move(roomId, cell, ply));
  }

  async function shareRoom() {
    if (!game) return;
    const code = game.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(code);
        notice('已复制房间码');
        return;
      } catch (error) {
        console.debug('系统剪贴板暂不可用，尝试页面复制', error);
      }
    }
    const field = document.createElement('textarea');
    field.value = code;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    field.readOnly = true;
    document.body.append(field);
    try {
      field.select();
      const copied = document.execCommand('copy');
      notice(copied ? '已复制房间码' : `房间码 ${code}，可手动分享`);
    } catch (error) {
      notice(`房间码 ${code}，可手动分享`);
    } finally {
      field.remove();
    }
  }

  function renderRanking({ entries, self }) {
    updateText('self-tier', tier(self.rating));
    updateText('self-rating', String(self.rating));
    updateText('self-position', self.rank ? `#${self.rank}` : '未上榜');
    updateText('self-rate', winRate(self));
    $('self-ranking').hidden = false;
    $('ranking-rows').textContent = '';
    entries.forEach((player) => {
      const row = document.createElement('tr');
      row.classList.toggle('current', player.playerId === self.playerId);
      const rank = tier(player.rating);
      [player.rank, player.name, rank, player.rating, player.games, winRate(player)].forEach((value, index) => {
        const field = document.createElement('td');
        field.textContent = value;
        if (index === 0) field.className = 'place';
        if (index === 2) { field.className = 'rank-tier'; field.dataset.level = rank; }
        if (index >= 4) field.className = 'table-optional';
        row.append(field);
      });
      $('ranking-rows').append(row);
    });
    $('ranking-table').hidden = !entries.length;
    $('ranking-message').hidden = Boolean(entries.length);
    updateText('ranking-message', '暂无上榜棋手，完成一局好友对弈即可上榜。');
  }

  async function loadRanking() {
    if (rankBusy) return;
    rankBusy = true;
    $('reload-ranking').disabled = true;
    $('ranking-message').hidden = false;
    updateText('ranking-message', '正在读取排行榜…');
    try {
      await flushRank();
      renderRanking(await online().leaderboard());
    } catch (error) {
      updateText('ranking-message', describeError(error));
    } finally {
      rankBusy = false;
      $('reload-ranking').disabled = false;
    }
  }

  function route() {
    const target = location.hash.slice(1);
    const mode = modes.includes(target) ? target : 'practice';
    if (mode === currentMode) return;
    currentMode = mode;
    document.querySelectorAll('[data-view]').forEach((link) => {
      if (link.dataset.view === mode) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    render();
    if (mode === 'online') {
      if (game) syncGame();
      else { loadLobby(); refreshPublicRooms(); }
    }
    if (mode === 'ranking') loadRanking();
  }

  function focusables(scope) {
    return [...scope.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), summary')]
      .filter((item) => item.tabIndex >= 0 && item.getClientRects().length);
  }

  function bindHost() {
    if (listeningForHost || !window.ant) return;
    listeningForHost = true;
    if (ant.on) {
      ant.on('app.show', () => { hostVisible = true; refreshAudio(); syncGame(); flushRank(); });
      ant.on('app.hide', () => { hostVisible = false; refreshAudio(); });
    }
    if (ant.tv) ant.tv.onKey(({ key }) => {
      document.body.classList.add('tv-focus');
      startSound();
      const active = document.activeElement;
      if (active.classList.contains('cell') && moveFocus(key)) return;
      if (key === 'Enter' && active && active.tagName !== 'INPUT') { active.click(); return; }
      if (key === 'Escape' && !$('modal').hidden) { closeModal(); return; }
      const items = focusables($('modal').hidden ? document : $('modal'));
      const index = items.indexOf(active);
      const direction = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
      if (key.startsWith('Arrow') && items.length) items[Math.max(0, Math.min(items.length - 1, index + direction))].focus();
    });
  }

  function validPractice(saved) {
    if (!saved || !Object.prototype.hasOwnProperty.call(levels, saved.difficulty) || ![1, 2].includes(saved.side) ||
        !Array.isArray(saved.moves) || saved.moves.length > size * size || new Set(saved.moves).size !== saved.moves.length ||
        !saved.moves.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size)) return false;
    return true;
  }

  async function init() {
    initBoard();
    bindHost();
    document.addEventListener('click', () => { bindHost(); startSound(); }, true);
    document.addEventListener('visibilitychange', () => {
      refreshAudio();
      if (!document.hidden) { syncGame(); flushRank(); }
    });
    window.addEventListener('online', () => { syncGame(); flushRank(); });
    if (!CSS.supports('aspect-ratio', '1')) window.addEventListener('resize', render);
    $('audio-open').addEventListener('click', () => openModal('声音设置', true));
    $('music-enabled').addEventListener('change', (event) => setSound('music', event.target.checked));
    $('effects-enabled').addEventListener('change', (event) => setSound('effects', event.target.checked));
    $('modal-close').addEventListener('click', closeModal);
    $('confirm-no').addEventListener('click', closeModal);
    $('confirm-yes').addEventListener('click', () => { const action = modalAction; closeModal(); if (action) action(); });
    $('modal').addEventListener('click', (event) => { if (event.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', (event) => {
      if ($('modal').hidden) return;
      if (event.key === 'Escape') closeModal();
      if (event.key !== 'Tab') return;
      const items = focusables($('modal'));
      const index = items.indexOf(document.activeElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === items.length - 1))) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    });
    $('new-game').addEventListener('click', () => restartPractice());
    $('undo').addEventListener('click', undoPractice);
    document.querySelectorAll('[data-difficulty]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.difficulty !== practice.difficulty) restartPractice(button.dataset.difficulty);
    }));
    document.querySelectorAll('[data-side]').forEach((button) => button.addEventListener('click', () => {
      const side = Number(button.dataset.side);
      if (side !== practice.side) restartPractice(practice.difficulty, side);
    }));
    const refreshRooms = window.PublicRooms.mount({
      list: () => online().list(),
      join: (id) => enterRoom(() => online().join(id)),
      visible: () => currentMode === 'online' && !game,
    });
    refreshPublicRooms = refreshRooms;
    $('share').addEventListener('click', shareRoom);
    $('create-room').addEventListener('click', () => enterRoom(() => online().create()));
    $('join-form').addEventListener('submit', (event) => {
      event.preventDefault();
      enterRoom(() => online().join($('join-code').value));
    });
    $('profile-form').addEventListener('submit', (event) => {
      event.preventDefault();
      lobbyAction(async () => {
        profile = await online().profile($('nickname').value);
        $('nickname').value = profile.name;
        notice('已保存昵称');
      });
    });
    $('retry-lobby').addEventListener('click', loadLobby);
    $('leave-room').addEventListener('click', () => {
      const waiting = game.phase === 'waiting';
      const label = waiting ? '关闭房间' : '认输';
      openModal(label, false, waiting ? '关闭后，好友将无法使用这个房间码。' : '认输将结束本局。双方已落子时会计入好友积分。', label, () => gameAction((roomId) => online().end(roomId)));
    });
    $('return-lobby').addEventListener('click', () => {
      const roomId = game?.roomId;
      clearRoom();
      refreshPublicRooms();
      if (roomId) online().leaveRoom(roomId).catch((error) => console.warn('退出棋室失败', error));
    });
    $('reload-ranking').addEventListener('click', loadRanking);
    currentMode = 'practice';
    $('play-view').hidden = false;
    document.querySelector('[data-view="practice"]').setAttribute('aria-current', 'page');
    render();
    const [saved, sound, roomId, unsettled] = await Promise.all([
      storage.read('practice'), storage.read('sound'), storage.read('room'), storage.read('pending-rank'),
    ]);
    if (!preferencesChanged && validPractice(saved)) practice = saved;
    if (!soundChanged && sound) settings = { music: sound.music !== false, effects: sound.effects !== false };
    if (typeof roomId === 'string' && /^[0-9a-f-]{36}$/i.test(roomId)) resumeId = roomId;
    if (unsettled && typeof unsettled === 'object') pendingRank = unsettled;
    refreshAudio();
    render();
    scheduleRobot();
    route();
    window.addEventListener('hashchange', route);
    setInterval(() => { syncGame(); flushRank(); }, 3500);
    setInterval(refreshPublicRooms, 5000);
    setInterval(renderClock, 240);
  }

  init().catch((error) => {
    console.error('五子棋启动失败', error);
    notice('棋盘加载失败，请重新打开小程序');
  });
})();
