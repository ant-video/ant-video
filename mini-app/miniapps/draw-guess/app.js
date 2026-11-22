(function () {
  "use strict";

  const avatars = ["🐸", "🐱", "🐼", "🦊", "🐰", "🐙", "🐥", "🐨"];
  const avatarColors = [
    "#ddf1d5",
    "#ffe4ce",
    "#e3e8ff",
    "#ffe8d2",
    "#ffe0ec",
    "#e9dfff",
    "#fff0bd",
    "#dbeef2",
  ];
  const colors = [
    "#26334b",
    "#3259eb",
    "#ed758e",
    "#f5bf46",
    "#42a784",
    "#a17be0",
  ];
  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const context = board.getContext("2d");
  const confirmedStrokes = new Map();
  const pendingStrokes = new Map();
  let profile = { name: "", avatar: 0, sound: false };
  let myId = "";
  let game = null;
  let view = "lobby";
  let practice = false;
  let color = colors[0];
  let width = 4;
  let erasing = false;
  let activeStroke = null;
  let flushing = null;
  let canvasFrame = null;
  let roomFetch = null;
  let fetchAgain = false;
  let refreshTimer = null;
  let roomGeneration = 0;
  let unsubscribe = null;
  let lastEventSeq = 0;
  let clockOffset = 0;
  let lastOverlay = "";
  let chatSignature = "";
  let lastCorrectCount = 0;
  let toastTimer = null;
  let audio = null;
  let cloudReady = false;
  let profileRequest = null;
  let quitting = false;
  let joining = false;

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  }

  function uuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
    }, 3400);
  }

  function setConnection(online, text) {
    $("network-state").classList.toggle("online", online);
    $("network-state").innerHTML = `<i></i>${escapeHTML(text)}`;
    $("network-state").title = text;
  }

  async function call(action, options) {
    if (!window.ant || !ant.cloud || !ant.cloud.call) {
      const error = new Error("请使用支持联网云函数的新版蚂蚁影视打开此小程序");
      error.code = "HOST_UPDATE_REQUIRED";
      throw error;
    }
    try {
      const result = await ant.cloud.call("game", {
        action,
        options: options || {},
      });
      cloudReady = true;
      setConnection(true, "已联网");
      return result;
    } catch (error) {
      if (
        ["CLOUD_NETWORK_ERROR", "CLOUD_TIMEOUT", "CLOUD_ERROR"].includes(
          error.code,
        )
      ) {
        setConnection(false, "连接中断，正在重连");
      }
      throw error;
    }
  }

  async function run(button, action) {
    if (button && button.disabled) return;
    if (button) button.disabled = true;
    try {
      return await action();
    } catch (error) {
      toast(error.message || "连接失败，请稍后再试");
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  }

  function playTone(success) {
    if (!profile.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume().catch(() => {});
      [0, 0.1, 0.2].forEach((delay, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = (
          success ? [523, 659, 784] : [440, 520, 659]
        )[index];
        gain.gain.setValueAtTime(0.07, audio.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          audio.currentTime + delay + 0.2,
        );
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(audio.currentTime + delay);
        oscillator.stop(audio.currentTime + delay + 0.21);
      });
    } catch (error) {
      console.info("音效暂不可用", error.name);
    }
  }

  function celebrate() {
    playTone(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let index = 0; index < 28; index++) {
      const piece = document.createElement("span");
      piece.className = "confetti";
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty("--x", `${(Math.random() - 0.5) * 520}px`);
      piece.style.setProperty("--y", `${Math.random() * 250 - 210}px`);
      piece.style.setProperty("--rot", `${Math.random() * 800 - 400}deg`);
      $("celebration").appendChild(piece);
      setTimeout(() => piece.remove(), 1100);
    }
  }

  function avatarHTML(index, className) {
    const safeIndex = Math.max(0, Math.min(7, Number(index) || 0));
    return `<span class="avatar ${className || ""}" style="background:${avatarColors[safeIndex]}">${avatars[safeIndex]}</span>`;
  }

  function showView(next) {
    view = next;
    for (const name of ["lobby", "game", "ranking"])
      $(name + "-view").hidden = next !== name;
    $("app-footer").hidden = next === "game";
    if (next === "game") scheduleCanvas();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function updateProfileUI() {
    $("avatar-button").textContent = avatars[profile.avatar];
    $("avatar-button").style.background = avatarColors[profile.avatar];
    $("nickname").value = profile.name;
    $("sound-button").style.opacity = profile.sound ? "1" : ".45";
    $("sound-button").ariaLabel = profile.sound ? "关闭音效" : "开启音效";
  }

  async function saveLocalProfile() {
    if (window.ant && ant.storage)
      await ant.storage.setJSON("draw-guess.profile", profile);
  }

  async function ensureProfile() {
    if (profileRequest) return profileRequest;
    profileRequest = (async () => {
      const name = $("nickname").value.trim();
      if (!name) throw new Error("先给自己起个名字吧");
      profile.name = name;
      await saveLocalProfile();
      const result = await call("profile", { name, avatar: profile.avatar });
      myId = result.playerId;
      return result;
    })().finally(() => {
      profileRequest = null;
    });
    return profileRequest;
  }

  async function loadRooms() {
    if (!myId) return;
    const rooms = await call("list");
    if (!rooms.length) {
      $("rooms-list").innerHTML =
        '<div class="empty-rooms"><b>✎</b><p><strong>第一间画室，等你开门</strong><br>创建房间，把房间号分享给朋友一起玩。</p></div>';
      return;
    }
    $("rooms-list").innerHTML = rooms
      .map((room, index) => {
        const full = Number(room.count) >= room.capacity;
        const phase =
          {
            lobby: "等待画友",
            choosing: "正在选词",
            drawing: "正在画画",
            reveal: "正在揭晓",
            finished: "等待下一局",
          }[room.phase] || "进行中";
        return `<button class="room-card" data-join="${escapeHTML(room.code)}" ${full ? "disabled" : ""}>
        <span class="room-illustration">${["🎨", "🖍️", "🌈", "🪁"][index % 4]}</span>
        <span><h3>${escapeHTML(room.name)}</h3><p>${phase}　${room.count}/${room.capacity} 人</p></span><span class="room-join">${full ? "已满员" : "加入 ↗"}</span></button>`;
      })
      .join("");
  }

  async function joinRoom(code, button) {
    if (joining) return;
    joining = true;
    try {
      await run(button, async () => {
        const cleanCode = code.trim();
        if (!/^\d{6}$/.test(cleanCode))
          throw new Error("请输入 6 位数字房间号");
        await ensureProfile();
        const result = await call("join", {
          code: cleanCode,
          name: profile.name,
          avatar: profile.avatar,
        });
        await enterRoom(result);
      });
    } finally {
      joining = false;
    }
  }

  async function enterRoom(snapshot) {
    practice = false;
    quitting = false;
    const generation = ++roomGeneration;
    if (unsubscribe) {
      unsubscribe().catch(() => {});
      unsubscribe = null;
    }
    game = null;
    lastEventSeq = 0;
    lastOverlay = "";
    lastCorrectCount = 0;
    applyGame(snapshot);
    showView("game");
    await ant.storage.setJSON("draw-guess.last-room", { code: snapshot.code });
    try {
      const stop = await ant.cloud.room.subscribe(
        snapshot.roomId,
        (event) => {
          if (generation !== roomGeneration || quitting) return;
          handleRoomEvent(event);
        },
        { afterSeq: snapshot.seq },
      );
      if (generation !== roomGeneration) await stop();
      else unsubscribe = stop;
    } catch (error) {
      if (generation === roomGeneration)
        toast("实时连接暂未建立，已启用自动刷新");
    }
  }

  function handleRoomEvent(event) {
    if (!game) return;
    if (event.type === "snapshot" && event.resync) requestRefresh();
    if (event.type === "presence") requestRefresh();
    if (event.type === "error") {
      setConnection(false, "正在重新连接");
      if (event.code === "CLOUD_FORBIDDEN") reconnectRoom();
      return;
    }
    if (event.type !== "message" || event.playerId !== "server") return;
    if (event.seq) lastEventSeq = Math.max(lastEventSeq, event.seq);
    const message = event.data;
    if (!message || !message.event.startsWith("draw_guess.")) return;
    const data = message.data || {};
    if (message.event === "draw_guess.changed") {
      requestRefresh();
      return;
    }
    if (data.turnId !== game.turnId) {
      requestRefresh();
      return;
    }
    if (message.event === "draw_guess.stroke") {
      let stroke = confirmedStrokes.get(data.id);
      if (!stroke) {
        if (data.offset !== 0) return requestRefresh();
        stroke = {
          id: data.id,
          color: data.color,
          width: data.width,
          points: [],
        };
        confirmedStrokes.set(data.id, stroke);
      }
      if (data.offset === stroke.points.length)
        stroke.points.push(...data.points);
      else if (data.offset > stroke.points.length) requestRefresh();
    } else if (message.event === "draw_guess.clear") {
      confirmedStrokes.clear();
    } else if (message.event === "draw_guess.undo") {
      confirmedStrokes.delete(data.id);
    }
    scheduleCanvas();
  }

  function requestRefresh() {
    if (refreshTimer || !game || quitting) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshGame().catch(() => {});
    }, 70);
  }

  async function refreshGame() {
    if (!game || practice || quitting) return;
    if (roomFetch) {
      fetchAgain = true;
      return roomFetch;
    }
    const generation = roomGeneration;
    const roomId = game.roomId;
    roomFetch = (async () => {
      try {
        const result = await call("get", { roomId });
        if (generation === roomGeneration && !quitting) {
          if (result.seq >= lastEventSeq) applyGame(result);
          else fetchAgain = true;
        }
      } catch (error) {
        if (
          error.code === "BUSINESS_ERROR" &&
          generation === roomGeneration &&
          !quitting
        ) {
          await reconnectRoom();
        }
      }
    })().finally(() => {
      roomFetch = null;
      if (fetchAgain) {
        fetchAgain = false;
        requestRefresh();
      }
    });
    return roomFetch;
  }

  let reconnecting = null;
  function reconnectRoom() {
    if (!game || quitting) return Promise.resolve();
    if (reconnecting) return reconnecting;
    const code = game.code;
    const generation = roomGeneration;
    reconnecting = call("join", {
      code,
      name: profile.name,
      avatar: profile.avatar,
    })
      .then((result) => {
        if (generation === roomGeneration && !quitting)
          return enterRoom(result);
      })
      .catch((error) => {
        toast(error.message || "重连失败，请稍后再试");
      })
      .finally(() => {
        reconnecting = null;
      });
    return reconnecting;
  }

  function applyGame(snapshot) {
    if (game && snapshot.seq < game.seq) return;
    const oldTurn = game && game.turnId;
    const oldPhase = game && game.phase;
    const oldCorrect = lastCorrectCount;
    game = snapshot;
    clockOffset = snapshot.serverTime - Date.now();
    lastEventSeq = Math.max(lastEventSeq, snapshot.seq);
    if (oldTurn !== game.turnId) {
      activeStroke = null;
      pendingStrokes.clear();
      lastOverlay = "";
    }
    if (game.phase !== "drawing") {
      activeStroke = null;
      pendingStrokes.clear();
    }
    confirmedStrokes.clear();
    for (const stroke of snapshot.strokes || [])
      confirmedStrokes.set(stroke.id, stroke);
    lastCorrectCount = snapshot.chat.filter(
      (message) => message.kind === "correct",
    ).length;
    if (oldTurn && oldTurn === game.turnId && lastCorrectCount > oldCorrect)
      celebrate();
    if (oldPhase && oldPhase !== snapshot.phase && snapshot.phase === "drawing")
      playTone(false);
    renderGame();
  }

  function me() {
    return game && game.players.find((player) => player.id === game.me);
  }

  function canDraw() {
    return (
      practice ||
      !!(
        game &&
        game.phase === "drawing" &&
        game.drawerId === game.me &&
        remainingSeconds() > 0
      )
    );
  }

  function renderGame() {
    $("room-title").textContent = practice ? "自由练习" : game.roomName;
    $("copy-room").hidden = practice;
    $("copy-room").textContent = game ? `房间号 ${game.code} ⧉` : "";
    $("round-label").textContent = practice
      ? "画画不计分"
      : game.phase === "lobby"
        ? "等待开场"
        : `第 ${game.round} / ${game.totalRounds} 轮`;
    const players = practice
      ? [
          {
            id: "practice",
            name: profile.name || "我",
            avatar: profile.avatar,
            score: 0,
            online: true,
          },
        ]
      : game.players;
    $("player-count").textContent = practice
      ? "1 人"
      : `${players.filter((player) => player.online).length}/${game.capacity}`;
    $("players-list").innerHTML = players
      .map((player) => {
        const own = practice || player.id === game.me;
        const drawer =
          !practice &&
          player.id === game.drawerId &&
          ["choosing", "drawing"].includes(game.phase);
        let tag = practice
          ? "自由发挥中"
          : !player.online
            ? "暂时离线"
            : player.spectator
              ? "观战中，下局加入"
              : player.guessed && game.phase === "drawing"
                ? "✓ 已猜对"
                : drawer
                  ? "✎ 正在作画"
                  : ["lobby", "finished"].includes(game.phase)
                    ? player.ready
                      ? "✓ 已准备"
                      : "等待准备"
                    : "认真猜词中";
        if (!practice && player.id === game.hostId && game.phase === "lobby")
          tag = "房主，准备就绪";
        return `<div class="player ${own ? "me" : ""} ${drawer ? "drawing" : ""} ${!player.online ? "offline" : ""}">${avatarHTML(player.avatar)}<div class="player-info"><div class="player-name">${escapeHTML(player.name)}${own ? " <small>我</small>" : ""}</div><div class="player-tag ${player.ready || player.guessed ? "ready" : ""}">${tag}</div></div><div class="player-score">${player.score}<small>本局积分</small></div></div>`;
      })
      .join("");
    $("room-rules").innerHTML = practice
      ? "画笔、橡皮和撤销都可以试试。<br>邀请朋友，一起挑战猜词。"
      : `每轮 ${game.duration} 秒，每人画 ${game.cycles} 次。<br>猜中越快，得分越多。<br>每位猜中者也为画手加 25 分。`;
    if (practice) {
      $("turn-label").textContent = "你的画板";
      $("word-hint").textContent = "灵感自由发挥";
      $("canvas-message").textContent = "选一种颜色，用手指或鼠标开始画吧";
    } else {
      const drawer = game.players.find((player) => player.id === game.drawerId);
      $("turn-label").textContent =
        {
          lobby: "画室已准备好",
          reveal: "本轮答案揭晓",
          finished: "本局积分已结算",
        }[game.phase] ||
        (game.drawerId === game.me
          ? "你是本轮画手"
          : drawer
            ? `${drawer.name} 正在${game.phase === "choosing" ? "选词" : "作画"}`
            : "画室已准备好");
      $("word-hint").textContent =
        game.phase === "drawing"
          ? game.drawerId === game.me
            ? game.word
            : `${game.hint}　${"＿".repeat(Math.min(8, game.wordLength || 0))} ${game.wordLength} 个字`
          : game.phase === "choosing"
            ? game.drawerId === game.me
              ? "选一个你的拿手好词"
              : "画手正在挑选词语"
            : game.phase === "reveal"
              ? `答案是 ${game.word}`
              : game.phase === "finished"
                ? "这一局，画得漂亮！"
                : "等画友集合，一起开画";
      $("canvas-message").textContent = canDraw()
        ? "只用画面表达，别把答案写出来哦"
        : me() && me().spectator
          ? "本局正在进行，你将在下一局加入作画"
          : game.phase === "drawing"
            ? "看画面找灵感，在下方输入答案"
            : {
                lobby: "朋友准备好后，房主就可以开始",
                choosing: "灵感就位，马上开画",
                reveal: "下一轮会自动开始",
                finished: "累计积分已更新，去榜单看看你的名次",
              }[game.phase];
    }
    $("drawing-tools").hidden = !canDraw();
    board.classList.toggle("drawable", canDraw());
    const player = me();
    const guessing =
      !practice &&
      game.phase === "drawing" &&
      game.drawerId !== game.me &&
      player &&
      !player.guessed &&
      !player.spectator &&
      remainingSeconds() > 0;
    $("guess-input").disabled = !guessing;
    $("guess-form").querySelector("button").disabled = !guessing;
    $("guess-input").placeholder = practice
      ? "练习模式，邀请朋友来猜吧"
      : player && player.guessed && game.phase === "drawing"
        ? "你已经猜对了，看看大家的脑洞"
        : game.drawerId === game.me
          ? "本轮由你作画，画友们来猜"
          : guessing
            ? "输入你的答案…"
            : "开画后就可以猜词啦";
    $("chat-status").textContent =
      game && game.phase === "drawing" ? "答案只有画手知道" : "看看大家的脑洞";
    renderChat();
    renderOverlay();
    updateTimer();
    scheduleCanvas();
  }

  function renderChat() {
    const messages = practice ? [] : game.chat;
    const signature = JSON.stringify(messages);
    if (signature === chatSignature) return;
    chatSignature = signature;
    const nearBottom =
      $("chat-list").scrollHeight -
        $("chat-list").scrollTop -
        $("chat-list").clientHeight <
      60;
    $("chat-list").innerHTML = messages.length
      ? messages
          .map(
            (message) =>
              `<div class="chat-message ${message.kind === "correct" ? "correct" : ""}"><strong>${escapeHTML(message.name || "画友")}</strong><span class="bubble">${escapeHTML(message.text)}${message.points ? `<small>+${message.points}</small>` : ""}</span></div>`,
          )
          .join("")
      : '<div class="chat-tip"><span class="chat-tip-icon">〰</span>奇妙的画，<br>往往有意想不到的答案。</div>';
    if (nearBottom || messages.length < 3)
      $("chat-list").scrollTop = $("chat-list").scrollHeight;
  }

  function renderOverlay() {
    if (practice || game.phase === "drawing") {
      $("game-overlay").hidden = true;
      lastOverlay = "";
      return;
    }
    const signature = JSON.stringify([
      game.phase,
      game.turnId,
      game.choices,
      game.players.map((player) => [
        player.id,
        player.ready,
        player.online,
        player.score,
      ]),
      game.hostId,
      game.summary,
    ]);
    if (signature === lastOverlay) return;
    lastOverlay = signature;
    $("game-overlay").dataset.phase = game.phase;
    let html = "";
    if (game.phase === "lobby") {
      const own = me();
      const host = game.me === game.hostId;
      const online = game.players.filter((player) => player.online);
      const ready = online.every((player) => player.ready);
      html = `<div class="overlay-art">🎨</div><h2>画友集合，准备开画</h2><p>把房间号 <strong>${escapeHTML(game.code)}</strong> 分享给朋友。<br>至少 2 人准备后，房主就可以开始游戏。</p>${host ? `<button class="primary-button" data-game-action="start" ${online.length < 2 || !ready ? "disabled" : ""}>${online.length < 2 ? "等待朋友加入" : !ready ? "等待大家准备" : "开始画猜"}</button>` : `<button class="primary-button" data-game-action="ready" data-ready="${own && own.ready ? "false" : "true"}">${own && own.ready ? "已准备，等待开始 ✓" : "我准备好了"}</button>`}<span class="overlay-countdown">一人画，其他人猜；每个人都会轮到</span>`;
    } else if (game.phase === "choosing") {
      const own = game.drawerId === game.me;
      html = `<div class="overlay-art">${own ? "💡" : "👀"}</div><h2>${own ? "这轮你来画！" : "画手正在挑选词语"}</h2><p>${own ? "选一个有画面感的词，其他人只会看到分类和字数。" : "准备好你的想象力，马上开画。"}</p>${own ? `<div class="choice-list">${game.choices.map((choice, index) => `<button class="word-choice" data-choice="${index}"><strong>${escapeHTML(choice.word)}</strong><small>${escapeHTML(choice.category)}</small></button>`).join("")}</div>` : ""}<span class="overlay-countdown">选词时间结束后会自动开始</span>`;
    } else if (game.phase === "reveal") {
      html = `<div class="overlay-art">${game.summary.includes("都猜对") ? "🎉" : "✨"}</div><h2>${escapeHTML(game.summary)}</h2><p class="reveal-word">${escapeHTML(game.word || "这一轮结束")}</p><p>稍等片刻，下一位画手马上登场。</p>`;
    } else if (game.phase === "finished") {
      const sorted = game.players
        .filter((player) => !player.spectator)
        .slice()
        .sort((a, b) => b.score - a.score);
      html = `<div class="overlay-art">🏆</div><h2>${escapeHTML(game.summary)}</h2><div class="match-scores">${sorted
        .slice(0, 4)
        .map(
          (player) =>
            `<div class="match-score">${avatarHTML(player.avatar)}<p>${escapeHTML(player.name)}</p><b>${player.score}</b></div>`,
        )
        .join(
          "",
        )}</div>${game.hostId === game.me ? '<button class="primary-button" data-game-action="start">再来一局</button>' : `<button class="secondary-button" data-game-action="ready" data-ready="true">准备下一局 ✓</button>`}<button class="text-button" data-ranking>查看全网积分榜 ↗</button>`;
    }
    $("game-overlay").innerHTML = html;
    $("game-overlay").hidden = false;
  }

  function remainingSeconds() {
    if (!game || !game.deadline) return 0;
    return Math.max(
      0,
      Math.ceil((game.deadline - (Date.now() + clockOffset)) / 1000),
    );
  }

  function updateTimer() {
    const remaining = remainingSeconds();
    $("timer-number").textContent = practice
      ? "∞"
      : game && game.deadline
        ? String(remaining).padStart(2, "0")
        : "—";
    $("timer-unit").textContent = practice
      ? "尽情画"
      : game && game.phase === "choosing"
        ? "选词"
        : game && game.phase === "reveal"
          ? "换手"
          : "秒";
    $("timer").classList.toggle(
      "urgent",
      !practice && game && game.phase === "drawing" && remaining <= 10,
    );
    if (game && game.phase === "drawing" && remaining === 0) {
      board.classList.remove("drawable");
      $("guess-input").disabled = true;
    }
  }

  function scheduleCanvas() {
    if (canvasFrame) return;
    canvasFrame = requestAnimationFrame(() => {
      canvasFrame = null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, board.width, board.height);
      const strokes = new Map(confirmedStrokes);
      for (const [id, stroke] of pendingStrokes) strokes.set(id, stroke);
      for (const stroke of strokes.values()) drawStroke(stroke);
      $("board-watermark").hidden =
        strokes.size > 0 || (!practice && game && game.phase !== "drawing");
    });
  }

  function drawStroke(stroke) {
    if (!stroke.points || !stroke.points.length) return;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    const [firstX, firstY] = stroke.points[0];
    if (stroke.points.length === 1) {
      context.arc(firstX, firstY, stroke.width / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.moveTo(firstX, firstY);
    for (let index = 1; index < stroke.points.length; index++)
      context.lineTo(...stroke.points[index]);
    context.stroke();
  }

  function pointFrom(event) {
    const bounds = board.getBoundingClientRect();
    return [
      Math.round(
        Math.max(
          0,
          Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000),
        ),
      ),
      Math.round(
        Math.max(
          0,
          Math.min(650, ((event.clientY - bounds.top) / bounds.height) * 650),
        ),
      ),
    ];
  }

  function startStroke(event) {
    if (
      !canDraw() ||
      activeStroke ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    if (board.setPointerCapture && event.pointerId != null)
      board.setPointerCapture(event.pointerId);
    activeStroke = {
      id: uuid(),
      color: erasing ? "#ffffff" : color,
      width: erasing ? 29 : width,
      points: [pointFrom(event)],
      sent: 0,
      complete: false,
      turnId: game && game.turnId,
    };
    pendingStrokes.set(activeStroke.id, activeStroke);
    scheduleCanvas();
  }

  function moveStroke(event) {
    if (!activeStroke || !canDraw()) return;
    event.preventDefault();
    const point = pointFrom(event);
    const last = activeStroke.points[activeStroke.points.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 2) return;
    activeStroke.points.push(point);
    if (activeStroke.points.length >= 1000) stopStroke();
    scheduleCanvas();
  }

  function stopStroke() {
    if (!activeStroke) return;
    activeStroke.complete = true;
    activeStroke = null;
    flushStrokes();
  }

  function flushStrokes() {
    if (flushing) return flushing;
    if (practice) {
      for (const [id, stroke] of pendingStrokes) {
        if (stroke.complete) {
          confirmedStrokes.set(id, stroke);
          pendingStrokes.delete(id);
        }
      }
      return Promise.resolve();
    }
    flushing = (async () => {
      while (game && !quitting) {
        const stroke = Array.from(pendingStrokes.values()).find(
          (item) => item.sent < item.points.length,
        );
        if (!stroke) break;
        if (stroke.turnId !== game.turnId || game.phase !== "drawing") {
          pendingStrokes.delete(stroke.id);
          continue;
        }
        const segment = stroke.points.slice(stroke.sent, stroke.sent + 64);
        const payload = {
          roomId: game.roomId,
          turnId: stroke.turnId,
          strokeId: stroke.id,
          color: stroke.color,
          width: stroke.width,
          offset: stroke.sent,
          points: segment,
        };
        let success = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await call("stroke", payload);
            success = true;
            break;
          } catch (error) {
            if (
              attempt === 0 &&
              ["CLOUD_TIMEOUT", "CLOUD_NETWORK_ERROR"].includes(error.code)
            ) {
              await new Promise((resolve) => setTimeout(resolve, 350));
              continue;
            }
            toast(error.message || "这一笔没有发送成功，请重新画");
            break;
          }
        }
        if (!success) {
          pendingStrokes.delete(stroke.id);
          if (activeStroke === stroke) activeStroke = null;
          requestRefresh();
          scheduleCanvas();
          continue;
        }
        stroke.sent += segment.length;
        confirmedStrokes.set(stroke.id, {
          id: stroke.id,
          color: stroke.color,
          width: stroke.width,
          points: stroke.points.slice(0, stroke.sent),
        });
        if (stroke.complete && stroke.sent >= stroke.points.length)
          pendingStrokes.delete(stroke.id);
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  function updateTools() {
    for (const button of $("palette").children)
      button.classList.toggle(
        "active",
        button.dataset.color === color && !erasing,
      );
    for (const button of document.querySelectorAll("[data-width]"))
      button.classList.toggle(
        "active",
        Number(button.dataset.width) === width && !erasing,
      );
    $("eraser-button").classList.toggle("active", erasing);
  }

  async function confirmAction(title, copy) {
    $("confirm-title").textContent = title;
    $("confirm-copy").textContent = copy;
    const dialog = $("confirm-dialog");
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "confirm"),
        { once: true },
      );
      dialog.returnValue = "";
      dialog.showModal();
    });
  }

  async function leaveRoom() {
    if (
      !practice &&
      game &&
      !(await confirmAction(
        "先离开画室？",
        "记住房间号，还可以随时回来找画友。",
      ))
    )
      return;
    const leaving = game;
    quitting = true;
    roomGeneration++;
    activeStroke = null;
    pendingStrokes.clear();
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (unsubscribe) {
      unsubscribe().catch(() => {});
      unsubscribe = null;
    }
    game = null;
    practice = false;
    confirmedStrokes.clear();
    if (window.ant && ant.storage)
      await ant.storage.remove("draw-guess.last-room").catch(() => {});
    showView("lobby");
    if (leaving) call("leave", { roomId: leaving.roomId }).catch(() => {});
    quitting = false;
    loadRooms().catch(() => {});
  }

  async function showRanking() {
    showView("ranking");
    $("ranking-list").innerHTML =
      '<div class="empty-rooms"><p>正在加载积分榜…</p></div>';
    $("my-ranking").textContent = "";
    try {
      if (!myId) await ensureProfile();
      const result = await call("leaderboard");
      const entries = result.entries;
      const leaders = entries.slice(0, 3);
      const podiumOrder =
        leaders.length === 3 ? [leaders[1], leaders[0], leaders[2]] : leaders;
      $("ranking-list").innerHTML =
        leaders.length && leaders[0].points > 0
          ? `<div class="podium">${podiumOrder.map((player) => `<div class="podium-player ${player.rank === 1 ? "first" : ""}"><span class="podium-rank">${player.rank === 1 ? "♛ 第一名" : `第 ${player.rank} 名`}</span>${avatarHTML(player.avatar)}<h3>${escapeHTML(player.name)}</h3><b>${player.points}</b><small>累计积分</small></div>`).join("")}</div><div class="ranking-table">${entries.map((player) => `<div class="ranking-row ${player.playerId === myId ? "me" : ""}"><span class="ranking-position">${player.rank}</span>${avatarHTML(player.avatar)}<span class="ranking-person"><strong>${escapeHTML(player.name)}${player.playerId === myId ? "（我）" : ""}</strong><small>猜对 ${player.correct} 次，完成 ${player.games} 局</small></span><span class="ranking-points">${player.points}<small>积分</small></span></div>`).join("")}</div>`
          : '<div class="empty-rooms"><b>★</b><p><strong>榜单等你留下第一笔</strong><br>和朋友完成一场猜词，赢取第一份积分。</p></div>';
      if (result.self)
        $("my-ranking").textContent =
          result.self.points > 0
            ? `我的排名 #${result.self.rank}　累计 ${result.self.points} 积分`
            : "你的积分旅程，从第一场猜词开始。";
    } catch (error) {
      $("ranking-list").innerHTML =
        `<div class="empty-rooms"><p>${escapeHTML(error.message)}</p></div>`;
    }
  }

  $("avatar-button").addEventListener("click", () => {
    profile.name = $("nickname").value.trim() || profile.name;
    profile.avatar = (profile.avatar + 1) % avatars.length;
    updateProfileUI();
    saveLocalProfile().catch(() => {});
  });
  $("sound-button").addEventListener("click", () => {
    profile.name = $("nickname").value.trim() || profile.name;
    profile.sound = !profile.sound;
    updateProfileUI();
    saveLocalProfile().catch(() => {});
    if (profile.sound) playTone(false);
  });
  $("create-button").addEventListener("click", () => {
    if (joining) return;
    $("new-room-name").value = `${$("nickname").value.trim() || "我的"}的画室`;
    $("create-dialog").showModal();
  });
  document
    .querySelector(".close-dialog")
    .addEventListener("click", () => $("create-dialog").close());
  $("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (joining) return;
    joining = true;
    run(
      event.submitter || $("create-form").querySelector("[type=submit]"),
      async () => {
        await ensureProfile();
        const result = await call("create", {
          name: profile.name,
          avatar: profile.avatar,
          roomName: $("new-room-name").value.trim(),
          duration: Number($("duration").value),
          capacity: Number($("capacity").value),
          cycles: Number($("cycles").value),
          listed: $("listed").checked,
        });
        $("create-dialog").close();
        await enterRoom(result);
      },
    ).finally(() => {
      joining = false;
    });
  });
  $("join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    joinRoom(
      $("room-code").value,
      event.submitter || $("join-form").querySelector("button"),
    );
  });
  $("rooms-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-join]");
    if (button) joinRoom(button.dataset.join, button);
  });
  $("refresh-rooms").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      await ensureProfile();
      await loadRooms();
    }),
  );
  $("room-code").addEventListener("input", () => {
    $("room-code").value = $("room-code").value.replace(/\D/g, "").slice(0, 6);
  });
  $("practice-button").addEventListener("click", () => {
    practice = true;
    game = null;
    quitting = false;
    confirmedStrokes.clear();
    pendingStrokes.clear();
    chatSignature = "reset";
    showView("game");
    renderGame();
  });
  $("leave-button").addEventListener("click", () =>
    leaveRoom().catch((error) => toast(error.message)),
  );
  $("home-button").addEventListener("click", () => {
    if (game || practice) leaveRoom().catch((error) => toast(error.message));
    else showView("lobby");
  });
  $("ranking-button").addEventListener("click", showRanking);
  $("ranking-back").addEventListener("click", () =>
    showView(game || practice ? "game" : "lobby"),
  );
  $("copy-room").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      if (!game) return;
      await ant.clipboard.set(game.code);
      toast("房间号已复制，发给朋友一起画猜吧");
    }),
  );
  $("game-overlay").addEventListener("click", (event) => {
    const ranking = event.target.closest("[data-ranking]");
    if (ranking) return showRanking();
    const button = event.target.closest("[data-game-action], [data-choice]");
    if (!button || !game) return;
    run(button, async () => {
      const choice = button.dataset.choice;
      const result = await call(
        choice == null ? button.dataset.gameAction : "choose",
        {
          roomId: game.roomId,
          turnId: game.turnId,
          ...(choice == null ? {} : { index: Number(choice) }),
          ...(button.dataset.ready == null
            ? {}
            : { ready: button.dataset.ready === "true" }),
        },
      );
      applyGame(result);
    });
  });
  $("guess-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!game) return;
    const text = $("guess-input").value.trim();
    if (!text) return;
    run($("guess-form").querySelector("button"), async () => {
      const result = await call("guess", {
        roomId: game.roomId,
        turnId: game.turnId,
        text,
        requestId: uuid(),
      });
      $("guess-input").value = "";
      applyGame(result);
    });
  });
  $("palette").innerHTML = colors
    .map(
      (value, index) =>
        `<button class="color-button ${index === 0 ? "active" : ""}" data-color="${value}" style="background:${value}" aria-label="${["墨黑", "海蓝", "蜜桃粉", "向日黄", "薄荷绿", "葡萄紫"][index]}"></button>`,
    )
    .join("");
  $("palette").addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    color = button.dataset.color;
    erasing = false;
    updateTools();
  });
  for (const button of document.querySelectorAll("[data-width]"))
    button.addEventListener("click", () => {
      width = Number(button.dataset.width);
      erasing = false;
      updateTools();
    });
  $("eraser-button").addEventListener("click", () => {
    erasing = !erasing;
    updateTools();
  });
  $("undo-button").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      if (!canDraw()) return;
      stopStroke();
      await flushStrokes();
      if (practice)
        confirmedStrokes.delete(Array.from(confirmedStrokes.keys()).pop());
      else {
        await call("undo", { roomId: game.roomId, turnId: game.turnId });
        await refreshGame();
      }
      scheduleCanvas();
    }),
  );
  $("clear-button").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      if (
        !canDraw() ||
        !(await confirmAction("清空这张画？", "这一轮的所有笔画都会被清除。"))
      )
        return;
      stopStroke();
      await flushStrokes();
      if (!practice)
        await call("clear", { roomId: game.roomId, turnId: game.turnId });
      confirmedStrokes.clear();
      pendingStrokes.clear();
      scheduleCanvas();
    }),
  );
  board.addEventListener("pointerdown", startStroke);
  board.addEventListener("pointermove", moveStroke);
  board.addEventListener("pointerup", stopStroke);
  board.addEventListener("pointercancel", stopStroke);
  board.addEventListener("lostpointercapture", stopStroke);
  window.addEventListener("resize", scheduleCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopStroke();
    else if (game) refreshGame();
    else if (myId) loadRooms().catch(() => {});
  });

  function tvNavigation(event) {
    const key = event.key || event.code || "";
    if (["back", "Escape", "goBack"].includes(key)) {
      if (view === "ranking") showView(game || practice ? "game" : "lobby");
      else if (game || practice) leaveRoom();
      else if (ant.exitMiniApp) ant.exitMiniApp();
      return;
    }
    const buttons = Array.from(
      document.querySelectorAll("button,input,select"),
    ).filter((element) => !element.disabled && element.offsetParent !== null);
    if (["ArrowRight", "ArrowDown", "right", "down"].includes(key)) {
      buttons[
        (buttons.indexOf(document.activeElement) + 1) % buttons.length
      ]?.focus();
    } else if (["ArrowLeft", "ArrowUp", "left", "up"].includes(key)) {
      buttons[
        (buttons.indexOf(document.activeElement) + buttons.length - 1) %
          buttons.length
      ]?.focus();
    } else if (
      ["Enter", "select", "ok"].includes(key) &&
      document.activeElement instanceof HTMLButtonElement
    ) {
      document.activeElement.click();
    }
  }

  async function bootstrap() {
    $("rooms-list").innerHTML =
      '<div class="empty-rooms"><p>正在寻找画友的房间…</p></div>';
    try {
      if (window.ant && ant.storage) {
        const saved = await ant.storage.getJSON("draw-guess.profile", null);
        if (saved && typeof saved.name === "string")
          profile = {
            ...profile,
            ...saved,
            avatar: Math.max(0, Math.min(7, Number(saved.avatar) || 0)),
          };
      }
      if (!profile.name)
        profile.name = `画友${Math.floor(Math.random() * 900 + 100)}`;
      updateProfileUI();
      if (window.ant && ant.tv) ant.tv.onKey(tvNavigation);
      if (window.ant && ant.onShow)
        ant.onShow(() => {
          if (game) refreshGame();
        });
      await ensureProfile();
      await loadRooms();
      const previous = await ant.storage.getJSON("draw-guess.last-room", null);
      if (previous && previous.code) await joinRoom(previous.code);
    } catch (error) {
      setConnection(false, "联网暂不可用");
      $("rooms-list").innerHTML =
        `<div class="empty-rooms"><b>✎</b><p><strong>画板已经准备好了</strong><br>${escapeHTML(error.message)}<br>也可以先试试自由练习。</p></div>`;
    }
    setInterval(() => {
      if (document.hidden) return;
      if (game && !practice) refreshGame();
      else if (view === "lobby" && myId && cloudReady)
        loadRooms().catch(() => {});
    }, 3000);
    setInterval(() => {
      if (view === "game") updateTimer();
    }, 250);
    setInterval(() => {
      if (pendingStrokes.size && !quitting) flushStrokes();
    }, 160);
  }

  bootstrap();
})();
