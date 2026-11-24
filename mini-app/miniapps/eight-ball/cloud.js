(function (root) {
  'use strict';

  const day = 86400 * 1000;
  const scope = { scope: 'private' };
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const failure = (message, code = 'RULE') => Object.assign(new Error(message), { code });

  function codeFor(id) {
    const bytes = id.replace(/-/g, '').match(/../g).map((hex) => parseInt(hex, 16));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function roomId(input) {
    const code = input.trim();
    if (uuid.test(code)) return code.toLowerCase();
    if (/^[A-Za-z0-9_-]{22}$/.test(code)) {
      const text = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '==');
      const hex = Array.from(text, (byte) => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
      if (codeFor(id) === code) return id;
    }
    throw failure('请粘贴好友分享的完整房间码');
  }

  function connect(cloud, game, now = Date.now) {
    const tag = `${game.id}-match-v1`;
    const board = `${game.id}-wins-v1`;
    const profileKey = `${game.id}-profile-v1`;
    let identity;
    let cachedPlayer;

    function playerId() {
      if (!identity) identity = cloud.identity().then(({ playerId }) => playerId).catch((error) => {
        identity = null;
        throw error;
      });
      return identity;
    }

    const defaultPlayer = (playerId) => ({ playerId, name: `玩家${playerId.slice(0, 4).toUpperCase()}`, wins: 0, receipts: {} });

    async function readPlayer() {
      const id = await playerId();
      return { ...defaultPlayer(id), ...await cloud.storage.getJSON(profileKey, null, scope), playerId: id };
    }

    async function changePlayer(change) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const meta = await cloud.storage.stat(profileKey, scope);
        const current = await readPlayer();
        const updated = change(current);
        if (updated === current) return current;
        try {
          await cloud.storage.setJSON(profileKey, updated, { ...scope, expectedVersion: meta?.version || 0 });
          return updated;
        } catch (error) {
          if (error.code !== 'CONFLICT') throw error;
        }
      }
      throw failure('玩家记录正在更新，请重试');
    }

    function remember({ playerId, name, wins }) {
      cachedPlayer = { playerId, name, wins };
      return cachedPlayer;
    }

    async function publish(player) {
      if (player.wins) await cloud.leaderboard.submit(board, player.wins, { name: player.name });
    }

    async function profile(name) {
      if (name === undefined) return remember(await readPlayer());
      const trimmed = name.trim();
      if (!trimmed || [...trimmed].length > 16 || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) throw failure('昵称需要 1 至 16 个字符');
      const updated = remember(await changePlayer((player) => player.name === trimmed ? player : { ...player, name: trimmed }));
      await publish(updated);
      return updated;
    }

    async function roomPlayer() {
      if (cachedPlayer) return cachedPlayer;
      try {
        return await profile();
      } catch (error) {
        console.warn('暂时无法读取玩家资料', error);
        return defaultPlayer(await playerId());
      }
    }

    async function recordWin(id, until) {
      if (until <= now()) return null;
      const player = await changePlayer((current) => {
        if (current.receipts[id]) return current;
        const receipts = Object.fromEntries(Object.entries(current.receipts).filter(([, expires]) => expires > now()));
        return { ...current, wins: current.wins + 1, receipts: { ...receipts, [id]: until } };
      });
      const updated = remember(player);
      await publish(updated);
      return updated;
    }

    async function leaderboard() {
      const list = await cloud.leaderboard.list(board, { limit: 50 });
      const format = ({ playerId, name, score, rank }) => ({ playerId, name, wins: score, rank });
      return { entries: list.entries.map(format), self: list.self ? format(list.self) : await roomPlayer() };
    }

    function stateOf(room) {
      const state = room.state;
      if (state?.type !== tag || !Array.isArray(state.players) || state.players.length < 1 || state.players.length > 2 ||
          state.players[0]?.playerId !== room.hostId || !['waiting', 'playing', 'finished'].includes(state.phase) ||
          (state.phase === 'playing' && (state.players.length !== 2 || !game.valid(state.position))) ||
          !Array.isArray(state.acted) || state.acted.length !== 2 ||
          !Number.isFinite(state.deadline)) {
        throw failure('这间房间已失效，请返回大厅', 'ROOM_GONE');
      }
      return state;
    }

    const seat = (state, id) => state.players.findIndex((player) => player.playerId === id);

    function view(room, state, id) {
      const side = seat(state, id);
      if (side < 0) throw failure('你不在这间房间，请返回大厅', 'ROOM_GONE');
      return { ...state, side, roomId: room.id, code: codeFor(room.id), version: room.version, seq: room.seq, until: room.expiresAt + day };
    }

    const finished = (state, reason, winner) => ({ ...state, phase: 'finished', reason, winner });

    function expire(state) {
      if (state.deadline > now()) return state;
      if (state.phase === 'waiting') return finished(state, 'expired', null);
      if (state.phase === 'playing') return finished(state, 'timeout', state.acted.every(Boolean) ? 1 - state.position.turn : null);
      return state;
    }

    async function edit(room, load, change, id) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = stateOf(room);
        const next = change(state);
        if (next === state) return view(room, state, id);
        try {
          const saved = await cloud.room.update(room.id, next, room.version);
          return view(saved, stateOf(saved), id);
        } catch (error) {
          if (error.code !== 'CONFLICT') throw error;
        }
        room = await load();
      }
      throw failure('房间有更新，请稍后重试');
    }

    async function leave(id) {
      try {
        await cloud.room.leave(id);
      } catch (error) {
        if (!['NOT_FOUND', 'CLOUD_FORBIDDEN'].includes(error.code)) throw error;
      }
    }

    async function create() {
      const player = await roomPlayer();
      const state = {
        type: tag, phase: 'waiting', players: [player], position: null, action: null, acted: [false, false],
        deadline: now() + 10 * 60 * 1000, winner: null, reason: null,
      };
      const room = await cloud.room.create({ roomName: game.title, name: player.name, capacity: 2, listed: false, state });
      return view(room, stateOf(room), player.playerId);
    }

    async function join(code) {
      const id = roomId(code);
      const player = await roomPlayer();
      let room;
      try {
        room = await cloud.room.join(id, { name: player.name });
      } catch (error) {
        if (error.code === 'CONFLICT') throw failure('这个房间已经满了');
        throw error;
      }
      let seated = false;
      try {
        return await edit(room, () => cloud.room.get(id), (state) => {
          seated = seat(state, player.playerId) >= 0;
          if (seated) return expire(state);
          if (state.phase !== 'waiting' || state.deadline <= now()) throw failure('房间已经开局或关闭');
          return { ...state, players: [...state.players, player], phase: 'playing', position: game.initial(), deadline: now() + game.turnTime };
        }, player.playerId);
      } catch (error) {
        if (!seated) await leave(id).catch((cause) => console.warn('退出无效房间失败', cause));
        throw error;
      }
    }

    async function loadRoom(id, actor) {
      try {
        return await cloud.room.get(id);
      } catch (error) {
        if (error.code !== 'CLOUD_FORBIDDEN') throw error;
      }
      const player = await roomPlayer();
      const room = await cloud.room.join(id, { name: player.name });
      try {
        if (seat(stateOf(room), actor) < 0) throw failure('你的席位已失效，请返回大厅', 'ROOM_GONE');
      } catch (error) {
        await leave(id).catch((cause) => console.warn('退出无效房间失败', cause));
        throw error;
      }
      return room;
    }

    async function changeRoom(id, change) {
      const actor = await playerId();
      const load = () => loadRoom(id, actor);
      return edit(await load(), load, (current) => {
        const index = seat(current, actor);
        if (index < 0) throw failure('你不在这间房间，请返回大厅', 'ROOM_GONE');
        const state = expire(current);
        return change && state.phase !== 'finished' ? change(state, index) : state;
      }, actor);
    }

    function play(id, ply, action) {
      return changeRoom(id, (state, side) => {
        if (state.phase !== 'playing' || state.position.ply !== ply) return state;
        if (state.position.turn !== side) throw failure('还没有轮到你');
        const position = game.apply(state.position, action);
        const acted = state.acted.map((value, index) => value || index === side);
        const next = { ...state, position, action, acted, deadline: now() + game.turnTime };
        return position.reason ? finished(next, position.reason, position.winner) : next;
      });
    }

    function close(id) {
      return changeRoom(id, (state, side) => {
        if (state.phase === 'waiting') return finished(state, 'closed', null);
        return finished(state, 'resign', state.acted.every(Boolean) ? 1 - side : null);
      });
    }

    return { create, join, get: changeRoom, play, close, leave, profile, leaderboard, recordWin,
      subscribe: (id, handler, afterSeq) => cloud.room.subscribe(id, handler, { afterSeq }) };
  }

  const api = { connect, codeFor, roomId };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DuelCloud = api;
})(typeof self === 'undefined' ? globalThis : self);
