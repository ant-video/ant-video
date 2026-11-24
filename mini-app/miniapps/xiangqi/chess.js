(function (root) {
  'use strict';

  const rows = 10;
  const cols = 9;
  const king = 1;
  const guard = 2;
  const elephant = 3;
  const horse = 4;
  const rook = 5;
  const cannon = 6;
  const pawn = 7;
  const back = [rook, horse, elephant, guard, king, guard, elephant, horse, rook];
  const straight = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const knight = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const x = (cell) => cell % cols;
  const y = (cell) => Math.floor(cell / cols);
  const index = (col, row) => row * cols + col;
  const inBoard = (col, row) => col >= 0 && col < cols && row >= 0 && row < rows;
  const sideSign = (side) => side === 0 ? 1 : -1;
  const sideOf = (piece) => piece > 0 ? 0 : 1;
  const ownHalf = (row, side) => side === 0 ? row >= 5 : row <= 4;
  const palace = (col, row, side) => col >= 3 && col <= 5 && (side === 0 ? row >= 7 : row <= 2);
  const names = [['', '帅', '仕', '相', '马', '车', '炮', '兵'], ['', '将', '士', '象', '马', '车', '炮', '卒']];
  const nameOf = (piece) => names[sideOf(piece)][Math.abs(piece)];

  function key(board, side) {
    return `${side}${board.map((piece) => (piece + 7).toString(16)).join('')}`;
  }

  function initial() {
    const board = Array(rows * cols).fill(0);
    back.forEach((piece, col) => { board[index(col, 0)] = -piece; board[index(col, 9)] = piece; });
    for (const col of [1, 7]) { board[index(col, 2)] = -cannon; board[index(col, 7)] = cannon; }
    for (const col of [0, 2, 4, 6, 8]) { board[index(col, 3)] = -pawn; board[index(col, 6)] = pawn; }
    return { board, turn: 0, ply: 0, last: null, history: [{ key: key(board, 0) }], winner: null, reason: null, check: false };
  }

  function valid(state) {
    return Boolean(state && Array.isArray(state.board) && state.board.length === 90 &&
      state.board.every((piece) => Number.isInteger(piece) && Math.abs(piece) <= 7) &&
      [0, 1].includes(state.turn) && Number.isInteger(state.ply) && state.ply >= 0 &&
      Array.isArray(state.history) && state.history.length > 0 && state.history.length <= 121 &&
      state.board.includes(king) && state.board.includes(-king));
  }

  function obstructed(board, from, to) {
    const dx = Math.sign(x(to) - x(from));
    const dy = Math.sign(y(to) - y(from));
    let col = x(from) + dx;
    let row = y(from) + dy;
    let count = 0;
    while (col !== x(to) || row !== y(to)) {
      count += Number(Boolean(board[index(col, row)]));
      col += dx;
      row += dy;
    }
    return count;
  }

  function attacks(board, from, to) {
    const piece = board[from];
    if (!piece || from === to || (board[to] && sideOf(board[to]) === sideOf(piece))) return false;
    const side = sideOf(piece);
    const col = x(to);
    const row = y(to);
    const dx = col - x(from);
    const dy = row - y(from);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    switch (Math.abs(piece)) {
      case king:
        return (palace(col, row, side) && ax + ay === 1) ||
          (dx === 0 && Math.abs(board[to]) === king && obstructed(board, from, to) === 0);
      case guard: return ax === 1 && ay === 1 && palace(col, row, side);
      case elephant: return ax === 2 && ay === 2 && ownHalf(row, side) && !board[index(col - dx / 2, row - dy / 2)];
      case horse:
        return ax + ay === 3 && ax && ay && !board[index(x(from) + (ax === 2 ? dx / 2 : 0), y(from) + (ay === 2 ? dy / 2 : 0))];
      case rook: return (!dx || !dy) && obstructed(board, from, to) === 0;
      case cannon: return (!dx || !dy) && obstructed(board, from, to) === (board[to] ? 1 : 0);
      case pawn:
        return (dx === 0 && dy === (side === 0 ? -1 : 1)) ||
          (!ownHalf(y(from), side) && dy === 0 && ax === 1);
      default: return false;
    }
  }

  function inCheck(board, side) {
    const leader = board.indexOf(sideSign(side) * king);
    if (leader < 0) return true;
    for (let from = 0; from < board.length; from++) {
      if (board[from] && sideOf(board[from]) !== side && attacks(board, from, leader)) return true;
    }
    return false;
  }

  function legal(board, side, from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= 90 || to >= 90 ||
        !board[from] || sideOf(board[from]) !== side || Math.abs(board[to]) === king || !attacks(board, from, to)) return false;
    const moved = board[from];
    const captured = board[to];
    board[to] = moved;
    board[from] = 0;
    const safe = !inCheck(board, side);
    board[from] = moved;
    board[to] = captured;
    return safe;
  }

  function destinations(board, from) {
    switch (Math.abs(board[from])) {
      case rook:
      case cannon:
        return straight.flatMap(([dx, dy]) => {
          const line = [];
          for (let col = x(from) + dx, row = y(from) + dy; inBoard(col, row); col += dx, row += dy) line.push(index(col, row));
          return line;
        });
      case king:
      case pawn: return shifted(from, straight);
      case guard: return shifted(from, diagonal);
      case elephant: return shifted(from, diagonal, 2);
      case horse: return shifted(from, knight);
      default: return [];
    }
  }

  function shifted(from, offsets, step = 1) {
    return offsets.map(([dx, dy]) => [x(from) + dx * step, y(from) + dy * step])
      .filter(([col, row]) => inBoard(col, row)).map(([col, row]) => index(col, row));
  }

  function moves(board, side, firstOnly = false) {
    const result = [];
    for (let from = 0; from < board.length; from++) {
      if (!board[from] || sideOf(board[from]) !== side) continue;
      for (const to of destinations(board, from)) {
        if (!legal(board, side, from, to)) continue;
        result.push({ from, to });
        if (firstOnly) return result;
      }
    }
    return result;
  }

  function repetition(history, current) {
    const occurrences = history.flatMap((item, position) => item.key === current ? [position] : []);
    if (occurrences.length < 3) return null;
    const cycle = history.slice(occurrences[occurrences.length - 3] + 1);
    const alwaysChecks = [0, 1].map((side) => cycle.filter((item) => item.by === side).every((item) => item.check));
    if (alwaysChecks[0] !== alwaysChecks[1]) return { winner: Number(alwaysChecks[0]), reason: 'perpetual' };
    return { winner: null, reason: 'repeat' };
  }

  function apply(state, action) {
    const { from, to } = action;
    if (state.reason || !legal(state.board, state.turn, from, to)) throw new Error('这步不符合走子规则或会让己方被将军');
    const board = [...state.board];
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    const turn = 1 - state.turn;
    const checked = inCheck(board, turn);
    const position = { key: key(board, turn), by: state.turn, check: checked };
    const history = captured ? [position] : [...state.history, position];
    const next = { board, turn, ply: state.ply + 1, last: { from, to, captured }, history, check: checked, winner: null, reason: null };
    if (!moves(board, turn, true).length) return { ...next, winner: state.turn, reason: checked ? 'mate' : 'stalemate' };
    const repeated = repetition(history, position.key);
    if (repeated) return { ...next, ...repeated };
    if (history.length >= 121) next.reason = 'no-capture';
    return next;
  }

  const values = [0, 10000, 105, 105, 315, 675, 360, 85];
  function evaluate(board, side) {
    let score = 0;
    board.forEach((piece, cell) => {
      if (!piece) return;
      const owner = sideOf(piece);
      const type = Math.abs(piece);
      const progress = owner === 0 ? 9 - y(cell) : y(cell);
      const bonus = type === pawn ? progress * 7 + Number(progress >= 5) * 28 :
        [horse, rook, cannon].includes(type) ? (4 - Math.abs(x(cell) - 4)) * 5 : 0;
      score += (values[type] + bonus) * (owner === side ? 1 : -1);
    });
    return score;
  }

  function choose(board, side, budget = 220) {
    const options = moves(board, side);
    if (!options.length) return null;
    const deadline = Date.now() + budget;
    const timeout = {};
    const priority = ({ from, to }) => board[to] ? values[Math.abs(board[to])] * 10 - values[Math.abs(board[from])] : 0;
    const sort = (a, b) => priority(b) - priority(a);

    function score(turn, depth, alpha, beta) {
      if (Date.now() >= deadline) throw timeout;
      if (!depth) return evaluate(board, turn);
      const candidates = moves(board, turn).sort(sort);
      if (!candidates.length) return -30000 - depth;
      let best = -Infinity;
      for (const move of candidates) {
        const value = searchMove(move, turn, depth, alpha, beta);
        best = Math.max(best, value);
        alpha = Math.max(alpha, best);
        if (alpha >= beta) break;
      }
      return best;
    }

    function searchMove({ from, to }, turn, depth, alpha, beta) {
      const moved = board[from];
      const captured = board[to];
      board[from] = 0;
      board[to] = moved;
      try { return -score(1 - turn, depth - 1, -beta, -alpha); }
      finally { board[from] = moved; board[to] = captured; }
    }

    let choice = options.sort(sort)[0];
    for (let depth = 1; depth <= 3; depth++) {
      let best = -Infinity;
      let bestMove = choice;
      try {
        const ordered = [choice, ...options.filter((option) => option !== choice)];
        for (const move of ordered) {
          const value = searchMove(move, side, depth, best, Infinity);
          if (value > best) { best = value; bestMove = move; }
        }
        choice = bestMove;
      } catch (error) {
        if (error !== timeout) throw error;
        break;
      }
    }
    return choice;
  }

  const api = { initial, valid, legal, moves, apply, choose, inCheck, nameOf, sideOf, x, y, index, key };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Chess = api;
})(typeof self === 'undefined' ? globalThis : self);
