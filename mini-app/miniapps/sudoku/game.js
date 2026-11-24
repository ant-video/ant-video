(function () {
  'use strict';

  const { analyze, create, check, valid, conflicts, row, column, box, peers } = window.Engine;
  const $ = (id) => document.getElementById(id);

  function mount({ changed, announce, submit }) {
    const grid = $('sudoku-grid');
    const squares = [];
    const keypad = [...document.querySelectorAll('[data-digit]')];
    let puzzle = [];
    let values = [];
    let notes = [];
    let history = [];
    let selected = 0;
    let pencil = false;
    let locked = false;
    let solution;

    function fitLegacyGrid() {
      if (grid.clientWidth) grid.style.gridAutoRows = `${grid.clientWidth / 9}px`;
    }
    const legacyGrid = !CSS.supports('aspect-ratio', '1');
    if (legacyGrid) window.addEventListener('resize', fitLegacyGrid);

    for (let index = 0; index < 81; index++) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.cell = index;
      tile.className = 'cell';
      if (row(index) % 3 === 0 && row(index)) tile.classList.add('block-top');
      if (column(index) % 3 === 0 && column(index)) tile.classList.add('block-left');
      tile.tabIndex = -1;
      tile.addEventListener('click', () => select(index));
      grid.append(tile);
      squares.push(tile);
    }

    function render() {
      const duplicates = conflicts(values);
      const highlighted = values[selected];
      const nearby = new Set(peers[selected]);
      squares.forEach((tile, index) => {
        const number = values[index];
        const mask = notes[index];
        tile.textContent = number || '';
        if (!number && mask) {
          const cluster = document.createElement('span');
          cluster.className = 'cell-notes';
          cluster.setAttribute('aria-hidden', 'true');
          for (let digit = 1; digit <= 9; digit++) {
            const figure = document.createElement('span');
            figure.textContent = mask & (1 << digit) ? digit : '';
            cluster.append(figure);
          }
          tile.append(cluster);
        }
        tile.tabIndex = index === selected ? 0 : -1;
        tile.classList.toggle('given', Boolean(puzzle[index]));
        tile.classList.toggle('peer', nearby.has(index));
        tile.classList.toggle('same', Boolean(highlighted) && highlighted === number);
        tile.classList.toggle('selected', index === selected);
        tile.classList.toggle('conflict', duplicates.has(index));
        tile.setAttribute('aria-label', `第 ${row(index) + 1} 行第 ${column(index) + 1} 列，${puzzle[index] ? '题目数字 ' : ''}${number || '空格'}${duplicates.has(index) ? '，有冲突' : ''}`);
      });
      const canEdit = !locked && !puzzle[selected];
      keypad.forEach((button) => { button.disabled = !canEdit; });
      $('erase').disabled = !canEdit || (!values[selected] && !notes[selected]);
      $('undo').disabled = locked || !history.length;
      $('notes').disabled = locked;
      $('notes').setAttribute('aria-pressed', String(pencil));
      $('submit').disabled = locked;
      const total = puzzle.filter((digit) => !digit).length;
      const filled = values.reduce((count, value, index) => count + Number(value && !puzzle[index]), 0);
      $('filled-count').textContent = `已填 ${filled} / ${total}`;
      $('conflict-count').textContent = duplicates.size ? `${duplicates.size} 格有冲突` : '';
      if (legacyGrid) fitLegacyGrid();
    }

    function select(index, focus = false) {
      selected = index;
      render();
      if (focus) squares[index].focus({ preventScroll: true });
      changed();
    }

    function place(number, asNote = pencil) {
      if (locked || puzzle[selected]) return;
      const value = values[selected];
      const mask = notes[selected];
      if (asNote && number && value) { announce('请先擦除格子里的数字'); return; }
      history.push({ cell: selected, value, mask });
      if (history.length > 60) history.shift();
      if (asNote && number) notes[selected] ^= 1 << number;
      else { values[selected] = number; notes[selected] = 0; }
      render();
      changed();
    }

    function undo() {
      if (locked || !history.length) return;
      const { cell, value, mask } = history.pop();
      values[cell] = value;
      notes[cell] = mask;
      select(cell);
    }

    function handleKey(key) {
      if (!grid.contains(document.activeElement)) return false;
      const steps = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (steps[key]) {
        const [dr, dc] = steps[key];
        const r = row(selected) + dr;
        const c = column(selected) + dc;
        if (r < 0 || r > 8 || c < 0 || c > 8) return false;
        select(r * 9 + c, true);
        return true;
      }
      if (key === 'Enter') {
        if (!locked && !puzzle[selected]) keypad[0].focus();
        return true;
      }
      if (/^[1-9]$/.test(key)) { place(Number(key)); return true; }
      if (key === 'Backspace' || key === 'Delete') { place(0, false); return true; }
      return false;
    }

    keypad.forEach((button) => button.addEventListener('click', (event) => {
      place(Number(button.dataset.digit));
      if (!event.detail) squares[selected].focus({ preventScroll: true });
    }));
    $('erase').addEventListener('click', () => place(0, false));
    $('undo').addEventListener('click', undo);
    $('notes').addEventListener('click', () => { pencil = !pencil; render(); changed(); });
    $('submit').addEventListener('click', submit);

    return {
      open(next, saved) {
        puzzle = next;
        values = valid(saved?.values) ? saved.values.map((digit, cell) => puzzle[cell] || digit) : [...puzzle];
        notes = values.map((digit, cell) => {
          const mask = saved?.notes?.[cell];
          return digit || !Number.isInteger(mask) || mask < 0 || mask > 1022 ? 0 : mask;
        });
        selected = Number.isInteger(saved?.selected) && saved.selected >= 0 && saved.selected < 81
          ? saved.selected : puzzle.indexOf(0);
        if (selected < 0) selected = 0;
        pencil = Boolean(saved?.pencil);
        history = [];
        solution = null;
        render();
      },
      lock(value) { if (locked !== value) { locked = value; render(); } },
      draft: () => ({ values: [...values], notes: [...notes], selected, pencil }),
      answer: () => [...values],
      hint() {
        if (locked) return;
        solution ||= analyze(puzzle, 1).first;
        if (!solution) return;
        const cell = !puzzle[selected] && values[selected] !== solution[selected]
          ? selected : values.findIndex((digit, index) => digit !== solution[index]);
        if (cell < 0) { announce('棋盘已正确填满，可以提交答案'); return; }
        select(cell);
        place(solution[cell], false);
        announce(`已填入第 ${row(cell) + 1} 行第 ${column(cell) + 1} 列`);
      },
      handleKey,
    };
  }

  window.PuzzleGame = {
    id: 'sudoku', title: '数独竞速', rounds: 1, roundTime: 20 * 60 * 1000,
    levels: { easy: '入门', normal: '进阶', hard: '挑战' },
    create: (level) => create(level), valid, check, mount, shareAnswer: false,
    practiceIntro: '补全九宫格，让每行、每列和每个小宫都出现 1 到 9。',
    matchIntro: '双方解同一道题，20 分钟内率先交出正确棋盘获胜。',
    tip: '先选空格，再选数字。开启笔记可在空格里标记候选数。',
    success: '解开了！每个数字都在正确的位置。',
    describeAnswer: () => '',
  };
})();
