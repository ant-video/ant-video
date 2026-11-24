(function () {
  'use strict';

  const pool = window.Pool;
  const { width, height, radius, pockets } = pool;
  const pad = 41;
  const diameter = radius * 2;
  const $ = (id) => document.getElementById(id);
  const palette = ['#eddeb5', '#e6b928', '#3c6ce1', '#d6423d', '#8653c5', '#d97935', '#319673', '#982f37', '#252929'];
  const groupName = { solid: '全色', stripe: '花色' };
  const pocketNames = ['左上', '上中', '右上', '左下', '下中', '右下'];
  const color = (side) => side === 0 ? '先手' : '后手';

  function mount({ commit, announce, refresh }) {
    const table = $('pool-table');
    const context = table.getContext('2d');
    const pocketButtons = [...document.querySelectorAll('[data-pocket]')];
    const cloth = context.createLinearGradient(0, 0, width, height);
    cloth.addColorStop(0, '#236c57');
    cloth.addColorStop(1, '#194b41');
    let board;
    let key;
    let angle = 0;
    let force = 100;
    let target = null;
    let placement;
    let placing = false;
    let allowed = false;
    let ended = false;
    let animation;
    let sequence = 0;

    function circle(x, y, r) {
      context.beginPath();
      context.arc(x, y, r, 0, 2 * Math.PI);
    }

    function paintTable() {
      context.clearRect(0, 0, table.width, table.height);
      context.fillStyle = '#443128';
      context.fillRect(0, 0, table.width, table.height);
      context.lineWidth = 2;
      context.strokeStyle = '#855e46';
      for (const inset of [6, 13, 19]) context.strokeRect(inset, inset, table.width - inset * 2, table.height - inset * 2);
      context.save();
      context.translate(pad, pad);
      context.fillStyle = '#17372c';
      context.fillRect(-10, -10, width + 20, height + 20);
      context.fillStyle = cloth;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#e8d8b9';
      for (const x of [125, 250, 375, 625, 750, 875]) for (const y of [-26, height + 26]) {
        circle(x, y, 3.1); context.fill();
      }
      for (const y of [125, 250, 375]) for (const x of [-26, width + 26]) {
        circle(x, y, 3.1); context.fill();
      }
      context.strokeStyle = '#d1edc544';
      context.setLineDash([7, 9]);
      context.beginPath(); context.moveTo(234, 0); context.lineTo(234, height); context.stroke();
      context.setLineDash([]);
      circle(686, 250, 4);
      context.fillStyle = '#d1edc577'; context.fill();
      pockets.forEach(([x, y], index) => {
        circle(x, y, index % 3 === 1 ? 19 : 22);
        context.fillStyle = '#10231f'; context.fill();
        context.lineWidth = target === index ? 5 : 2;
        context.strokeStyle = target === index ? '#f5cd83' : '#b09a7388'; context.stroke();
      });
    }

    function paintBall({ id, x, y }, ghost = false) {
      context.save();
      if (ghost) context.globalAlpha = .67;
      const stripe = id > 8;
      const pigment = palette[stripe ? id - 8 : id];
      circle(x + 1, y + 3, radius + 1);
      context.fillStyle = '#0d392dbd'; context.fill();
      circle(x, y, radius);
      context.fillStyle = stripe ? '#f6edd7' : pigment; context.fill();
      context.clip();
      if (stripe) {
        context.fillStyle = pigment;
        context.fillRect(x - radius, y - radius * .56, diameter, radius * 1.12);
      }
      const shade = context.createRadialGradient(x - 4, y - 4, 1, x, y, radius + 1);
      shade.addColorStop(0, '#ffffff88'); shade.addColorStop(.6, '#ffffff00'); shade.addColorStop(1, '#0c1a2355');
      context.fillStyle = shade; context.fillRect(x - radius, y - radius, diameter, diameter);
      if (id) {
        circle(x + .5, y + .6, 5);
        context.fillStyle = '#fff7e5'; context.fill();
        context.font = 'bold 7.8px Arial, sans-serif'; context.textBaseline = 'middle'; context.textAlign = 'center';
        context.fillStyle = '#292623'; context.fillText(id, x + .5, y + .6);
      }
      context.restore();
    }

    function aimLine(cue, balls) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const wall = [dx > 0 ? (width - radius - cue.x) / dx : (radius - cue.x) / dx,
        dy > 0 ? (height - radius - cue.y) / dy : (radius - cue.y) / dy];
      let travel = Math.min(...wall.filter((value) => value >= 0));
      let hit = false;
      for (const ball of balls) {
        if (!ball.id) continue;
        const px = ball.x - cue.x;
        const py = ball.y - cue.y;
        const ahead = px * dx + py * dy;
        const side = Math.abs(px * dy - py * dx);
        if (ahead <= 0 || side >= diameter) continue;
        const entry = ahead - Math.sqrt(diameter * diameter - side * side);
        if (entry >= 0 && entry < travel) { travel = entry; hit = true; }
      }
      if (!Number.isFinite(travel)) return;
      context.strokeStyle = '#e1f5cfb5'; context.lineWidth = 1.9; context.setLineDash([6, 8]);
      context.beginPath();
      context.moveTo(cue.x + (radius + 2) * dx, cue.y + (radius + 2) * dy);
      context.lineTo(cue.x + travel * dx, cue.y + travel * dy);
      context.stroke(); context.setLineDash([]);
      if (hit) { circle(cue.x + travel * dx, cue.y + travel * dy, radius); context.stroke(); }
      context.lineCap = 'round';
      context.strokeStyle = '#e5be83'; context.lineWidth = 5;
      const back = 20 + force * .18;
      context.beginPath(); context.moveTo(cue.x - back * dx, cue.y - back * dy);
      context.lineTo(cue.x - (back + 110) * dx, cue.y - (back + 110) * dy); context.stroke();
      context.lineCap = 'butt';
    }

    function draw(balls = board?.balls) {
      if (!board || !balls) return;
      paintTable();
      try {
        const cue = !animation && board.hand ? { id: 0, ...placement } : balls.find(({ id }) => id === 0);
        if (allowed && !animation && cue && !placing) aimLine(cue, balls);
        balls.forEach((ball) => paintBall(ball));
        if (!animation && board.hand && cue) {
          paintBall(cue, true);
          if (placing) { circle(cue.x, cue.y, radius + 5); context.strokeStyle = '#e5cd83'; context.lineWidth = 2; context.stroke(); }
        }
      } finally {
        context.restore();
      }
    }

    function controls() {
      const editable = allowed && !animation;
      const requiresPocket = !ended && pool.targetEight(board);
      $('strength-value').textContent = `${force}%`;
      $('strength').value = force;
      $('strength').disabled = !editable || placing;
      $('aim-left').disabled = !editable || placing;
      $('aim-right').disabled = !editable || placing;
      $('place-mode').hidden = !board.hand;
      $('place-mode').disabled = !editable;
      $('place-mode').textContent = placing ? '确认摆球' : '重摆白球';
      $('strike').disabled = !editable || placing || (requiresPocket && target === null);
      $('pocket-row').hidden = !requiresPocket || Boolean(animation);
      pocketButtons.forEach((button, index) => {
        button.disabled = !editable;
        button.setAttribute('aria-pressed', String(index === target));
      });
      $('ball-hint').textContent = animation ? '球在滚动' : ended ? '本局结束' : !editable ? '等待对手击球' : placing ? '选择桌面空位摆放白球' :
        requiresPocket && target === null ? '指定黑八落袋位置' : '点击桌面瞄准，或用方向键微调';
      for (let side = 0; side < 2; side++) {
        const group = board.groups[side];
        const remaining = group ? board.balls.filter(({ id }) => pool.groupOf(id) === group).length : null;
        $(`group-${side}`).textContent = group ? `${groupName[group]} · 剩 ${remaining} 球` : '尚未分组';
      }
    }

    function update() { controls(); draw(); }

    function adjust(change) {
      if (!allowed || animation || placing) return;
      angle += change;
      update();
    }

    function setPower(value) {
      if (!allowed || animation || placing) return;
      force = Math.min(100, Math.max(4, Number(value)));
      update();
    }

    function place(point, message = true) {
      if (!pool.canPlace(board.balls, point)) {
        if (message) announce('白球要放在球台内，并避开其他球和袋口');
        return;
      }
      placement = point;
      update();
    }

    function pointer(event) {
      if (!allowed || animation) return;
      const rect = table.getBoundingClientRect();
      const point = { x: (event.clientX - rect.left) * table.width / rect.width - pad,
        y: (event.clientY - rect.top) * table.height / rect.height - pad };
      if (placing) { place(point); return; }
      const cue = board.hand ? placement : board.balls.find(({ id }) => id === 0);
      if (!cue) return;
      if (pool.targetEight(board)) {
        const index = pockets.findIndex(([x, y]) => Math.hypot(x - point.x, y - point.y) <= 27);
        if (index >= 0) target = index;
      }
      if (Math.hypot(cue.x - point.x, cue.y - point.y) > radius) angle = Math.atan2(point.y - cue.y, point.x - cue.x);
      update();
    }

    function strike() {
      if ($('strike').disabled) return;
      const action = { angle: Math.round(angle * 1e6) / 1e6, power: force / 100, pocket: target };
      if (board.hand) action.placement = { x: Math.round(placement.x * 1000) / 1000, y: Math.round(placement.y * 1000) / 1000 };
      commit(action);
    }

    function handleKey(key) {
      if (document.activeElement !== table || !allowed || animation) return false;
      if (key === 'Enter') {
        if (placing) { placing = false; update(); }
        else if (pool.targetEight(board) && target === null) pocketButtons[0].focus();
        else strike();
        return true;
      }
      const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!offsets[key]) return false;
      const [dx, dy] = offsets[key];
      if (placing) {
        place({ x: placement.x + dx * 18, y: placement.y + dy * 18 }, false);
      } else if (dx) adjust(dx * .022);
      else return false;
      return true;
    }

    function replay(previous, action) {
      try {
        const { frames } = pool.simulate(previous, action, true);
        if (frames.length < 2) return;
        const duration = Math.min(frames.length * pool.frameDuration, 5600);
        const started = performance.now();
        const marker = ++sequence;
        function frame(now) {
          if (sequence !== marker) return;
          const progress = Math.min(1, (now - started) / duration);
          if (progress >= 1) {
            animation = null;
            update();
            refresh();
            return;
          }
          draw(frames[Math.floor(progress * (frames.length - 1))]);
          animation = requestAnimationFrame(frame);
        }
        animation = requestAnimationFrame(frame);
      } catch (error) {
        console.warn('无法重放击球，已恢复球台快照', error);
      }
    }

    function resetAnimation() {
      sequence++;
      if (animation) cancelAnimationFrame(animation);
      animation = null;
    }

    table.addEventListener('click', pointer);
    $('strength').addEventListener('input', (event) => setPower(event.target.value));
    $('aim-left').addEventListener('click', () => adjust(-.010));
    $('aim-right').addEventListener('click', () => adjust(.010));
    $('place-mode').addEventListener('click', () => { placing = !placing; update(); });
    $('strike').addEventListener('click', strike);
    pocketButtons.forEach((button, index) => {
      button.textContent = pocketNames[index];
      button.addEventListener('click', () => { target = index; update(); });
    });

    return {
      show(position, options) {
        const sameGame = key === options.key;
        const changed = !sameGame || position.ply !== board?.ply;
        const shouldReplay = sameGame && options.action && position.ply === board.ply + 1;
        const previous = board;
        if (!changed && allowed === options.allowed && ended === options.ended) return;
        allowed = options.allowed;
        ended = options.ended;
        key = options.key;
        board = position;
        if (changed) {
          resetAnimation();
          target = null;
          force = board.ply ? 45 : 100;
          placement = board.hand ? pool.freeSpot(board.balls) : null;
          placing = board.hand;
          angle = 0;
          if (shouldReplay) replay(previous, options.action);
        }
        controls();
        if (!animation) draw();
      },
      handleKey,
      animating: () => Boolean(animation),
      stop() { resetAnimation(); key = null; },
    };
  }

  window.DuelGame = {
    id: 'eight-ball', title: '黑八球房', localTitle: '本地双人', turnTime: 90000,
    initial: pool.initial, apply: pool.apply, valid: pool.valid, mount, color,
    localIntro: '轮流瞄准、调整力度并击球，清完自己的球组再打黑八。',
    matchIntro: '双人好友房。轮流击球，每杆限时 90 秒。',
    turnLabel: (state) => !state.ply ? '先手开球' : `${color(state.turn)}${state.hand ? '摆放自由球' : '击球'}`,
    detail(state) {
      if (!state.last) return '可以先对准球堆中线，全力开球。';
      if (state.last.foul) return `上一杆犯规：${state.last.foul}。`;
      if (state.last.respotted) return '开球黑八入袋，黑八已复位。';
      return state.last.pocketed.length ? `上一杆进袋：${state.last.pocketed.join('、')}。` : '上一杆未进球，交换击球权。';
    },
    reasons: { eight: '清完球组并把黑八打入指定袋口', 'early-eight': '黑八入袋条件未满足' },
  };
})();
