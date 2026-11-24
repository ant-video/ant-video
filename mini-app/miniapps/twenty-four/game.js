(function () {
  'use strict';

  const { create, check, solve, valid, display } = window.Engine;
  const maxTokens = 19;
  const operators = ['+', '-', '*', '/', '(', ')'];
  const $ = (id) => document.getElementById(id);

  function mount({ changed, announce, submit }) {
    const cards = [...document.querySelectorAll('[data-card]')];
    const controls = [...document.querySelectorAll('[data-token]')];
    let hand = [];
    let tokens = [];
    let locked = false;

    function render() {
      const used = new Set(tokens.filter(Number.isInteger));
      cards.forEach((button, slot) => {
        button.textContent = hand[slot];
        button.setAttribute('aria-label', `第 ${slot + 1} 张牌，${hand[slot]}${used.has(slot) ? '，已使用' : ''}`);
        button.setAttribute('aria-disabled', String(locked || used.has(slot) || tokens.length === maxTokens));
        button.classList.toggle('used', used.has(slot));
      });
      $('expression').textContent = tokens.length ? display(hand, tokens) : '选择数字牌和运算符';
      $('expression').classList.toggle('placeholder', !tokens.length);
      $('used-count').textContent = `已用 ${used.size} / 4 张`;
      controls.forEach((button) => { button.disabled = locked || tokens.length === maxTokens; });
      $('undo').disabled = locked || !tokens.length;
      $('erase').disabled = locked || !tokens.length;
      $('submit').disabled = locked || !tokens.length;
    }

    function add(token) {
      if (locked || tokens.length >= maxTokens || (Number.isInteger(token) && tokens.includes(token))) return;
      tokens.push(token);
      render();
      changed();
    }

    cards.forEach((button, slot) => button.addEventListener('click', () => add(slot)));
    controls.forEach((button) => button.addEventListener('click', () => add(button.dataset.token)));
    $('undo').addEventListener('click', () => { tokens.pop(); render(); changed(); });
    $('erase').addEventListener('click', () => { tokens = []; render(); changed(); });
    $('submit').addEventListener('click', submit);

    return {
      open(puzzle, saved) {
        hand = puzzle;
        tokens = Array.isArray(saved) && saved.length <= maxTokens
          ? saved.filter((token) => (Number.isInteger(token) && token >= 0 && token <= 3) || operators.includes(token)) : [];
        render();
      },
      lock(value) { if (locked !== value) { locked = value; render(); } },
      draft: () => [...tokens],
      answer: () => [...tokens],
      hint() {
        const solution = solve(hand);
        if (solution) announce(`一种解法：${display(hand, solution)} = 24`);
      },
      handleKey: () => false,
    };
  }

  window.PuzzleGame = {
    id: 'twenty-four', title: '24点对决', rounds: 5, roundTime: 75000,
    create: (_, previous) => create(previous), valid, check, mount, shareAnswer: true,
    practiceIntro: '四张牌各用一次，用加减乘除算出 24。',
    matchIntro: '五题连赛，每题限时 75 秒，率先算对的一方拿下一题。',
    tip: '可以使用括号和分数。数值相同的牌也要分别使用。',
    success: '算对了！结果正好是 24。',
    describeAnswer: (puzzle, answer) => answer ? `${display(puzzle, answer)} = 24` : '',
  };
})();
