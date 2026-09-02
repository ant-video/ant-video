/*!
 * audio.js —— 纯 Web Audio 合成的 8-bit 音乐与音效，不带任何音频文件。
 *
 * 音乐是《Korobeiniki》（俄罗斯民歌，也就是俄罗斯方块主题曲）的芯片音编排：
 * 方波主旋律 + 三角波贝斯 + 一点点噪声打点，等级越高节奏越快。
 *
 * WebView 里 AudioContext 必须由用户手势唤醒，所以第一次触摸/按键时调用 unlock()。
 */
window.Brick = window.Brick || {};

Brick.Audio = (function () {
  'use strict';

  var ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
  var mode = 2;            // 0 静音 / 1 只音效 / 2 音乐+音效
  var playing = false;     // 音乐是否在跑
  var timer = null;
  var tempo = 1;           // 节奏倍率，跟等级挂钩
  var BPM = 150;
  var NOTE_RE = /^([A-G])(#|b)?(-?\d)$/;
  var STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /** 音名 → 频率。C4 记为 midi 60，A4=440Hz。 */
  function hz(name) {
    var m = NOTE_RE.exec(name);
    if (!m) return 440;
    var semi = STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (semi + (parseInt(m[3], 10) + 1) * 12 - 69) / 12);
  }

  /* 主旋律：[音名, 八分音符数]，A 段 8 小节 + B 段 4 小节，共 96 个八分音符 */
  var MELODY = [
    ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
    ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
    ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
    ['C5', 2], ['A4', 2], ['A4', 2], [null, 2],
    [null, 1], ['D5', 3], ['F5', 2], ['A5', 2],
    ['G5', 1], ['F5', 1], ['E5', 3], ['C5', 1], ['E5', 2],
    ['D5', 1], ['C5', 1], ['B4', 3], ['C5', 1], ['D5', 2],
    ['E5', 2], ['C5', 2], ['A4', 2], ['A4', 2],
    ['E5', 2], ['C5', 2], ['D5', 2], ['B4', 2],
    ['C5', 2], ['A4', 2], ['G#4', 2], ['B4', 2],
    ['E5', 2], ['C5', 2], ['D5', 2], ['B4', 2],
    ['C5', 1], ['E5', 1], ['A5', 2], ['G#5', 2], [null, 2]
  ];
  /* 贝斯：跟和声走的根音，八度交替，同样是 96 个八分音符 */
  var BASS = [
    ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
    ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2],
    ['B2', 2], ['B3', 2], ['B2', 2], ['B3', 2],
    ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2],
    ['D2', 2], ['D3', 2], ['D2', 2], ['D3', 2],
    ['C2', 2], ['C3', 2], ['C2', 2], ['C3', 2],
    ['B2', 2], ['B3', 2], ['B2', 2], ['B3', 2],
    ['A2', 2], ['A3', 2], ['E2', 2], ['E3', 2],
    ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
    ['A2', 2], ['A3', 2], ['B2', 2], ['B3', 2],
    ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
    ['A2', 2], ['A3', 2], ['E2', 2], ['E3', 2]
  ];
  /* 打点：每个四分音符一下，循环长度 2 个八分音符，自然与上面对齐 */
  var HAT = [['x', 1], [null, 1]];

  function eighth() { return 30 / (BPM * tempo); }    // 60/BPM/2 秒

  /** 只能在用户手势里首次调用，否则 iOS/部分安卓 WebView 不给声音。 */
  function unlock() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      var len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      applyMode();
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return true;
  }

  function applyMode() {
    if (!ctx) return;
    musicBus.gain.value = mode >= 2 ? 0.3 : 0;
    sfxBus.gain.value = mode >= 1 ? 0.62 : 0;
  }

  /* ── 基础发声单元 ───────────────────────────────────── */

  /** 一个带 AD 包络的振荡器。dur 是整体时长，衰减占 86%，听起来才像芯片音。 */
  function tone(bus, type, freq, at, dur, gain) {
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    var hold = Math.max(0.03, dur * 0.86);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0008, at + hold);
    osc.connect(env); env.connect(bus);
    osc.start(at);
    osc.stop(at + hold + 0.02);
  }

  /** 频率滑音，用来做旋转/速降那种"咻"的感觉。 */
  function sweep(bus, type, from, to, at, dur, gain) {
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    osc.connect(env); env.connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function noise(bus, at, dur, gain, freq) {
    if (!noiseBuf) return;
    var src = ctx.createBufferSource();
    var band = ctx.createBiquadFilter();
    var env = ctx.createGain();
    src.buffer = noiseBuf;
    band.type = 'bandpass';
    band.frequency.value = freq || 2600;
    band.Q.value = 0.9;
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0006, at + dur);
    src.connect(band); band.connect(env); env.connect(bus);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  /** 依次播放一串音，做琶音式的提示音。 */
  function arp(names, step, gain, type) {
    var at = ctx.currentTime + 0.01;
    for (var i = 0; i < names.length; i++) {
      tone(sfxBus, type || 'square', hz(names[i]), at + i * step, step * 1.6, gain);
    }
  }

  /* ── 音效表 ─────────────────────────────────────────── */

  var SFX = {
    move: function (t) { tone(sfxBus, 'square', 760, t, 0.035, 0.15); },
    rotate: function (t) { sweep(sfxBus, 'square', 520, 900, t, 0.06, 0.16); },
    soft: function (t) { tone(sfxBus, 'triangle', 320, t, 0.028, 0.12); },
    hard: function (t) { sweep(sfxBus, 'square', 340, 70, t, 0.1, 0.22); noise(sfxBus, t, 0.07, 0.1, 900); },
    lock: function (t) { tone(sfxBus, 'square', 210, t, 0.055, 0.16); noise(sfxBus, t, 0.04, 0.06, 1400); },
    blocked: function (t) { tone(sfxBus, 'square', 120, t, 0.05, 0.1); },
    ui: function (t) { tone(sfxBus, 'square', 1150, t, 0.022, 0.11); },
    start: function () { arp(['E5', 'A5', 'C6', 'E6'], 0.055, 0.17); },
    pause: function () { arp(['E5', 'A4'], 0.075, 0.16); },
    resume: function () { arp(['A4', 'E5'], 0.075, 0.16); },
    clear1: function () { arp(['A4', 'C5', 'E5'], 0.05, 0.17); },
    clear2: function () { arp(['A4', 'C5', 'E5', 'A5'], 0.05, 0.18); },
    clear3: function () { arp(['A4', 'C5', 'E5', 'A5', 'C6'], 0.048, 0.18); },
    clear4: function () {
      arp(['E5', 'A5', 'C6', 'E6', 'A6'], 0.052, 0.2);
      var t = ctx.currentTime + 0.28;
      tone(sfxBus, 'square', hz('A5'), t, 0.34, 0.16);
      tone(sfxBus, 'square', hz('E6'), t, 0.34, 0.12);
      noise(sfxBus, t, 0.3, 0.05, 4200);
    },
    levelup: function () { arp(['C5', 'E5', 'G5', 'C6', 'G5', 'C6'], 0.06, 0.18); },
    over: function () {
      var names = ['E5', 'D#5', 'D5', 'C#5', 'C5', 'B4', 'A4', 'G4', 'E4'];
      var at = ctx.currentTime + 0.02;
      for (var i = 0; i < names.length; i++) {
        tone(sfxBus, 'square', hz(names[i]), at + i * 0.115, 0.19, 0.18);
        tone(sfxBus, 'triangle', hz(names[i]) / 2, at + i * 0.115, 0.19, 0.14);
      }
      noise(sfxBus, at + names.length * 0.115, 0.5, 0.07, 500);
    }
  };

  function play(name) {
    if (!ctx || mode < 1) return;
    var fn = SFX[name];
    if (!fn) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    try { fn(ctx.currentTime + 0.005); } catch (e) { /* 声音失败不该影响游戏 */ }
  }

  /* ── 音乐调度：三个声部各自按自己的时间轴向前预排 ───── */

  var voices = [
    {
      list: MELODY, i: 0, time: 0,
      emit: function (name, at, dur) { tone(musicBus, 'square', hz(name), at, dur, 0.2); }
    },
    {
      list: BASS, i: 0, time: 0,
      emit: function (name, at, dur) { tone(musicBus, 'triangle', hz(name), at, dur, 0.3); }
    },
    {
      list: HAT, i: 0, time: 0,
      emit: function (name, at) { noise(musicBus, at, 0.035, 0.04, 6400); }
    }
  ];

  function resetVoices(at) {
    for (var i = 0; i < voices.length; i++) { voices[i].i = 0; voices[i].time = at; }
  }

  /**
   * 预排未来 400ms 的音符。WebView 后台会把 setTimeout 掐到很稀，
   * 所以 rAF 循环里也会调它；落后太多就整段重新对齐，免得旋律和贝斯错位。
   */
  function pump() {
    if (!ctx || !playing || mode < 2 || ctx.state !== 'running') return;
    var now = ctx.currentTime, horizon = now + 0.4, i, v;
    for (i = 0; i < voices.length; i++) {
      if (voices[i].time < now - 0.05) { resetVoices(now + 0.04); break; }
    }
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      while (v.time < horizon) {
        var note = v.list[v.i];
        var dur = note[1] * eighth();
        if (note[0]) {
          try { v.emit(note[0], v.time, dur); } catch (e) { /* 忽略单个音符失败 */ }
        }
        v.time += dur;
        v.i = (v.i + 1) % v.list.length;
      }
    }
  }

  function musicStart() {
    if (!unlock()) return;
    playing = true;
    resetVoices(ctx.currentTime + 0.06);
    if (!timer) timer = setInterval(pump, 60);
    pump();
  }

  function musicStop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (!ctx) return;
    /* 已经排进去的音符最多还会响 400ms，这里把总线快速拉黑掉 */
    var gain = musicBus.gain, now = ctx.currentTime;
    try {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + 0.08);
    } catch (e) { gain.value = 0; }
    setTimeout(applyMode, 160);
  }

  return {
    /** 必须在首个用户手势里调用一次，返回 false 说明这台设备没有 Web Audio。 */
    unlock: unlock,
    ready: function () { return !!ctx; },
    play: play,

    getMode: function () { return mode; },
    /** 0 静音 / 1 只音效 / 2 音乐+音效 */
    setMode: function (m) {
      mode = Math.max(0, Math.min(2, m | 0));
      applyMode();
      return mode;
    },

    music: {
      start: musicStart,
      stop: musicStop,
      isPlaying: function () { return playing; },
      /** 等级越高节奏越快，最多快 36%。 */
      setLevel: function (level) { tempo = 1 + Math.min(Math.max(level, 1) - 1, 12) * 0.03; }
    },

    pump: pump,
    suspend: function () { if (ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume(); }
  };
})();

