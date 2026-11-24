(function (root) {
  'use strict';

  function fraction(numerator, denominator = 1) {
    if (!denominator) throw new Error('除数不能是 0');
    let a = Math.abs(numerator);
    let b = Math.abs(denominator);
    while (b) [a, b] = [b, a % b];
    const divisor = denominator < 0 ? -a : a;
    return [numerator / divisor, denominator / divisor];
  }

  function combine([a, b], [c, d], operator) {
    switch (operator) {
      case '+': return fraction(a * d + b * c, b * d);
      case '-': return fraction(a * d - b * c, b * d);
      case '*': return fraction(a * c, b * d);
      case '/': return fraction(a * d, b * c);
      default: throw new Error('运算符无效');
    }
  }

  const valid = (cards) => Array.isArray(cards) && cards.length === 4 &&
    cards.every((number) => Number.isInteger(number) && number >= 1 && number <= 13);

  function evaluate(cards, tokens) {
    if (!valid(cards) || !Array.isArray(tokens) || tokens.length > 19) throw new Error('算式无效');
    let index = 0;
    const used = new Set();

    function atom() {
      const token = tokens[index++];
      if (token === '(') {
        const value = sum();
        if (tokens[index++] !== ')') throw new Error('请补全括号');
        return value;
      }
      if (!Number.isInteger(token) || token < 0 || token >= cards.length || used.has(token)) {
        throw new Error('每张数字牌只能用一次，且数字之间需要运算符');
      }
      used.add(token);
      return [cards[token], 1];
    }

    function product() {
      let value = atom();
      while (tokens[index] === '*' || tokens[index] === '/') {
        const op = tokens[index++];
        value = combine(value, atom(), op);
      }
      return value;
    }

    function sum() {
      let value = product();
      while (tokens[index] === '+' || tokens[index] === '-') {
        const op = tokens[index++];
        value = combine(value, product(), op);
      }
      return value;
    }

    const result = sum();
    if (index !== tokens.length) throw new Error('请检查括号和运算符');
    if (used.size !== cards.length) throw new Error('请把四张数字牌都用上');
    return result;
  }

  function check(cards, tokens) {
    const [number, denominator] = evaluate(cards, tokens);
    if (number !== 24 * denominator) {
      throw new Error(`算式等于 ${denominator === 1 ? number : `${number}/${denominator}`}，再试试`);
    }
  }

  function solve(cards) {
    if (!valid(cards)) return null;
    function search(items) {
      if (items.length === 1) {
        const { value: [number, denominator], tokens } = items[0];
        return number === 24 * denominator ? tokens.slice(1, -1) : null;
      }
      for (let i = 0; i < items.length - 1; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const rest = items.filter((_, k) => k !== i && k !== j);
          const pairs = [[a, '+', b], [a, '*', b], [a, '-', b], [b, '-', a]];
          if (b.value[0]) pairs.push([a, '/', b]);
          if (a.value[0]) pairs.push([b, '/', a]);
          for (const [left, op, right] of pairs) {
            const result = search([...rest, {
              value: combine(left.value, right.value, op), tokens: ['(', ...left.tokens, op, ...right.tokens, ')'],
            }]);
            if (result) return result;
          }
        }
      }
      return null;
    }
    return search(cards.map((number, index) => ({ value: [number, 1], tokens: [index] })));
  }

  function create(previous, random = Math.random) {
    const signature = (cards) => [...cards].sort((a, b) => a - b).join(',');
    const seen = new Set(previous.map(signature));
    for (let attempt = 0; attempt < 36; attempt++) {
      const cards = Array.from({ length: 4 }, () => Math.floor(random() * 13) + 1);
      const key = signature(cards);
      if (seen.has(key)) continue;
      if (solve(cards)) return cards;
      seen.add(key);
    }
    return [[1, 3, 4, 6], [2, 4, 6, 8], [3, 3, 8, 8], [1, 2, 7, 7], [2, 5, 5, 10], [3, 4, 5, 6]]
      .find((cards) => !seen.has(signature(cards)) && solve(cards));
  }

  const display = (cards, tokens) => tokens.map((token) => Number.isInteger(token) ? cards[token] : ({ '*': '×', '/': '÷', '-': '−' })[token] || token).join(' ');
  const api = { create, valid, check, solve, evaluate, display };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Engine = api;
})(typeof self === 'undefined' ? globalThis : self);
