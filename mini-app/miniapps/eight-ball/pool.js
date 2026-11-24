(function (root) {
  'use strict';

  const width = 1000;
  const height = 500;
  const radius = 10.5;
  const diameter = 2 * radius;
  const ticks = 180;
  const frameStep = 4;
  const pockets = [[0, 0], [500, 0], [1000, 0], [0, 500], [500, 500], [1000, 500]];
  const rackOrder = [1, 10, 3, 5, 8, 14, 12, 6, 11, 4, 2, 15, 7, 9, 13];
  const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
  const solid = (id) => id > 0 && id < 8;
  const stripe = (id) => id > 8;
  const groupOf = (id) => solid(id) ? 'solid' : stripe(id) ? 'stripe' : null;
  const round = (number) => Math.round(number * 1000) / 1000;

  function initial() {
    const balls = [{ id: 0, x: 234, y: 250 }];
    let position = 0;
    for (let row = 0; row < 5; row++) {
      for (let slot = 0; slot <= row; slot++) {
        balls.push({ id: rackOrder[position++], x: round(686 + row * 18.8), y: round(250 + (slot - row / 2) * 21.6) });
      }
    }
    return { balls, turn: 0, ply: 0, groups: [null, null], hand: false, last: null, winner: null, reason: null };
  }

  function valid(state) {
    return Boolean(state && Array.isArray(state.balls) && state.balls.length <= 16 &&
      new Set(state.balls.map(({ id }) => id)).size === state.balls.length &&
      state.balls.every(({ id, x, y }) => Number.isInteger(id) && id >= 0 && id <= 15 &&
        Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= width && y >= 0 && y <= height) &&
      [0, 1].includes(state.turn) && Number.isInteger(state.ply) && state.ply >= 0 &&
      Array.isArray(state.groups) && state.groups.length === 2 && state.groups.every((group) => [null, 'solid', 'stripe'].includes(group)) &&
      typeof state.hand === 'boolean');
  }

  function pocketAt(x, y) {
    return pockets.findIndex(([px, py], index) => dist(x, y, px, py) <= (index % 3 === 1 ? 19 : 22));
  }

  function canPlace(balls, point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < radius + 1 || point.x > width - radius - 1 || point.y < radius + 1 || point.y > height - radius - 1) return false;
    return pocketAt(point.x, point.y) < 0 && !balls.some((ball) => ball.id && dist(ball.x, ball.y, point.x, point.y) < diameter + .6);
  }

  function freeSpot(balls, startingX = 234) {
    for (let column = 0; column <= 36; column++) {
      const dx = Math.ceil(column / 2) * 24 * (column % 2 ? -1 : 1);
      for (let row = 0; row <= 18; row++) {
        const point = { x: startingX + dx, y: 250 + Math.ceil(row / 2) * 24 * (row % 2 ? -1 : 1) };
        if (canPlace(balls, point)) return point;
      }
    }
    return { x: width - 30, y: height - 30 };
  }

  function targetEight(state) {
    if (!state.ply) return false;
    const group = state.groups[state.turn];
    if (group) return !state.balls.some(({ id }) => groupOf(id) === group);
    return !state.balls.some(({ id }) => solid(id)) || !state.balls.some(({ id }) => stripe(id));
  }

  function selectCue(state, action) {
    if (state.hand) {
      if (!canPlace(state.balls, action.placement)) throw new Error('请把白球摆在球台内的空位');
      return [{ id: 0, x: action.placement.x, y: action.placement.y }, ...state.balls.filter(({ id }) => id !== 0)];
    }
    return state.balls;
  }

  function rails(ball, cushion, result) {
    let wall = false;
    if (ball.x < radius || ball.x > width - radius) {
      ball.x = Math.min(width - radius, Math.max(radius, ball.x));
      if ((ball.x === radius && ball.vx < 0) || (ball.x > radius && ball.vx > 0)) ball.vx *= -cushion;
      wall = true;
    }
    if (ball.y < radius || ball.y > height - radius) {
      ball.y = Math.min(height - radius, Math.max(radius, ball.y));
      if ((ball.y === radius && ball.vy < 0) || (ball.y > radius && ball.vy > 0)) ball.vy *= -cushion;
      wall = true;
    }
    if (wall && result.first !== null) {
      result.railAfter = true;
      if (ball.id) result.objectRails.add(ball.id);
    }
  }

  function collide(a, b, result) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    if (squared >= diameter * diameter) return;
    const distance = Math.sqrt(squared) || .0001;
    const nx = squared ? dx / distance : 1;
    const ny = squared ? dy / distance : 0;
    const overlap = (diameter - distance) * .501;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;
    const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (closing <= 0) return;
    if (result.first === null && (!a.id || !b.id)) result.first = a.id || b.id;
    const impulse = closing * .972;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
  }

  function snapshot(balls) {
    return balls.filter((ball) => !ball.dropped).map(({ id, x, y }) => ({ id, x: round(x), y: round(y) }));
  }

  function simulate(state, action, trace = false) {
    if (!Number.isFinite(action.angle) || !Number.isFinite(action.power) || action.power < .04 || action.power > 1) {
      throw new Error('击球角度或力度不正确');
    }
    const balls = selectCue(state, action).map((ball) => ({ ...ball, vx: 0, vy: 0, dropped: false }));
    const cue = balls.find(({ id }) => id === 0);
    if (!cue) throw new Error('请先摆好白球');
    cue.vx = Math.cos(action.angle) * (155 + (state.ply ? 1360 : 2150) * action.power);
    cue.vy = Math.sin(action.angle) * (155 + (state.ply ? 1360 : 2150) * action.power);
    const result = { first: null, railAfter: false, objectRails: new Set(), pocketed: [], frames: [] };
    if (trace) result.frames.push(snapshot(balls));

    for (let tick = 1; tick <= 14 * ticks; tick++) {
      let moving = false;
      for (const ball of balls) {
        if (ball.dropped) continue;
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed <= 4) { ball.vx = 0; ball.vy = 0; continue; }
        moving = true;
        ball.x += ball.vx / ticks;
        ball.y += ball.vy / ticks;
        const loss = Math.max(0, 1 - 73 / ticks / speed) * .9978;
        ball.vx *= loss;
        ball.vy *= loss;
      }
      if (!moving) break;
      for (let i = 0; i < balls.length; i++) {
        if (balls[i].dropped) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (!balls[j].dropped) collide(balls[i], balls[j], result);
        }
      }
      for (const ball of balls) {
        if (ball.dropped) continue;
        const pocket = pocketAt(ball.x, ball.y);
        if (pocket >= 0) {
          ball.dropped = true;
          result.pocketed.push({ id: ball.id, pocket });
        } else {
          rails(ball, .81, result);
        }
      }
      if (trace && tick % frameStep === 0) result.frames.push(snapshot(balls));
    }
    result.balls = snapshot(balls);
    if (trace) result.frames.push(result.balls);
    return result;
  }

  function decide(state, action, shot) {
    const breaker = state.ply === 0;
    const eligible = targetEight(state);
    const shooter = state.turn;
    const group = state.groups[shooter];
    const objectPocketed = shot.pocketed.filter(({ id }) => id !== 0);
    const eight = objectPocketed.find(({ id }) => id === 8);
    const scratch = shot.pocketed.some(({ id }) => id === 0);
    const rightFirst = breaker || (eligible && shot.first === 8) ||
      (shot.first !== 8 && (!group || (!eligible && groupOf(shot.first) === group)));
    let foul = null;
    if (scratch) foul = '白球落袋';
    else if (shot.first === null) foul = '白球未碰到目标球';
    else if (!rightFirst) foul = '先碰错球';
    else if (breaker && !objectPocketed.length && shot.objectRails.size < 4) foul = '开球未进球且不足四颗目标球碰库';
    else if (!breaker && !objectPocketed.length && !shot.railAfter) foul = '碰球后无球进袋或碰库';

    const next = {
      balls: [...shot.balls], turn: 1 - shooter, ply: state.ply + 1, groups: [...state.groups], hand: Boolean(foul),
      last: { pocketed: objectPocketed.map(({ id }) => id), foul, shooter, respotted: false }, winner: null, reason: null,
    };
    if (eight && !breaker) {
      const win = eligible && shot.first === 8 && !foul && eight.pocket === action.pocket;
      return { ...next, winner: win ? shooter : 1 - shooter, reason: win ? 'eight' : 'early-eight' };
    }
    if (eight) {
      next.balls.push({ id: 8, ...freeSpot(next.balls, 686) });
      next.last.respotted = true;
    }
    if (foul) {
      next.balls = next.balls.filter(({ id }) => id !== 0);
      return next;
    }

    if (breaker) {
      if (objectPocketed.length) next.turn = shooter;
      return next;
    }
    if (!group) {
      const assigned = objectPocketed.find(({ id }) => groupOf(id));
      if (assigned) {
        next.groups[shooter] = groupOf(assigned.id);
        next.groups[1 - shooter] = next.groups[shooter] === 'solid' ? 'stripe' : 'solid';
        next.turn = shooter;
      }
    } else if (objectPocketed.some(({ id }) => groupOf(id) === group)) {
      next.turn = shooter;
    }
    return next;
  }

  function apply(state, action) {
    if (state.reason) throw new Error('本局已经结束');
    if (targetEight(state) && (!Number.isInteger(action.pocket) || action.pocket < 0 || action.pocket > 5)) {
      throw new Error('请先指定黑八的目标袋口');
    }
    return decide(state, action, simulate(state, action));
  }

  const api = { initial, valid, apply, simulate, decide, canPlace, freeSpot, targetEight, groupOf, pockets, width, height, radius, frameDuration: frameStep / ticks * 1000 };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Pool = api;
})(typeof self === 'undefined' ? globalThis : self);
