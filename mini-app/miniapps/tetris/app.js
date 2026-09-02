/*!
 * app.js —— 把外壳、液晶、音效、输入和宿主能力接起来。
 *
 * 整机是固定的 360×700 设计稿，这里只负责算一个缩放倍率把它塞进屏幕；
 * 存档（最高分 / 音效档位 / 背光）走 ant.storage，切后台自动暂停并静音。
 */
(function () {
  'use strict';

  var DESIGN_W = 360, DESIGN_H = 700;

  var THEMES = {
    off: {
      bg: '#97a878', ink: '#1e2716',
      ghost: 'rgba(30,39,22,.085)', faint: 'rgba(30,39,22,.14)', dim: 'rgba(30,39,22,.3)'
    },
    lit: {
      bg: '#c2e155', ink: '#1b2a0c',
      ghost: 'rgba(27,42,12,.09)', faint: 'rgba(27,42,12,.15)', dim: 'rgba(27,42,12,.32)'
    }
  };

  var HINTS = {
    touch: '十字键移动 · 上键旋转 · 速降键落底',
    keyboard: '←→ 移动 · ↑ 旋转 · ↓ 加速 · 空格速降',
    tv: '遥控方向键操作 · OK 键暂停'
  };

  function $(id) { return document.getElementById(id); }

  var stage = document.querySelector('.stage');
  var machine = $('machine');
  var hintEl = $('hint');
  var startEl = $('btn-start');
  var soundEl = $('btn-sound');
  var lightEl = $('btn-light');

  var lcd = Brick.LCD.create($('lcd'));
  var game = Brick.Tetris.create();
  var audio = Brick.Audio;

  var app = {
    hi: 0,              // 存档里的最高分
    sound: 2,           // 0 静音 / 1 只音效 / 2 音乐+音效
    lit: false,         // 背光
    paused: false,
    beat: false,        // 本局是否已经超过存档里的最高分
    isTV: false,
    t: 0,               // 累计毫秒，待机波浪和闪烁都用它
    blink: true,
    dirty: true
  };

  /* ══ 布局：把 360×700 的整机等比塞进可用区域 ═══════════ */

  function fit() {
    var cs = window.getComputedStyle(stage);
    var w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    /* 极端情况下（隐藏容器里初始化）量不到尺寸，退回 1:1，别让画布留在未初始化状态 */
    if (!(w > 0) || !(h > 0)) { w = DESIGN_W; h = DESIGN_H; }
    /* 留 2% 余量，免得投影被 overflow:hidden 切掉 */
    var scale = Math.min(w / DESIGN_W, h / DESIGN_H) * 0.98;
    scale = Math.max(0.35, Math.min(scale, 3));
    machine.style.setProperty('--fit', scale.toFixed(4));
    lcd.resize(scale);
    app.dirty = true;
  }

  /* ══ 每帧交给液晶层的快照 ══════════════════════════════ */

  function dialogFor() {
    var lines = [];
    if (app.paused) {
      lines.push({ t: '暂 停', size: 17, han: true, spacing: 2 });
      lines.push({ t: 'PAUSE', size: 8, spacing: 2.6, dim: true });
      if (app.isTV) lines.push({ t: '方向键选择 · OK 确认', size: 8, han: true, dim: true });
      return lines;
    }
    if (game.state === 'idle') {
      lines.push({ t: '俄罗斯方块', size: 15, han: true, spacing: 1.5 });
      lines.push({ t: 'TETRIS', size: 8, spacing: 3, dim: true });
      lines.push({ t: '按 START 开始', size: 9, han: true, hidden: !app.blink });
      return lines;
    }
    if (game.state === 'over') {
      lines.push({ t: 'GAME OVER', size: 13, spacing: 1 });
      if (app.beat) lines.push({ t: '新 纪 录 !', size: 11, han: true, spacing: 1 });
      lines.push({ t: '得分 ' + game.score, size: 10, han: true });
      lines.push({ t: '按 RESET 重来', size: 9, han: true, hidden: !app.blink });
      return lines;
    }
    return lines;
  }

  function view() {
    return {
      board: game.board,
      cells: game.cells(),
      flashRows: game.flashRows,
      flashOn: game.flashOn,
      nextShape: game.shapeOf(game.next),
      score: game.score,
      hi: Math.max(app.hi, game.score),
      level: game.level,
      lines: game.lines,
      sound: app.sound,
      paused: app.paused,
      record: app.beat,
      attract: game.state === 'idle',
      t: app.t,
      dialog: dialogFor()
    };
  }

  /* ══ 主循环 ════════════════════════════════════════════ */

  var lastTs = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = lastTs ? Math.min(ts - lastTs, 200) : 16;
    lastTs = ts;
    app.t += dt;

    var b = Math.floor(app.t / 470) % 2 === 0;
    if (b !== app.blink) { app.blink = b; app.dirty = true; }

    audio.pump();                       // setTimeout 被节流时靠这里补排音符
    if (!app.paused) game.tick(dt);

    if (!app.beat && game.score > app.hi && game.score > 0) {
      app.beat = true;                  // 本局已破纪录，面板上点亮小星星
      app.dirty = true;
    }

    var moving = !app.paused && (game.state === 'playing' || game.state === 'clearing' ||
      game.state === 'dying' || game.state === 'idle');
    if (moving || app.dirty) {
      lcd.draw(view());
      app.dirty = false;
    }
  }

  /* ══ 宿主能力的薄封装：失败一律吞掉，不能影响游戏 ══════ */

  function toast(message) {
    try { ant.ui.toast(message).catch(function () {}); } catch (e) {}
  }

  function ask(title, content) {
    try {
      return ant.ui.confirm({ title: title, content: content, confirmText: '确定', cancelText: '取消' })
        .catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function save(key, value) {
    try { ant.storage.set(key, value).catch(function () {}); } catch (e) {}
  }

  /* ══ 按键状态回写到外壳上 ══════════════════════════════ */

  function syncStart() {
    var running = game.state === 'playing' || game.state === 'clearing' || game.state === 'dying';
    var label = app.paused ? '继续' : running ? '暂停' : game.state === 'over' ? '重来' : '开始';
    startEl.firstChild.nodeValue = label;
  }

  function syncSound() {
    soundEl.classList.toggle('off', app.sound === 0);
  }

  /* ══ 游戏动作 ══════════════════════════════════════════ */

  function newGame() {
    game.start();
    app.paused = false;
    app.beat = false;
    audio.play('start');
    audio.music.setLevel(1);
    if (app.sound >= 2) audio.music.start();
    syncStart();
    app.dirty = true;
  }

  function setPaused(value, silent) {
    if (app.paused === value) return;
    app.paused = value;
    if (value) {
      audio.music.stop();
      if (!silent) audio.play('pause');
      if (app.isTV) focus(startEl);
    } else {
      if (!silent) audio.play('resume');
      if (app.sound >= 2 && game.state === 'playing') audio.music.start();
    }
    syncStart();
    app.dirty = true;
  }

  function pressStart() {
    audio.unlock();
    if (game.state === 'idle' || game.state === 'over') { newGame(); return; }
    setPaused(!app.paused);
  }

  function pressReset() {
    audio.unlock();
    audio.play('ui');
    if (game.state === 'idle' || game.state === 'over' || game.score === 0) { newGame(); return; }
    var wasPaused = app.paused;
    setPaused(true, true);
    ask('重新开始', '当前这局会作废，确定重来？').then(function (ok) {
      if (ok) newGame();
      else if (!wasPaused) setPaused(false, true);
    });
  }

  function cycleSound() {
    audio.unlock();
    app.sound = (app.sound + 2) % 3;              // 2 → 1 → 0 → 2
    audio.setMode(app.sound);
    if (app.sound >= 2 && game.state === 'playing' && !app.paused) audio.music.start();
    else if (app.sound < 2) audio.music.stop();
    audio.play('ui');
    save('sound', app.sound);
    syncSound();
    toast(['静音', '仅音效', '音乐 + 音效'][app.sound]);
    app.dirty = true;
  }

  function applyLight(value) {
    app.lit = value;
    document.body.classList.toggle('lit', value);
    lcd.setTheme(value ? THEMES.lit : THEMES.off);
    lightEl.classList.toggle('active', value);
    app.dirty = true;
  }

  function toggleLight() {
    audio.unlock();
    applyLight(!app.lit);
    audio.play('ui');
    save('lit', app.lit ? 1 : 0);
  }

  function pressExit() {
    audio.play('ui');
    var wasPaused = app.paused;
    setPaused(true, true);
    ask('关机', '确定退出俄罗斯方块？').then(function (ok) {
      if (!ok) { if (!wasPaused) setPaused(false, true); return; }
      audio.music.stop();
      try { ant.exitMiniApp().catch(function () {}); } catch (e) {}
    });
  }

  /* ══ 输入分发 ══════════════════════════════════════════ */

  function onInput(name, phase) {
    app.dirty = true;
    if (name === 'pause') { if (phase === 'down') pressStart(); return; }
    if (name === 'reset') { if (phase === 'down') pressReset(); return; }
    if (name === 'sound') { if (phase === 'down') cycleSound(); return; }
    if (name === 'light') { if (phase === 'down') toggleLight(); return; }
    if (app.paused) return;

    /* 待机或结束时，按旋转/速降也当开始，跟老机器一样随手一按就来 */
    if (game.state === 'idle' || game.state === 'over') {
      if (phase === 'down' && (name === 'rotate' || name === 'drop')) pressStart();
      return;
    }

    switch (name) {
      case 'left': game.moveLeft(); break;
      case 'right': game.moveRight(); break;
      case 'down': game.softDrop(); break;
      case 'rotate': game.rotate(1); break;
      case 'ccw': game.rotate(-1); break;
      case 'drop': if (phase === 'down') game.hardDrop(); break;
    }
  }

  var input = Brick.Input.create({
    onAction: onInput,
    onGesture: function () { audio.unlock(); },     // 首个手势里唤醒 AudioContext
    keyboardEnabled: function () { return !app.isTV; }
  });

  /* ══ 游戏事件 → 音效 / 存档 ════════════════════════════ */

  game.onEvent = function (type, data) {
    app.dirty = true;
    switch (type) {
      case 'move': audio.play('move'); break;
      case 'rotate': audio.play('rotate'); break;
      case 'soft': audio.play('soft'); break;
      case 'hard': audio.play('hard'); break;
      case 'lock': audio.play('lock'); break;
      case 'blocked': audio.play('blocked'); break;
      case 'clear': audio.play('clear' + Math.min(4, data.count)); break;
      case 'levelup':
        audio.play('levelup');
        audio.music.setLevel(data.level);
        break;
      case 'dying':
        audio.music.stop();
        audio.play('over');
        break;
      case 'over': finish(); break;
    }
  };

  function finish() {
    if (app.beat) {
      app.hi = game.score;
      save('hi', app.hi);
      toast('新纪录 ' + app.hi + ' 分！');
    }
    syncStart();
    if (app.isTV) focus(startEl);
    app.dirty = true;
  }

  /* ══ TV 焦点：WebView 不参与系统焦点，自己管一套 ════════ */

  function focusables() {
    return Array.prototype.slice.call(document.querySelectorAll('.key, .power'));
  }

  function focus(el) {
    var list = focusables();
    for (var i = 0; i < list.length; i++) list[i].classList.remove('tv-focus');
    if (!el) return;
    el.classList.add('tv-focus');
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
  }

  function navigate(key) {
    var list = focusables();
    if (!list.length) return;
    var cur = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].classList.contains('tv-focus')) cur = i;
    if (key === 'Enter') {
      if (cur < 0) focus(list[0]); else list[cur].click();
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowDown') cur = (cur + 1) % list.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') cur = cur <= 0 ? list.length - 1 : cur - 1;
    else return;
    focus(list[cur]);
    audio.play('ui');
  }

  /* ══ 宿主生命周期 ══════════════════════════════════════ */

  function onHide() {
    if (game.state === 'playing' && !app.paused) setPaused(true, true);
    audio.music.stop();
    audio.suspend();
    input.releaseAll();
  }

  function onShow() { audio.resume(); }

  function bindHost() {
    try {
      ant.onHide(onHide);
      ant.onShow(onShow);
    } catch (e) {}

    /* 容器没发生命周期事件时的兜底 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHide(); else onShow();
    });

    try {
      ant.tv.onKey(function (e) {
        var key = e && e.key;
        if (!key || !app.isTV) return;      // 非电视上有真键盘事件，别重复处理
        audio.unlock();
        if (app.paused || game.state === 'idle' || game.state === 'over') {
          navigate(key);
          return;
        }
        if (key === 'ArrowLeft') input.tap('left');
        else if (key === 'ArrowRight') input.tap('right');
        else if (key === 'ArrowUp') input.tap('rotate');
        else if (key === 'ArrowDown') input.tap('down');
        else if (key === 'Enter') input.tap('pause');
      });
    } catch (e) {}
  }

  /* ══ 外壳按键 ══════════════════════════════════════════ */

  function bindShell() {
    startEl.addEventListener('click', pressStart);
    soundEl.addEventListener('click', cycleSound);
    lightEl.addEventListener('click', toggleLight);
    $('btn-reset').addEventListener('click', pressReset);
    $('btn-exit').addEventListener('click', pressExit);

    /* 功能键的按下反馈（十字键和圆键由 input.js 负责） */
    var list = document.querySelectorAll('.key, .power');
    for (var i = 0; i < list.length; i++) {
      (function (el) {
        var off = function () { el.classList.remove('pressed'); };
        el.addEventListener('pointerdown', function () { el.classList.add('pressed'); });
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        el.addEventListener('pointerleave', off);
      })(list[i]);
    }
  }

  /* ══ 启动 ══════════════════════════════════════════════ */

  function readStorage(key) {
    try { return ant.storage.get(key).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }

  function readEnv() {
    try { return ant.env.getSystemInfo().catch(function () { return {}; }); }
    catch (e) { return Promise.resolve({}); }
  }

  function applyEnv(info) {
    app.isTV = !!info.isTV;
    if (app.isTV) document.body.classList.add('tv');
    var keyboard = info.platform === 'macos' || info.platform === 'windows' ||
      info.platform === 'browser' || info.platform === 'linux';
    hintEl.textContent = app.isTV ? HINTS.tv : keyboard ? HINTS.keyboard : HINTS.touch;
  }

  function boot() {
    applyLight(false);
    syncStart();
    syncSound();
    bindShell();
    bindHost();
    fit();

    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 150); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
    /* 首屏字体可能晚一步就位，等它落地再重画一次七段码与丝印 */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { app.dirty = true; }).catch(function () {});
    }

    Promise.all([readEnv(), readStorage('hi'), readStorage('sound'), readStorage('lit')])
      .then(function (res) {
        applyEnv(res[0] || {});
        app.hi = Math.max(0, parseInt(res[1], 10) || 0);
        var mode = parseInt(res[2], 10);
        app.sound = mode === 0 || mode === 1 || mode === 2 ? mode : 2;
        audio.setMode(app.sound);
        syncSound();
        if (String(res[3]) === '1') applyLight(true);
        if (app.isTV) focus(startEl);
        document.body.classList.add('on');       // 电源灯亮，像刚推上开关
        app.dirty = true;
      })
      .catch(function () { document.body.classList.add('on'); });

    requestAnimationFrame(frame);
  }

  boot();
})();

