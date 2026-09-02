/*!
 * input.js —— 触屏、键盘、遥控三套输入统一成动作事件。
 *
 * 长按连发（DAS/ARR）自己实现，不用系统的按键重复，这样三种输入手感一致。
 * 触屏支持手指在十字键上滑动切换方向，以及双指同时按（一边移动一边旋转）。
 */
window.Brick = window.Brick || {};

Brick.Input = (function () {
  'use strict';

  /* 动作 → [首次触发后的延迟, 之后的间隔]，没配的动作不连发 */
  var REPEAT = { left: [165, 55], right: [165, 55], down: [60, 42] };

  var KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate',
    x: 'rotate', X: 'rotate', z: 'ccw', Z: 'ccw', ' ': 'drop', Spacebar: 'drop',
    Enter: 'pause', p: 'pause', P: 'pause', r: 'reset', R: 'reset',
    m: 'sound', M: 'sound', l: 'light', L: 'light'
  };

  function now() { return Date.now(); }

  function create(opts) {
    var onAction = opts.onAction || function () {};
    var onGesture = opts.onGesture || function () {};
    /* 电视上真键盘事件不会来，容器转发的按键由 tap() 走；两边同时开会重复触发 */
    var keyboardOk = opts.keyboardEnabled || function () { return true; };
    var holds = {};          // 动作名 → {next: 下次连发时刻}
    var pointers = {};       // pointerId → 动作名
    var keyStamp = {};       // 动作名 → 最近一次触发时刻，用于跨输入源去重
    var timer = null;
    var gestured = false;

    function firstGesture() {
      if (gestured) return;
      gestured = true;
      onGesture();
    }

    function paint(name, on) {
      var list = document.querySelectorAll('[data-hold="' + name + '"]');
      for (var i = 0; i < list.length; i++) list[i].classList.toggle('pressed', on);
    }

    function fire(name, phase) {
      onAction(name, phase);
    }

    function tick() {
      var t = now(), name, h, cfg, any = false;
      for (name in holds) {
        if (!Object.prototype.hasOwnProperty.call(holds, name)) continue;
        any = true;
        h = holds[name];
        cfg = REPEAT[name];
        if (!cfg) continue;
        if (t - h.next > 400) h.next = t;        // 后台回来别一次性补一堆
        while (t >= h.next) {
          fire(name, 'repeat');
          h.next += cfg[1];
        }
      }
      if (!any) stop();
    }

    function ensure() { if (!timer) timer = setInterval(tick, 16); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    function press(name) {
      if (holds[name]) return;
      var cfg = REPEAT[name];
      holds[name] = { next: now() + (cfg ? cfg[0] : 1e9) };
      paint(name, true);
      fire(name, 'down');
      if (cfg) ensure();
    }

    function release(name) {
      if (!holds[name]) return;
      delete holds[name];
      paint(name, false);
      for (var k in holds) { if (Object.prototype.hasOwnProperty.call(holds, k)) return; }
      stop();
    }

    /** 遥控那种只有按下没有松开的输入，闪一下就当按过。 */
    function tap(name) {
      if (holds[name]) return;
      keyStamp[name] = now();       // 让紧随其后的 DOM keydown 认得出这是同一次按键
      fire(name, 'down');
      paint(name, true);
      setTimeout(function () { if (!holds[name]) paint(name, false); }, 90);
    }

    function releaseAll() {
      for (var k in holds) {
        if (Object.prototype.hasOwnProperty.call(holds, k)) paint(k, false);
      }
      holds = {};
      stop();
    }

    /* ── 触屏：手指落在哪个按钮上就按哪个，滑动可以换 ──── */

    function nameAt(x, y) {
      var el = document.elementFromPoint(x, y);
      var btn = el && el.closest ? el.closest('[data-hold]') : null;
      return btn ? btn.getAttribute('data-hold') : '';
    }

    document.addEventListener('pointerdown', function (e) {
      firstGesture();
      var name = nameAt(e.clientX, e.clientY);
      if (!name) return;
      e.preventDefault();
      pointers[e.pointerId] = name;
      press(name);
    }, { passive: false });

    document.addEventListener('pointermove', function (e) {
      var cur = pointers[e.pointerId];
      if (cur === undefined) return;             // 这根手指不是从按钮上出发的
      var name = nameAt(e.clientX, e.clientY);
      if (name === cur) return;
      if (cur) release(cur);
      pointers[e.pointerId] = name;
      if (name) press(name);
    });

    function lift(e) {
      var cur = pointers[e.pointerId];
      if (cur === undefined) return;
      delete pointers[e.pointerId];
      if (cur) release(cur);
    }
    document.addEventListener('pointerup', lift);
    document.addEventListener('pointercancel', lift);

    /* ── 键盘 ──────────────────────────────────────────── */

    document.addEventListener('keydown', function (e) {
      firstGesture();
      var name = KEYMAP[e.key];
      if (!name || !keyboardOk()) return;
      e.preventDefault();
      if (e.repeat) return;                      // 系统连发不要，用自己的
      if (now() - (keyStamp[name] || 0) < 80) return;   // 容器刚转发过同一个键
      press(name);
    }, { passive: false });

    document.addEventListener('keyup', function (e) {
      var name = KEYMAP[e.key];
      if (name && keyboardOk()) release(name);
    });

    window.addEventListener('blur', releaseAll);

    return {
      press: press, release: release, tap: tap, releaseAll: releaseAll,
      isHeld: function (name) { return !!holds[name]; }
    };
  }

  return { create: create };
})();

