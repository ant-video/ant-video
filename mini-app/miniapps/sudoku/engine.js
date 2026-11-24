(function (root) {
  'use strict';

  const cells = 81;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const all = 0x3fe;
  const levels = { easy: 44, normal: 35, hard: 28 };
  const valid = (grid) => Array.isArray(grid) && grid.length === cells &&
    grid.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const row = (index) => Math.floor(index / 9);
  const column = (index) => index % 9;
  const box = (index) => 3 * Math.floor(row(index) / 3) + Math.floor(column(index) / 3);
  const peers = Array.from({ length: cells }, (_, cell) => Array.from({ length: cells }, (_, other) => other)
    .filter((other) => cell !== other && (row(cell) === row(other) || column(cell) === column(other) || box(cell) === box(other))));
  const digitCount = Array.from({ length: 1024 }, (_, index) => index.toString(2).replace(/0/g, '').length);

  function analyze(grid, limit = 2) {
    const solution = { count: 0, first: null };
    if (!valid(grid)) return solution;
    const board = [...grid];
    const rows = Array(9).fill(0);
    const columns = Array(9).fill(0);
    const boxes = Array(9).fill(0);
    for (let i = 0; i < cells; i++) {
      if (!board[i]) continue;
      const bit = 1 << board[i];
      if ((rows[row(i)] | columns[column(i)] | boxes[box(i)]) & bit) return solution;
      rows[row(i)] |= bit;
      columns[column(i)] |= bit;
      boxes[box(i)] |= bit;
    }
    function search() {
      let cell = -1;
      let available = 0;
      let fewest = 10;
      for (let i = 0; i < cells; i++) {
        if (board[i]) continue;
        const mask = all & ~(rows[row(i)] | columns[column(i)] | boxes[box(i)]);
        const count = digitCount[mask];
        if (!count) return;
        if (count < fewest) {
          cell = i;
          available = mask;
          fewest = count;
          if (count === 1) break;
        }
      }
      if (cell < 0) {
        solution.count++;
        if (!solution.first) solution.first = [...board];
        return;
      }
      const r = row(cell);
      const c = column(cell);
      const b = box(cell);
      while (available && solution.count < limit) {
        const bit = available & -available;
        available ^= bit;
        board[cell] = Math.log2(bit);
        rows[r] |= bit;
        columns[c] |= bit;
        boxes[b] |= bit;
        search();
        rows[r] ^= bit;
        columns[c] ^= bit;
        boxes[b] ^= bit;
        board[cell] = 0;
      }
    }
    search();
    return solution;
  }

  function shuffled(input, random) {
    const result = [...input];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function create(level, random = Math.random) {
    const target = levels[level] || levels.normal;
    const indices = Array.from({ length: cells }, (_, index) => index);
    const groups = [0, 1, 2];
    const order = () => shuffled(groups, random).flatMap((band) => shuffled(groups, random).map((offset) => band * 3 + offset));
    const rs = order();
    const cs = order();
    const numbers = shuffled(digits, random);
    const puzzle = indices.map((index) => {
      const r = rs[row(index)];
      const c = cs[column(index)];
      return numbers[(r * 3 + Math.floor(r / 3) + c) % 9];
    });
    let clues = cells;
    for (const index of shuffled(indices, random)) {
      const number = puzzle[index];
      puzzle[index] = 0;
      if (analyze(puzzle).count !== 1) puzzle[index] = number;
      else clues--;
      if (clues === target) break;
    }
    return puzzle;
  }

  function conflicts(board) {
    return new Set(board.flatMap((value, index) => value && peers[index].some((other) => board[other] === value) ? [index] : []));
  }

  function check(puzzle, board) {
    if (!valid(puzzle) || !valid(board) || board.includes(0)) throw new Error('请填满所有空格');
    if (puzzle.some((digit, index) => digit && board[index] !== digit) || conflicts(board).size) {
      throw new Error('棋盘还有冲突，再检查一下');
    }
  }

  const api = { analyze, create, check, valid, conflicts, peers, row, column, box };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Engine = api;
})(typeof self === 'undefined' ? globalThis : self);
