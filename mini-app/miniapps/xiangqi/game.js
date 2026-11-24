(function () {
  'use strict';

  const chess = window.Chess;
  const $ = (id) => document.getElementById(id);
  const color = (side) => side === 0 ? '红方' : '黑方';

  function drawLines(canvas) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 900, 1000);
    context.strokeStyle = '#6b482e';
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    function line(ax, ay, bx, by) {
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
    }
    for (let row = 0; row < 10; row++) line(50, 50 + row * 100, 850, 50 + row * 100);
    for (let col = 0; col < 9; col++) {
      const px = 50 + col * 100;
      if (col === 0 || col === 8) line(px, 50, px, 950);
      else { line(px, 50, px, 450); line(px, 550, px, 950); }
    }
    for (const start of [50, 750]) {
      line(350, start, 550, start + 200);
      line(550, start, 350, start + 200);
    }
    context.fillStyle = '#704728';
    context.font = '700 47px Songti SC, SimSun, serif';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillText('楚 河', 253, 500);
    context.fillText('汉 界', 647, 500);
    for (const [col, row] of [[1, 2], [7, 2], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [1, 7], [7, 7], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]]) {
      const cx = 50 + col * 100;
      const cy = 50 + row * 100;
      for (const dx of [-1, 1]) {
        if ((dx < 0 && col === 0) || (dx > 0 && col === 8)) continue;
        for (const dy of [-1, 1]) {
          line(cx + 7 * dx, cy + 7 * dy, cx + 19 * dx, cy + 7 * dy);
          line(cx + 7 * dx, cy + 7 * dy, cx + 7 * dx, cy + 19 * dy);
        }
      }
    }
  }

  function mount({ commit, announce }) {
    const grid = $('chess-grid');
    const squares = [];
    let board;
    let selected = null;
    let focus = 58;
    let key;
    let flipped = false;
    let allowed = false;
    let targets = [];
    drawLines($('chess-lines'));
    for (let cell = 0; cell < 90; cell++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'square';
      button.dataset.cell = cell;
      const piece = document.createElement('span');
      piece.className = 'chess-piece';
      piece.setAttribute('aria-hidden', 'true');
      button.append(piece);
      button.addEventListener('click', () => select(cell));
      grid.append(button);
      squares.push(button);
    }

    function draw() {
      grid.classList.toggle('locked', !allowed);
      squares.forEach((button, cell) => {
        const piece = board.board[cell];
        const last = board.last;
        button.style.gridColumnStart = (flipped ? 8 - chess.x(cell) : chess.x(cell)) + 1;
        button.style.gridRowStart = (flipped ? 9 - chess.y(cell) : chess.y(cell)) + 1;
        button.tabIndex = cell === focus ? 0 : -1;
        button.classList.toggle('selected', cell === selected);
        button.classList.toggle('target', targets.includes(cell));
        button.classList.toggle('capture', Boolean(piece) && targets.includes(cell));
        button.classList.toggle('recent', cell === last?.from || cell === last?.to);
        button.classList.toggle('checked', board.check && piece === (board.turn === 0 ? 1 : -1));
        button.firstChild.hidden = !piece;
        button.firstChild.className = `chess-piece ${piece < 0 ? 'black' : 'red'}`;
        button.firstChild.textContent = piece ? chess.nameOf(piece) : '';
        button.setAttribute('aria-label', `${chess.y(cell) + 1} 行 ${chess.x(cell) + 1} 列，${piece ? `${color(chess.sideOf(piece))}${chess.nameOf(piece)}` : '空位'}`);
      });
      $('move-count').textContent = `第 ${board.ply} 手`;
      $('check-mark').textContent = board.check ? `${color(board.turn)}被将军` : '';
    }

    function select(cell) {
      focus = cell;
      if (!allowed) { draw(); return; }
      const piece = board.board[cell];
      if (piece && chess.sideOf(piece) === board.turn) {
        selected = selected === cell ? null : cell;
        targets = selected === null ? [] : chess.moves(board.board, board.turn).filter(({ from }) => from === cell).map(({ to }) => to);
        draw();
        if (selected !== null && !targets.length) announce('这枚棋子当前没有合法落点');
        return;
      }
      if (selected !== null && targets.includes(cell)) {
        const action = { from: selected, to: cell };
        selected = null;
        targets = [];
        draw();
        commit(action);
      } else if (selected !== null) {
        announce('请选择棋盘上标出的合法落点');
        draw();
      }
    }

    function handleKey(key) {
      if (!grid.contains(document.activeElement)) return false;
      const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (!directions[key]) return false;
      const [dx, dy] = directions[key];
      const sign = flipped ? -1 : 1;
      const col = chess.x(focus) + dx * sign;
      const row = chess.y(focus) + dy * sign;
      if (col < 0 || col >= 9 || row < 0 || row >= 10) return false;
      focus = chess.index(col, row);
      draw();
      squares[focus].focus({ preventScroll: true });
      return true;
    }

    return {
      show(position, options) {
        const changed = key !== options.key || board?.ply !== position.ply;
        const nextFlip = options.side === 1;
        if (!changed && allowed === options.allowed && flipped === nextFlip) return;
        if (key !== options.key) focus = nextFlip ? 31 : 58;
        if (changed || !options.allowed) { selected = null; targets = []; }
        key = options.key;
        board = position;
        flipped = nextFlip;
        allowed = options.allowed;
        draw();
      },
      handleKey,
      stop() { key = null; },
    };
  }

  function bot(position) {
    return new Promise((resolve) => {
      const fallback = () => resolve(chess.choose(position.board, position.turn));
      let worker;
      try { worker = new Worker('./robot.js'); }
      catch (error) { console.warn('不能启动象棋机器人工作线程', error); fallback(); return; }
      const timer = setTimeout(() => { worker.terminate(); fallback(); }, 1700);
      worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data.move); };
      worker.onerror = (error) => { clearTimeout(timer); worker.terminate(); console.warn('象棋机器人工作线程暂不可用', error.message); fallback(); };
      worker.postMessage({ board: position.board, turn: position.turn });
    });
  }

  window.DuelGame = {
    id: 'xiangqi', title: '楚河象棋', localTitle: '人机对弈', turnTime: 120000,
    initial: chess.initial, apply: chess.apply, valid: chess.valid, mount, bot, color,
    localIntro: '你执红先行，绿点显示当前棋子的合法落点。',
    matchIntro: '好友双人对弈，房主执红。每步限时 120 秒。',
    turnLabel: (position) => position.check ? `${color(position.turn)}被将军` : `${color(position.turn)}走子`,
    detail(position) {
      if (!position.last) return '选择棋子后查看合法落点。';
      const lastPiece = position.board[position.last.to];
      return position.last.captured
        ? `${color(chess.sideOf(lastPiece))}${chess.nameOf(lastPiece)}吃掉${chess.nameOf(position.last.captured)}。`
        : `上一步为${color(chess.sideOf(lastPiece))}${chess.nameOf(lastPiece)}。`;
    },
    reasons: { mate: '将死', stalemate: '困毙', repeat: '同一局面三次重复', perpetual: '单方长将', 'no-capture': '连续 120 步未吃子' },
  };
})();
