/*!
 * tetris.js —— 纯游戏逻辑，不碰 DOM、不碰 JSAPI。
 *
 * 采用 SRS 标准：7-bag 随机、带踢墙表的旋转、锁定延迟（带次数上限防赖皮）。
 * 消行与死亡都做成分帧动画状态，让渲染层可以画出老掌机那种闪烁与填屏效果。
 */
window.Brick = window.Brick || {};

Brick.Tetris = (function () {
  'use strict';

  var COLS = 10, ROWS = 20;
  var LOCK_MS = 480;          // 落地后还能微调的时间
  var LOCK_RESET_MAX = 15;    // 无限旋转防赖皮
  var FLASH_MS = 78;          // 消行闪烁的单次时长
  var FLASH_TIMES = 5;        // 亮灭次数（奇数次结束时是灭，留一拍空白再塌行）
  var DIE_MS = 34;            // 死亡时每行填充的间隔

  /* 7 种方块的 4 个旋转态，字符串按 SRS 的标准朝向写死 */
  var SHAPES = {
    I: { box: 4, sx: 3, sy: -1, rots: ['....XXXX........', '..X...X...X...X.', '........XXXX....', '.X...X...X...X..'] },
    J: { box: 3, sx: 3, sy: 0, rots: ['X..XXX...', '.XX.X..X.', '...XXX..X', '.X..X.XX.'] },
    L: { box: 3, sx: 3, sy: 0, rots: ['..XXXX...', '.X..X..XX', '...XXXX..', 'XX..X..X.'] },
    O: { box: 2, sx: 4, sy: 0, rots: ['XXXX', 'XXXX', 'XXXX', 'XXXX'] },
    S: { box: 3, sx: 3, sy: 0, rots: ['.XXXX....', '.X..XX..X', '....XXXX.', 'X..XX..X.'] },
    T: { box: 3, sx: 3, sy: 0, rots: ['.X.XXX...', '.X..XX.X.', '...XXX.X.', '.X.XX..X.'] },
    Z: { box: 3, sx: 3, sy: 0, rots: ['XX..XX...', '..X.XX.X.', '...XX..XX', '.X.XX.X..'] }
  };
  var KINDS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  /* 把字符串矩阵预解析成坐标表，避免每帧重复扫描 */
  var CELLS = {};
  KINDS.forEach(function (kind) {
    var def = SHAPES[kind];
    CELLS[kind] = def.rots.map(function (rot) {
      var list = [];
      for (var i = 0; i < rot.length; i++) {
        if (rot.charAt(i) === 'X') list.push([i % def.box, Math.floor(i / def.box)]);
      }
      return list;
    });
  });

  /* SRS 踢墙表，已把 y 轴翻成"向下为正"的屏幕坐标 */
  var KICK_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };
  var KICK_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };

  var SCORE_TABLE = [0, 100, 300, 500, 800];

  /** 官方 Guideline 的下落曲线：每级下落一格所需毫秒。 */
  function gravityMs(level) {
    var n = Math.min(level, 20);
    return Math.max(28, Math.pow(0.8 - (n - 1) * 0.007, n - 1) * 1000);
  }

  function create() {
    var g = {
      COLS: COLS, ROWS: ROWS,
      board: new Uint8Array(COLS * ROWS),
      state: 'idle',          // idle / playing / clearing / dying / over
      piece: null,            // {kind, rot, x, y}
      next: null,
      score: 0, lines: 0, level: 1,
      flashRows: [], flashOn: false, dieRow: ROWS - 1,
      onEvent: null
    };

    var bag = [];
    var fallAcc = 0, lockMs = 0, lockResets = 0, animMs = 0, flashLeft = 0;

    function emit(type, data) {
      if (g.onEvent) g.onEvent(type, data || null);
    }

    /* ── 取块：7-bag，保证不会连续饿死某一种 ── */
    function draw() {
      if (!bag.length) {
        bag = KINDS.slice();
        for (var i = bag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
      }
      return bag.pop();
    }

    function cellsOf(kind, rot) { return CELLS[kind][((rot % 4) + 4) % 4]; }

    /** 该位置是否合法：不出界、不压已有方块。y<0 允许（刚出生时可能露在顶上）。 */
    function fits(kind, rot, px, py) {
      var list = cellsOf(kind, rot);
      for (var i = 0; i < list.length; i++) {
        var x = px + list[i][0], y = py + list[i][1];
        if (x < 0 || x >= COLS || y >= ROWS) return false;
        if (y >= 0 && g.board[y * COLS + x]) return false;
      }
      return true;
    }

    /** 当前活动块占据的格子，渲染层直接用。 */
    g.cells = function () {
      if (!g.piece) return [];
      var p = g.piece;
      return cellsOf(p.kind, p.rot).map(function (c) { return [p.x + c[0], p.y + c[1]]; });
    };

    /** 落点预测（幽灵位置的行数差），渲染层画虚影用。 */
    g.dropDistance = function () {
      if (!g.piece) return 0;
      var p = g.piece, d = 0;
      while (fits(p.kind, p.rot, p.x, p.y + d + 1)) d++;
      return d;
    };

    function spawn() {
      var kind = g.next || draw();
      g.next = draw();
      var def = SHAPES[kind];
      g.piece = { kind: kind, rot: 0, x: def.sx, y: def.sy };
      fallAcc = 0; lockMs = 0; lockResets = 0;
      if (!fits(kind, 0, def.sx, def.sy)) {     // block out：顶到天花板
        g.piece = null;
        beginDying();
        return false;
      }
      emit('spawn', { kind: kind });
      return true;
    }

    /** 落地后每次成功微调都把锁定计时清零，但总次数有上限。 */
    function touchLock() {
      if (g.piece && !fits(g.piece.kind, g.piece.rot, g.piece.x, g.piece.y + 1)) {
        if (lockResets < LOCK_RESET_MAX) { lockMs = 0; lockResets++; }
      }
    }

    function shift(dx) {
      if (g.state !== 'playing' || !g.piece) return false;
      var p = g.piece;
      if (!fits(p.kind, p.rot, p.x + dx, p.y)) return false;
      p.x += dx;
      touchLock();
      emit('move', null);
      return true;
    }

    g.moveLeft = function () { return shift(-1); };
    g.moveRight = function () { return shift(1); };

    /** dir: 1 顺时针 / -1 逆时针。按 SRS 踢墙表依次尝试 5 个偏移。 */
    g.rotate = function (dir) {
      if (g.state !== 'playing' || !g.piece) return false;
      var p = g.piece;
      if (p.kind === 'O') return false;
      var to = (((p.rot + dir) % 4) + 4) % 4;
      var table = (p.kind === 'I' ? KICK_I : KICK_JLSTZ)['' + p.rot + to] || [[0, 0]];
      for (var i = 0; i < table.length; i++) {
        var nx = p.x + table[i][0], ny = p.y + table[i][1];
        if (fits(p.kind, to, nx, ny)) {
          p.rot = to; p.x = nx; p.y = ny;
          touchLock();
          emit('rotate', null);
          return true;
        }
      }
      emit('blocked', null);
      return false;
    };

    /** 手动加速下落，落一格加 1 分；落不动就直接锁定。 */
    g.softDrop = function () {
      if (g.state !== 'playing' || !g.piece) return false;
      var p = g.piece;
      if (!fits(p.kind, p.rot, p.x, p.y + 1)) { lockPiece(); return false; }
      p.y++;
      g.score++;
      fallAcc = 0; lockMs = 0; lockResets = 0;
      emit('soft', null);
      return true;
    };

    /** 速降：一步到底并立刻锁定，每格 2 分。 */
    g.hardDrop = function () {
      if (g.state !== 'playing' || !g.piece) return 0;
      var d = g.dropDistance();
      g.piece.y += d;
      g.score += d * 2;
      emit('hard', { distance: d });
      lockPiece();
      return d;
    };

    function lockPiece() {
      var p = g.piece;
      if (!p) return;
      var list = cellsOf(p.kind, p.rot);
      var kindIndex = KINDS.indexOf(p.kind) + 1;
      var inside = 0;
      for (var i = 0; i < list.length; i++) {
        var x = p.x + list[i][0], y = p.y + list[i][1];
        if (y >= 0) { g.board[y * COLS + x] = kindIndex; inside++; }
      }
      g.piece = null;
      if (!inside) { beginDying(); return; }     // lock out：整块都在屏幕外

      var full = [];
      for (var r = 0; r < ROWS; r++) {
        var done = true;
        for (var c = 0; c < COLS; c++) { if (!g.board[r * COLS + c]) { done = false; break; } }
        if (done) full.push(r);
      }
      if (full.length) {
        g.state = 'clearing';
        g.flashRows = full;
        g.flashOn = true;
        flashLeft = FLASH_TIMES;
        animMs = 0;
        emit('clear', { rows: full, count: full.length });
      } else {
        emit('lock', null);
        spawn();
      }
    }

    /** 闪烁结束：真正把行抹掉，上面的整体下移。 */
    function collapse() {
      var rows = g.flashRows.slice().sort(function (a, b) { return a - b; });
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        for (var y = r; y > 0; y--) {
          for (var c = 0; c < COLS; c++) g.board[y * COLS + c] = g.board[(y - 1) * COLS + c];
        }
        for (var c2 = 0; c2 < COLS; c2++) g.board[c2] = 0;
      }
      var n = rows.length;
      var before = g.level;
      g.lines += n;
      g.score += SCORE_TABLE[n] * g.level;
      g.level = Math.min(99, 1 + Math.floor(g.lines / 10));
      g.flashRows = [];
      g.state = 'playing';
      emit('collapse', { count: n });
      if (g.level > before) emit('levelup', { level: g.level });
      spawn();
    }

    /** 老掌机的死亡动画：整屏从底往上一行行填满。 */
    function beginDying() {
      g.state = 'dying';
      g.piece = null;
      g.dieRow = ROWS - 1;
      animMs = 0;
      emit('dying', null);
    }

    function tickDying(dt) {
      animMs += dt;
      while (animMs >= DIE_MS && g.dieRow >= 0) {
        animMs -= DIE_MS;
        for (var c = 0; c < COLS; c++) g.board[g.dieRow * COLS + c] = 8;
        g.dieRow--;
      }
      if (g.dieRow < 0) {
        g.state = 'over';
        emit('over', { score: g.score, lines: g.lines, level: g.level });
      }
    }

    function tickPlaying(dt) {
      var p = g.piece;
      if (!p) return;
      if (!fits(p.kind, p.rot, p.x, p.y + 1)) {      // 贴地了，进锁定倒计时
        lockMs += dt;
        if (lockMs >= LOCK_MS) lockPiece();
        return;
      }
      lockMs = 0;
      var step = gravityMs(g.level);
      fallAcc += dt;
      while (fallAcc >= step) {
        fallAcc -= step;
        if (!fits(p.kind, p.rot, p.x, p.y + 1)) break;
        p.y++;
        lockResets = 0;
      }
    }

    function tickClearing(dt) {
      animMs += dt;
      while (animMs >= FLASH_MS && flashLeft > 0) {
        animMs -= FLASH_MS;
        flashLeft--;
        g.flashOn = !g.flashOn;
      }
      if (flashLeft <= 0) collapse();
    }

    /** dt 单位毫秒。切后台回来时会有巨大的 dt，夹一下免得一帧掉好几格。 */
    g.tick = function (dt) {
      if (!(dt > 0)) return;
      if (dt > 200) dt = 200;
      if (g.state === 'playing') tickPlaying(dt);
      else if (g.state === 'clearing') tickClearing(dt);
      else if (g.state === 'dying') tickDying(dt);
    };

    g.reset = function () {
      g.board.fill(0);
      g.score = 0; g.lines = 0; g.level = 1;
      g.piece = null; g.next = null;
      g.flashRows = []; g.flashOn = false; g.dieRow = ROWS - 1;
      g.state = 'idle';
      bag = []; fallAcc = 0; lockMs = 0; lockResets = 0; animMs = 0; flashLeft = 0;
    };

    g.start = function () {
      g.reset();
      g.state = 'playing';
      spawn();
    };

    /** 给渲染层画 NEXT 预览用。 */
    g.shapeOf = function (kind) {
      return kind ? { box: SHAPES[kind].box, cells: CELLS[kind][0] } : null;
    };

    return g;
  }

  return { create: create, gravityMs: gravityMs, COLS: COLS, ROWS: ROWS };
})();

