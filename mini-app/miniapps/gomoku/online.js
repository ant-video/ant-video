(function (root) {
  'use strict';

  const { size, sideAt, outcome } = typeof module !== 'undefined' ? require('./engine.js') : root.Gomoku;
  const roomKind = 'gomoku-v1';
  const board = 'gomoku-friends-v1';
  const ledgerKey = 'gomoku-friends-profile-v1';
  const privateScope = { scope: 'private' };
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const day = 24 * 60 * 60 * 1000;
  const turnTime = 90 * 1000;
  const waitingTime = 10 * 60 * 1000;

  function error(message, code = 'GAME_RULE') {
    return Object.assign(new Error(message), { code });
  }

  // 用房间 UUID 生成可直接分享的邀请码，无需维护房间码索引。
  function invitation(id) {
    const bytes = id.replace(/-/g, '').match(/../g).map((pair) => parseInt(pair, 16));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function roomIdFrom(input) {
    const code = input.trim();
    if (uuid.test(code)) return code.toLowerCase();
    if (/^[A-Za-z0-9_-]{22}$/.test(code)) {
      const text = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '==');
      const hex = Array.from(text, (byte) => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      if (invitation(id) === code) return id;
    }
    throw error('请粘贴好友分享的完整房间码');
  }

  function pointsFor(state, side) {
    if (state.phase !== 'finished' || state.moves.length < 2 || state.winner === null) return 0;
    if (state.winner === 0) return 10;
    return state.winner === side ? 30 : 3;
  }

  function stateOf(room) {
    const state = room.state;
    if (!state || state.type !== roomKind || state.black?.playerId !== room.hostId ||
        !['waiting', 'playing', 'finished'].includes(state.phase) || !Array.isArray(state.moves) ||
        (state.phase === 'playing' && (!state.white?.playerId || state.white.playerId === room.hostId)) ||
        state.moves.length > size * size || new Set(state.moves).size !== state.moves.length ||
        !state.moves.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size) ||
        !Number.isFinite(state.deadline) || ![null, 0, 1, 2].includes(state.winner)) {
      throw error('这间棋室已失效，请返回大厅', 'ROOM_UNAVAILABLE');
    }
    return state;
  }

  function sideOf(state, id) {
    if (state.black.playerId === id) return 1;
    if (state.white?.playerId === id) return 2;
    return null;
  }

  function finished(state, reason, winner) {
    return { ...state, phase: 'finished', reason, winner };
  }

  function view(room, state, id, now) {
    const side = sideOf(state, id);
    if (!side) throw error('你不在这间棋室，请返回大厅', 'ROOM_UNAVAILABLE');
    return {
      ...state,
      roomId: room.id,
      code: invitation(room.id),
      side,
      line: state.reason === 'five' ? outcome(state.moves).line : [],
      delta: pointsFor(state, side),
      revision: room.version,
      seq: room.seq,
      expiresAt: room.expiresAt,
      remainingMs: Math.max(0, state.deadline - now),
    };
  }

  function connect(cloud, now = Date.now) {
    let identity;
    let cachedProfile;

    function playerId() {
      if (!identity) identity = cloud.identity().then((value) => value.playerId).catch((cause) => {
        identity = null;
        throw cause;
      });
      return identity;
    }

    function defaultProfile(id) {
      return { playerId: id, name: `棋友${id.slice(0, 4).toUpperCase()}`, rating: 1000, games: 0, wins: 0 };
    }

    async function readLedger() {
      const id = await playerId();
      const saved = await cloud.storage.getJSON(ledgerKey, null, privateScope);
      return { receipts: {}, ...defaultProfile(id), ...saved, playerId: id };
    }

    async function changeLedger(change) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const meta = await cloud.storage.stat(ledgerKey, privateScope);
        const current = await readLedger();
        const updated = change(current);
        if (updated === current) return current;
        try {
          await cloud.storage.setJSON(ledgerKey, updated, { ...privateScope, expectedVersion: meta ? meta.version : 0 });
          return updated;
        } catch (cause) {
          if (cause.code !== 'CONFLICT') throw cause;
        }
      }
      throw error('积分记录有更新，请稍后重试', 'CONFLICT');
    }

    function remember({ playerId: id, name, rating, games, wins }) {
      cachedProfile = { playerId: id, name, rating, games, wins };
      return cachedProfile;
    }

    async function publish(profile) {
      if (!profile.games) return;
      await cloud.leaderboard.submit(board, profile.rating, {
        name: profile.name, data: { games: profile.games, wins: profile.wins },
      });
    }

    async function profile(name) {
      if (name === undefined) return remember(await readLedger());
      const trimmed = name.trim();
      if (!trimmed || Array.from(trimmed).length > 16 || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
        throw error('昵称需要 1 至 16 个字符');
      }
      const updated = remember(await changeLedger((current) => current.name === trimmed ? current : { ...current, name: trimmed }));
      await publish(updated);
      return updated;
    }

    async function roomProfile() {
      if (cachedProfile) return cachedProfile;
      try {
        return await profile();
      } catch (cause) {
        // 积分存储暂时不可用时仍可以开局，结算会重试。
        console.warn('暂时无法读取棋手资料', cause);
        return defaultProfile(await playerId());
      }
    }

    function rankEntry(item) {
      return { playerId: item.playerId, name: item.name, rating: item.score, games: item.data?.games || 0, wins: item.data?.wins || 0, rank: item.rank };
    }

    async function leaderboard() {
      const list = await cloud.leaderboard.list(board, { limit: 50 });
      return { entries: list.entries.map(rankEntry), self: list.self ? rankEntry(list.self) : await roomProfile() };
    }

    async function settle(result) {
      if (result.keepUntil <= now()) return cachedProfile;
      // 私有存储先记下局号，榜单上传失败时可以用相同总分重试。
      const next = await changeLedger((current) => {
        if (current.receipts[result.roomId]) return current;
        const receipts = Object.fromEntries(Object.entries(current.receipts).filter(([, expires]) => expires > now()));
        receipts[result.roomId] = result.keepUntil;
        return {
          ...current, receipts, rating: current.rating + result.delta,
          games: current.games + 1, wins: current.wins + Number(result.won),
        };
      });
      const updated = remember(next);
      await publish(updated);
      return updated;
    }

    async function create() {
      const black = await roomProfile();
      const initial = {
        type: roomKind, phase: 'waiting', moves: [], black, white: null,
        deadline: now() + waitingTime, winner: null, reason: null,
      };
      const room = await cloud.room.create({ roomName: '落子五子棋', name: black.name, capacity: 2, listed: false, state: initial });
      return view(room, stateOf(room), black.playerId, now());
    }

    async function edit(initial, load, change, id) {
      let room = initial;
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = stateOf(room);
        const next = change(state, room);
        if (next === state) return view(room, state, id, now());
        try {
          room = await cloud.room.update(room.id, next, room.version);
          return view(room, stateOf(room), id, now());
        } catch (cause) {
          if (cause.code !== 'CONFLICT') throw cause;
          room = await load();
        }
      }
      throw error('棋局有新进展，请刷新后再试', 'CONFLICT');
    }

    function expire(state) {
      if (state.phase === 'finished' || state.deadline > now()) return state;
      if (state.phase === 'waiting') return finished(state, 'expired', null);
      return finished(state, 'timeout', 3 - sideAt(state.moves.length));
    }

    async function leaveRoom(roomId) {
      try {
        await cloud.room.leave(roomId);
      } catch (cause) {
        if (!['NOT_FOUND', 'CLOUD_FORBIDDEN'].includes(cause.code)) throw cause;
      }
    }

    async function join(code) {
      const roomId = roomIdFrom(code);
      const player = await roomProfile();
      let room;
      try {
        room = await cloud.room.join(roomId, { name: player.name });
      } catch (cause) {
        if (cause.code === 'CONFLICT') throw error('房间已满，请核对房间码');
        throw cause;
      }
      const id = player.playerId;
      let alreadySeated = false;
      try {
        return await edit(room, () => cloud.room.get(roomId), (state) => {
          if (sideOf(state, id)) { alreadySeated = true; return expire(state); }
          if (state.phase !== 'waiting' || state.deadline <= now()) throw error('房间已开局或已关闭');
          return { ...state, white: player, phase: 'playing', deadline: now() + turnTime };
        }, id);
      } catch (cause) {
        if (!alreadySeated) await leaveRoom(roomId).catch((failure) => console.warn('退出无效棋室失败', failure));
        throw cause;
      }
    }

    async function openRoom(roomId, id) {
      try {
        return await cloud.room.get(roomId);
      } catch (cause) {
        if (cause.code !== 'CLOUD_FORBIDDEN') throw cause;
        const player = await roomProfile();
        const room = await cloud.room.join(roomId, { name: player.name });
        try {
          if (!sideOf(stateOf(room), id)) throw error('你不在这间棋室，请返回大厅', 'ROOM_UNAVAILABLE');
        } catch (failure) {
          await leaveRoom(roomId).catch((closeError) => console.warn('退出无效棋室失败', closeError));
          throw failure;
        }
        return room;
      }
    }

    async function changeRoom(roomId, change) {
      const id = await playerId();
      const load = () => openRoom(roomId, id);
      return edit(await load(), load, (state) => {
        const side = sideOf(state, id);
        if (!side) throw error('你不在这间棋室，请返回大厅', 'ROOM_UNAVAILABLE');
        const current = expire(state);
        if (!change || current.phase === 'finished') return current;
        return change(current, side);
      }, id);
    }

    function move(roomId, cell, ply) {
      return changeRoom(roomId, (state, side) => {
        if (side === sideAt(ply) && cell === state.moves[ply]) return state;
        if (state.phase !== 'playing' || ply !== state.moves.length || side !== sideAt(ply)) {
          throw error('还没有轮到你落子，请刷新棋局');
        }
        if (!Number.isInteger(cell) || cell < 0 || cell >= size * size || state.moves.includes(cell)) {
          throw error('请选择一个空的交叉点');
        }
        const moves = [...state.moves, cell];
        const next = { ...state, moves, deadline: now() + turnTime };
        const result = outcome(moves);
        if (result.winner === null) return next;
        return finished(next, result.winner ? 'five' : 'draw', result.winner);
      });
    }

    function end(roomId) {
      return changeRoom(roomId, (state, side) => state.phase === 'waiting'
        ? finished(state, 'closed', null) : finished(state, 'resign', 3 - side));
    }

    return {
      profile, leaderboard, settle, create, join, get: changeRoom, move, end, leaveRoom,
      subscribe: (roomId, handler, afterSeq) => cloud.room.subscribe(roomId, handler, { afterSeq }),
    };
  }

  function settlement(game) {
    return { roomId: game.roomId, delta: game.delta, won: game.winner === game.side, keepUntil: game.expiresAt + day };
  }

  const online = { connect, settlement };
  if (typeof module !== 'undefined') module.exports = online;
  else root.GomokuOnline = online;
})(typeof self === 'undefined' ? globalThis : self);
