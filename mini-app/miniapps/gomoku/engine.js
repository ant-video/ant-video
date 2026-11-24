(function (root) {
  'use strict';

  const size = 15;
  const center = 112;
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const cellAt = (x, y) => x >= 0 && x < size && y >= 0 && y < size ? y * size + x : -1;
  const sideAt = (ply) => 1 + ply % 2;

  function makeBoard(moves) {
    const board = new Uint8Array(size * size);
    moves.forEach((cell, ply) => { board[cell] = sideAt(ply); });
    return board;
  }

  function winningLine(board, cell, side) {
    const x = cell % size;
    const y = Math.floor(cell / size);
    for (const [dx, dy] of axes) {
      const line = [cell];
      for (const sign of [-1, 1]) {
        for (let step = 1; step < size; step++) {
          const next = cellAt(x + dx * step * sign, y + dy * step * sign);
          if (next < 0 || board[next] !== side) break;
          if (sign < 0) line.unshift(next);
          else line.push(next);
        }
      }
      if (line.length >= 5) return line;
    }
    return [];
  }

  function outcome(moves) {
    if (!moves.length) return { line: [], winner: null };
    const side = sideAt(moves.length - 1);
    const line = winningLine(makeBoard(moves), moves[moves.length - 1], side);
    return { line, winner: line.length ? side : moves.length === size * size ? 0 : null };
  }

  // 连续棋形优先，同时考虑四子窗口里的断点。
  const openValues = [0, 3, 19, 145, 1900, 100000];
  const closedValues = [0, 1, 5, 23, 220, 100000];

  function shape(board, cell, side) {
    const x = cell % size;
    const y = Math.floor(cell / size);
    let total = 0;
    let fours = 0;
    let threes = 0;
    for (const [dx, dy] of axes) {
      let count = 1;
      let open = 0;
      for (const sign of [-1, 1]) {
        for (let step = 1; step <= 5; step++) {
          const next = cellAt(x + dx * step * sign, y + dy * step * sign);
          if (next < 0) break;
          if (board[next] !== side) {
            if (!board[next]) open++;
            break;
          }
          count++;
        }
      }
      if (count >= 5) return 100000;
      let value = open === 2 ? openValues[count] : open === 1 ? closedValues[count] : 0;
      for (let start = -4; start <= 0; start++) {
        let stones = 1;
        for (let step = start; step < start + 5; step++) {
          if (!step) continue;
          const next = cellAt(x + dx * step, y + dy * step);
          if (next < 0 || board[next] === 3 - side) { stones = 0; break; }
          if (board[next] === side) stones++;
        }
        if (stones === 4) value = Math.max(value, 220);
        if (stones === 3) value = Math.max(value, 24);
      }
      if (value >= 220) fours++;
      else if (value >= 145) threes++;
      total += value;
    }
    return total + (fours >= 2 ? 2600 : 0) + (fours && threes ? 510 : 0) + (threes >= 2 ? 250 : 0);
  }

  function candidates(board, side) {
    const nearby = new Set();
    for (let cell = 0; cell < board.length; cell++) {
      if (!board[cell]) continue;
      const x = cell % size;
      const y = Math.floor(cell / size);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const next = cellAt(x + dx, y + dy);
          if (next >= 0 && !board[next]) nearby.add(next);
        }
      }
    }
    const results = [...nearby].map((cell) => {
      const attack = shape(board, cell, side);
      const defense = shape(board, cell, 3 - side);
      const proximity = 14 - Math.abs(cell % size - 7) - Math.abs(Math.floor(cell / size) - 7);
      return { cell, attack, defense, priority: attack + defense * 0.94 + proximity * 0.7 };
    });
    return results.sort((a, b) => b.priority - a.priority);
  }

  function tactical(ranked) {
    const win = ranked.find((candidate) => candidate.attack >= 100000);
    if (win) return [win];
    const blocks = ranked.filter((candidate) => candidate.defense >= 100000);
    return blocks.length ? blocks : ranked;
  }

  function chooseMove(moves, difficulty, random = Math.random) {
    if (!moves.length) return center;
    if (moves.length === size * size) return null;
    const board = makeBoard(moves);
    const side = sideAt(moves.length);
    const ranked = candidates(board, side);
    const choices = tactical(ranked);
    if (choices.length === 1) return choices[0].cell;
    if (difficulty === 'easy') {
      const shortlist = choices.slice(0, 8);
      return shortlist[Math.floor(random() * shortlist.length)].cell;
    }
    if (difficulty === 'normal') return choices[0].cell;

    // 高难度在工作线程中搜索，保留完整搜索过的最近一层结果。
    const deadline = Date.now() + 210;
    const expired = {};
    function search(turn, depth, alpha, beta) {
      if (Date.now() >= deadline) throw expired;
      const options = tactical(candidates(board, turn));
      if (!options.length) return 0;
      if (options[0].attack >= 100000) return 100000 + depth;
      if (!depth) {
        const current = options[0];
        return current.attack - current.defense * 0.95;
      }
      let best = -Infinity;
      for (const option of options.slice(0, depth === 1 ? 5 : 6)) {
        board[option.cell] = turn;
        let value;
        try {
          value = -search(3 - turn, depth - 1, -beta, -alpha);
        } finally {
          board[option.cell] = 0;
        }
        best = Math.max(best, value);
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      }
      return best;
    }

    let bestCell = choices[0].cell;
    for (const depth of [1, 2, 3]) {
      let best = -Infinity;
      let nextBest = bestCell;
      try {
        const options = choices.slice(0, 9);
        options.sort((a, b) => Number(b.cell === bestCell) - Number(a.cell === bestCell));
        for (const option of options) {
          board[option.cell] = side;
          let score;
          try {
            const weight = Math.min(1000, option.priority) * 0.12;
            score = -search(3 - side, depth, -Infinity, weight - best) + weight;
          } finally {
            board[option.cell] = 0;
          }
          if (score > best) { best = score; nextBest = option.cell; }
        }
        bestCell = nextBest;
      } catch (error) {
        if (error !== expired) throw error;
        break;
      }
    }
    return bestCell;
  }

  const engine = { size, center, sideAt, makeBoard, outcome, chooseMove };
  if (typeof module !== 'undefined') module.exports = engine;
  else root.Gomoku = engine;
})(typeof self === 'undefined' ? globalThis : self);
