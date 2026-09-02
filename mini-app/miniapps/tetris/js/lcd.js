/*!
 * lcd.js —— 把整块液晶画在一张 canvas 上。
 *
 * 逻辑坐标固定为 268×298（就是外壳里那块玻璃的尺寸），实际像素按
 * devicePixelRatio × 整机缩放倍率放大，所以放到电视上也不会糊。
 *
 * 老掌机的两个灵魂细节都在这里：
 *   1) 没点亮的格子也会淡淡显出"回"字轮廓（灭掉的液晶片）
 *   2) 数字是七段码，没点亮的段同样淡淡可见
 */
window.Brick = window.Brick || {};

Brick.LCD = (function () {
  'use strict';

  var W = 268, H = 298;
  var CELL = 14, COLS = 10, ROWS = 20;
  var PF_X = 9, PF_Y = 9;                       // 棋盘左上角
  var PANEL_X = 159, PANEL_W = 100;
  var PANEL_R = PANEL_X + PANEL_W;              // 面板右边界，数字都右对齐到这

  /* 七段码：每个数字点亮哪几段 */
  var SEGS = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
    5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
  };

  function create(canvas) {
    var live = canvas.getContext('2d');
    /* 背景、边框、没点亮的格子、丝印标签都是不动的，缓存成一层，
       每帧只 drawImage 一次，省掉 400 多次描边填充——弱鸡电视盒子就靠这个。 */
    var cache = document.createElement('canvas');
    var cacheCtx = cache.getContext('2d');
    var ctx = live;                       // 当前绘制目标，画缓存层时临时切过去
    var theme = {
      bg: '#97a878', ink: '#1e2716',
      ghost: 'rgba(30,39,22,.085)', faint: 'rgba(30,39,22,.13)', dim: 'rgba(30,39,22,.3)'
    };
    var scale = 1, k = 1, stale = true;

    /** 整机缩放变化时重算画布分辨率，逻辑坐标始终是 268×298。 */
    function resize(machineScale) {
      scale = machineScale || 1;
      var dpr = Math.min(3, window.devicePixelRatio || 1);
      k = dpr * scale;
      canvas.width = cache.width = Math.round(W * k);
      canvas.height = cache.height = Math.round(H * k);
      live.setTransform(k, 0, 0, k, 0, 0);      // 改 width 会重置变换，得重设
      cacheCtx.setTransform(k, 0, 0, k, 0, 0);
      stale = true;
    }

    function setTheme(next) { theme = next; stale = true; }

    /* ── 砖块：外框 + 内实心，老液晶的标志性字形 ── */
    function brick(x, y, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1.75, y + 1.75, 10.5, 10.5);
      ctx.fillStyle = color;
      ctx.fillRect(x + 4.5, y + 4.5, 5, 5);
    }

    /* ── 七段码 ────────────────────────────────────────── */

    function hbar(x, y, len, t) {
      ctx.beginPath();
      ctx.moveTo(x, y + t / 2);
      ctx.lineTo(x + t / 2, y);
      ctx.lineTo(x + len - t / 2, y);
      ctx.lineTo(x + len, y + t / 2);
      ctx.lineTo(x + len - t / 2, y + t);
      ctx.lineTo(x + t / 2, y + t);
      ctx.closePath();
      ctx.fill();
    }

    function vbar(x, y, len, t) {
      ctx.beginPath();
      ctx.moveTo(x + t / 2, y);
      ctx.lineTo(x + t, y + t / 2);
      ctx.lineTo(x + t, y + len - t / 2);
      ctx.lineTo(x + t / 2, y + len);
      ctx.lineTo(x, y + len - t / 2);
      ctx.lineTo(x, y + t / 2);
      ctx.closePath();
      ctx.fill();
    }

    /** value 传 -1 表示这一位不显示（只留淡淡的段影）。 */
    function digit(x, y, w, h, value) {
      var t = Math.max(1.5, h * 0.13);
      var half = (h - t) / 2;
      var vlen = half - t * 0.9;
      var hx = x + t * 0.9, hw = w - t * 1.8;
      var on = value >= 0 ? SEGS[value] : '';
      var pos = {
        a: [hbar, hx, y, hw],
        b: [vbar, x + w - t, y + t * 0.9, vlen],
        c: [vbar, x + w - t, y + half + t * 0.9, vlen],
        d: [hbar, hx, y + h - t, hw],
        e: [vbar, x, y + half + t * 0.9, vlen],
        f: [vbar, x, y + t * 0.9, vlen],
        g: [hbar, hx, y + half, hw]
      };
      Object.keys(pos).forEach(function (key) {
        var p = pos[key];
        ctx.fillStyle = on.indexOf(key) >= 0 ? theme.ink : theme.faint;
        p[0](p[1], p[2], p[3], t);
      });
    }

    /** 右对齐画一串数字，rightX 是最后一位的右边缘。 */
    function number(value, count, rightX, y, dw, dh, gap) {
      value = Math.max(0, Math.floor(value));
      var limit = Math.pow(10, count) - 1;
      if (value > limit) value = limit;
      for (var i = 0; i < count; i++) {
        var unit = Math.pow(10, i);
        var d = Math.floor(value / unit) % 10;
        var blank = i > 0 && value < unit;      // 前导位留空，更像真液晶
        digit(rightX - (i + 1) * dw - i * gap, y, dw, dh, blank ? -1 : d);
      }
    }

    /* ── 文字 ──────────────────────────────────────────── */

    var SANS = "'Helvetica Neue', Arial, system-ui, sans-serif";
    var HAN = "-apple-system, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";

    /** 逐字绘制以便手工控制字距，效果比依赖 letterSpacing 稳。 */
    function text(str, x, y, size, opt) {
      opt = opt || {};
      var spacing = opt.spacing || 0;
      ctx.font = (opt.weight || 700) + ' ' + size + 'px ' + (opt.han ? HAN : SANS);
      ctx.textBaseline = 'top';
      ctx.fillStyle = opt.color || theme.ink;
      var chars = String(str).split(''), i, total = 0;
      for (i = 0; i < chars.length; i++) total += ctx.measureText(chars[i]).width + spacing;
      total -= spacing;
      var cx = opt.align === 'right' ? x - total : opt.align === 'center' ? x - total / 2 : x;
      for (i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], cx, y);
        cx += ctx.measureText(chars[i]).width + spacing;
      }
      return total;
    }

    /** 丝印小标签：小号、大字距、稍淡，模拟印在玻璃上的字。 */
    function tag(str, x, y) {
      return text(str, x, y, 8, { spacing: 1.3, color: theme.ink, weight: 700 });
    }

    /* ── 棋盘（只画点亮的格子，没点亮的在缓存层里） ────── */

    function board(view) {
      var b = view.board, flash = view.flashRows, on = view.flashOn;
      for (var r = 0; r < ROWS; r++) {
        var blinking = flash.length && flash.indexOf(r) >= 0;
        if (blinking && !on) continue;             // 闪到灭的那一拍，露出底层的灰格
        for (var c = 0; c < COLS; c++) {
          if (blinking || b[r * COLS + c]) brick(PF_X + c * CELL, PF_Y + r * CELL, theme.ink);
        }
      }
      for (var i = 0; i < view.cells.length; i++) {
        var cell = view.cells[i];
        if (cell[1] < 0) continue;                 // 露在顶上的部分不画
        brick(PF_X + cell[0] * CELL, PF_Y + cell[1] * CELL, theme.ink);
      }
    }

    /** 待机动画：一道斜向的波浪扫过整屏，像开机自检。 */
    function attract(t) {
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          if (Math.sin(c * 0.62 + r * 0.34 - t * 0.0042) > 0.55) {
            brick(PF_X + c * CELL, PF_Y + r * CELL, theme.ink);
          }
        }
      }
    }

    /* ── 右侧信息面板 ──────────────────────────────────── */

    var NEXT_X = 181, NEXT_Y = 157;

    function preview(shape) {
      if (!shape) return;
      var cells = shape.cells, minx = 9, maxx = -9, miny = 9, maxy = -9, i;
      for (i = 0; i < cells.length; i++) {
        minx = Math.min(minx, cells[i][0]); maxx = Math.max(maxx, cells[i][0]);
        miny = Math.min(miny, cells[i][1]); maxy = Math.max(maxy, cells[i][1]);
      }
      var ox = NEXT_X + (4 - (maxx - minx + 1)) / 2 * CELL - minx * CELL;
      var oy = NEXT_Y + (4 - (maxy - miny + 1)) / 2 * CELL - miny * CELL;
      for (i = 0; i < cells.length; i++) {
        brick(ox + cells[i][0] * CELL, oy + cells[i][1] * CELL, theme.ink);
      }
    }

    /** 喇叭图标：0 静音画叉，1 一道声波，2 两道声波。 */
    function speaker(x, y, level) {
      ctx.fillStyle = level > 0 ? theme.ink : theme.dim;
      ctx.beginPath();
      ctx.moveTo(x, y + 4); ctx.lineTo(x + 3, y + 4); ctx.lineTo(x + 7, y);
      ctx.lineTo(x + 7, y + 12); ctx.lineTo(x + 3, y + 8); ctx.lineTo(x, y + 8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = level > 0 ? theme.ink : theme.dim;
      ctx.lineWidth = 1.3;
      if (level > 0) {
        ctx.beginPath(); ctx.arc(x + 8, y + 6, 3, -0.9, 0.9); ctx.stroke();
      }
      if (level > 1) {
        ctx.beginPath(); ctx.arc(x + 8, y + 6, 6, -0.9, 0.9); ctx.stroke();
      }
      if (level === 0) {
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 2); ctx.lineTo(x + 16, y + 10);
        ctx.moveTo(x + 16, y + 2); ctx.lineTo(x + 10, y + 10);
        ctx.stroke();
      }
    }

    function panel(view) {
      number(view.score, 6, PANEL_R, 21, 10, 17, 2);
      number(view.hi, 6, PANEL_R, 56, 7, 12, 2);
      number(view.level, 2, PANEL_R, 87, 11, 16, 2);
      number(view.lines, 3, PANEL_R, 121, 11, 16, 2);
      preview(view.nextShape);

      /* 状态图标：喇叭 + 暂停 + 破纪录的星星 */
      speaker(PANEL_X, 224, view.sound);
      ctx.fillStyle = view.paused ? theme.ink : theme.dim;
      ctx.fillRect(PANEL_X + 42, 224, 3.5, 12);
      ctx.fillRect(PANEL_X + 48.5, 224, 3.5, 12);
      if (view.record) star(PANEL_R - 12, 224, 6);

      /* 距离升级还差几行：10 个小格 */
      var got = view.lines % 10;
      for (var i = 0; i < 10; i++) {
        ctx.fillStyle = i < got ? theme.ink : theme.dim;
        ctx.fillRect(PANEL_X + i * 10, 252, 6, 6);
      }
    }

    function star(cx, cy, r) {
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var ang = -Math.PI / 2 + i * Math.PI / 5;
        var rad = i % 2 ? r * 0.45 : r;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rad, cy + r + Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.fill();
    }

    /* ── 弹窗：只盖住棋盘区，右侧分数照常可见 ──────────── */

    function measure(str, size, opt) {
      var spacing = opt.spacing || 0;
      ctx.font = (opt.weight || 700) + ' ' + size + 'px ' + (opt.han ? HAN : SANS);
      var chars = String(str).split(''), total = 0;
      for (var i = 0; i < chars.length; i++) total += ctx.measureText(chars[i]).width + spacing;
      return total - spacing;
    }

    function dialog(lines) {
      var pad = 11, gap = 7, w = 0, h = 0, i, line;
      for (i = 0; i < lines.length; i++) {
        line = lines[i];
        w = Math.max(w, measure(line.t, line.size, line));
        h += line.size * 1.26 + (i ? gap : 0);
      }
      w = Math.min(Math.ceil(w) + pad * 2, CELL * COLS - 4);
      h = Math.ceil(h) + pad * 2;
      var x = Math.round(PF_X + (CELL * COLS - w) / 2);
      var y = Math.round(PF_Y + (CELL * ROWS - h) / 2);

      ctx.fillStyle = theme.bg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
      ctx.strokeStyle = theme.dim;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);

      var cy = y + pad;
      for (i = 0; i < lines.length; i++) {
        line = lines[i];
        /* hidden 的行照样占位，闪烁提示时弹窗才不会一跳一跳地变大小 */
        if (!line.hidden) {
          text(line.t, x + w / 2, cy, line.size, {
            align: 'center', han: line.han, spacing: line.spacing || 0,
            weight: line.weight, color: line.dim ? theme.dim : theme.ink
          });
        }
        cy += line.size * 1.26 + gap;
      }
    }

    /* ── 静态层：底色、边框、灭掉的格子、丝印标签 ──────── */

    function buildStatic() {
      ctx = cacheCtx;
      var r, c;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = theme.dim;
      ctx.lineWidth = 1;
      ctx.strokeRect(5.5, 5.5, 147, 287);                       // 棋盘外框
      ctx.strokeRect(NEXT_X - 1.5, NEXT_Y - 1.5, CELL * 4 + 3, CELL * 4 + 3);

      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) brick(PF_X + c * CELL, PF_Y + r * CELL, theme.ghost);
      }
      for (r = 0; r < 4; r++) {
        for (c = 0; c < 4; c++) brick(NEXT_X + c * CELL, NEXT_Y + r * CELL, theme.ghost);
      }

      tag('SCORE', PANEL_X, 9);
      tag('HI-SCORE', PANEL_X, 45);
      tag('LEVEL', PANEL_X, 76);
      tag('LINES', PANEL_X, 110);
      tag('NEXT', PANEL_X, 145);
      text('9999 IN 1', PANEL_X + PANEL_W / 2, 270, 7,
        { spacing: 1.6, color: theme.dim, align: 'center' });

      ctx = live;
      stale = false;
    }

    function draw(view) {
      if (stale) buildStatic();
      live.setTransform(1, 0, 0, 1, 0, 0);
      live.drawImage(cache, 0, 0);
      live.setTransform(k, 0, 0, k, 0, 0);
      if (view.attract) attract(view.t); else board(view);
      panel(view);
      if (view.dialog && view.dialog.length) dialog(view.dialog);
    }

    return { resize: resize, setTheme: setTheme, draw: draw };
  }

  return { create: create, W: W, H: H };
})();


