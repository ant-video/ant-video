// 浏览器 mock 的云适配器契约。仅依赖 Node.js 内置模块。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../assets/ant-mock.js'), 'utf8');
function load(permissions, adapter, existingAnt) {
  const window = {
    __antMockPermissions: permissions,
    __antMockCloud: adapter,
    ant: existingAnt,
    addEventListener() {}
  };
  vm.runInNewContext(source, {
    window,
    document: { addEventListener() {} },
    console: { info() {} }
  });
  return window.ant;
}

function methods(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => {
    const name = prefix + key;
    return typeof value === 'function'
      ? [[name, value]] : methods(value, name + '.');
  });
}

test('所有云入口都检查 cloud 权限，拒绝时不调用适配器', async () => {
  let calls = 0;
  const ant = load([], { call() { calls++; } });
  for (const [name, method] of methods(ant.cloud)) {
    await assert.rejects(method(), { code: 'PERMISSION_DENIED' }, name);
  }
  assert.equal(calls, 0);
});

test('未配置的云方法明确拒绝，不产生本地共享数据', async () => {
  for (const [name, method] of methods(load(['cloud']).cloud)) {
    await assert.rejects(method(), { code: 'CLOUD_UNAVAILABLE' }, name);
  }
});

test('嵌套方法保留参数、所属对象、返回值和错误', async () => {
  const result = { path: 'maps/a.json', version: 7 };
  const options = { scope: 'private', expectedVersion: 6 };
  const businessError = Object.assign(new Error('回合结束'), { code: 'BUSINESS_ERROR' });
  const adapter = {
    storage: {
      writeCount: 0,
      setJSON(key, data, receivedOptions) {
        this.writeCount++;
        assert.equal(key, 'world');
        assert.deepEqual(data, { map: 'island' });
        assert.equal(receivedOptions, options);
        return result;
      },
      get() { throw businessError; },
      remove() { return Promise.reject(businessError); }
    }
  };
  const ant = load(['cloud'], adapter);
  assert.equal(await ant.cloud.storage.setJSON('world', { map: 'island' }, options), result);
  assert.equal(adapter.storage.writeCount, 1);
  await assert.rejects(ant.cloud.storage.get('world'), error => error === businessError);
  await assert.rejects(ant.cloud.storage.remove('world'), error => error === businessError);
});

test('房间订阅传递事件回调和异步取消函数', async () => {
  let active;
  let closed = false;
  const received = [];
  const event = { type: 'snapshot', room: { seq: 12, state: {} } };
  const ant = load(['cloud'], {
    room: {
      async subscribe(id, handler, options) {
        assert.equal(id, 'room-a');
        assert.equal(options.afterSeq, 10);
        active = handler;
        handler(event);
        return async () => { active = null; closed = true; };
      }
    }
  });
  const stop = await ant.cloud.room.subscribe('room-a', item => received.push(item), { afterSeq: 10 });
  assert.equal(received[0], event);
  assert.equal(typeof active, 'function');
  await stop();
  assert.equal(active, null);
  assert.equal(closed, true);
});

test('进入宿主时保留注入的真实 SDK', () => {
  const hostAnt = { version: 9, cloud: { identity() {} } };
  assert.equal(load([], {}, hostAnt), hostAnt);
});
