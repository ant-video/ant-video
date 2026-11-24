(function (root) {
  'use strict';

  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const scope = { scope: 'shared' };
  const fail = (message) => Object.assign(new Error(message), { code: 'RULE' });

  function catalog(cloud, namespace, now = Date.now, random = Math.random) {
    const key = namespace + '-public-rooms-v1';
    const cachedCodes = new Map();
    const read = () => cloud.storage.getJSON(key, {}, scope);
    const current = (entry) => entry && entry.deadline > now();

    async function change(update) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const version = await cloud.storage.stat(key, scope);
        const entries = await read();
        const active = Object.fromEntries(Object.entries(entries).filter(([, entry]) => current(entry)));
        const result = update(active);
        if (result === null) return null;
        try {
          await cloud.storage.setJSON(key, active, { ...scope, expectedVersion: version?.version || 0 });
          return result;
        } catch (error) {
          if (error.code !== 'CONFLICT') throw error;
        }
      }
      throw fail('大厅有更新，请稍后重试');
    }

    function encode(index) {
      let code = '';
      for (let digit = 0; digit < 4; digit++) {
        code = alphabet[index % alphabet.length] + code;
        index = Math.floor(index / alphabet.length);
      }
      return code;
    }

    async function publish(id, deadline) {
      const size = alphabet.length ** 4;
      const start = Math.floor(random() * size);
      const code = await change((entries) => {
        const prior = Object.keys(entries).find((code) => entries[code].id === id);
        if (prior) return prior;
        for (let offset = 0; offset < size; offset++) {
          const next = encode((start + offset) % size);
          if (entries[next]) continue;
          entries[next] = { id, deadline };
          return next;
        }
        throw fail('暂时无法分配房间码，请稍后重试');
      });
      cachedCodes.set(id, code);
      return code;
    }

    async function remove(id) {
      await change((entries) => {
        const code = Object.keys(entries).find((code) => entries[code].id === id);
        if (!code) return null;
        delete entries[code];
        return code;
      });
      cachedCodes.delete(id);
    }

    async function codeFor(id) {
      if (cachedCodes.has(id)) return cachedCodes.get(id);
      const entries = await read();
      const code = Object.keys(entries).find((code) => entries[code].id === id && current(entries[code]));
      if (code) cachedCodes.set(id, code);
      return code;
    }

    async function resolve(input, legacy) {
      const code = input.trim().toUpperCase();
      if (code.length !== 4) return legacy(input);
      const entry = (await read())[code];
      if (!current(entry)) throw fail('房间码无效，或房间已开局');
      return entry.id;
    }

    async function list() {
      const [rooms, entries] = await Promise.all([cloud.room.list(), read()]);
      const codes = new Map(Object.keys(entries).filter((code) => current(entries[code])).map((code) => [entries[code].id, code]));
      return rooms.filter((room) => codes.has(room.id) && room.member_count === 1 && room.capacity === 2)
        .map(({ id, name }) => ({ id, name, code: codes.get(id) }));
    }

    return { publish, remove, codeFor, resolve, list };
  }

  function mount({ list, join, visible }) {
    const refresh = document.getElementById('refresh-rooms');
    const status = document.getElementById('rooms-status');
    const rows = document.getElementById('room-list');
    let request;
    let previous;

    function update(rooms) {
      const next = JSON.stringify(rooms);
      if (next === previous) return;
      previous = next;
      const focused = document.activeElement?.dataset.roomId;
      rows.textContent = '';
      for (const room of rooms) {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = room.name + ' · ' + room.code;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.dataset.roomId = room.id;
        button.textContent = '加入';
        button.setAttribute('aria-label', '加入 ' + room.name + ' ' + room.code);
        button.addEventListener('click', () => join(room.id));
        row.append(label, button);
        rows.append(row);
        if (focused === room.id) button.focus();
      }
      if (focused && !rooms.some(({ id }) => id === focused)) refresh.focus();
    }

    function load() {
      if (request || !visible() || document.hidden) return request;
      request = Promise.resolve().then(list).then((rooms) => {
        if (!visible()) return;
        update(rooms);
        status.textContent = rooms.length ? '' : '暂无等待加入的房间';
      }).catch(() => {
        if (!visible()) return;
        update([]);
        status.textContent = '暂时无法加载公开房间，请刷新重试';
      }).finally(() => { request = null; });
      return request;
    }

    refresh.addEventListener('click', load);
    return load;
  }

  const api = { catalog, mount };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PublicRooms = api;
})(typeof self === 'undefined' ? globalThis : self);
