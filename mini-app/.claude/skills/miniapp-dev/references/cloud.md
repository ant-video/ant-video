# 联网数据、排行榜与多人游戏（SDK 9）

本参考随 skill 分发，独立项目可直接使用。SDK 8 提供 `ant.cloud` 联网数据、排行榜和房间，
SDK 9 增加 `ant.cloud.call` 业务云函数。按具体方法是否存在检测能力。

## 目录

- [接入与身份](#接入与身份)
- [共享配置与文件](#共享配置与文件)
- [全网排行榜](#全网排行榜)
- [多人房间与恢复](#多人房间与恢复)
- [业务云函数与画猜计分](#业务云函数与画猜计分)
- [浏览器联调与安装验收](#浏览器联调与安装验收)
- [错误处理](#错误处理)

## 接入与身份

```json
{
  "appId": "com.example.party",
  "name": "联网派对",
  "versionCode": 1,
  "entry": "index.html",
  "permissions": ["ui", "storage", "cloud"]
}
```

宿主统一提供联网服务并管理玩家身份。小程序声明 `cloud` 即可调用，应用身份由宿主确定。
开发者使用公开 JSAPI，无需用户配对同步密钥，也无需在小程序中配置数据库、访问令牌或服务端密钥。
具体业务调用须由当前宿主为该小程序提供，能力不可用时提示用户联系宿主维护者。
`cloud` 不依赖 `network` 权限或其 allowlist。

```js
if (!ant.cloud || typeof ant.cloud.identity !== 'function') {
  throw new Error('请升级到支持联网能力的宿主');
}
const { playerId } = await ant.cloud.identity();
```

`playerId` 在同一安装、同一 appId 下稳定，不同 appId 的标识不同。
它代表设备安装身份，多台设备不会自动合并为同一玩家账号。
`ant.storage` / `ant.file` 是本地私有数据，`ant.cloud.storage` / `ant.cloud.file` 是联网数据。

包内页面与 HTTPS 在线入口支持 cloud。联网调用及事件只提供给入口同源的顶层页面。
宿主调试模式使用固定 appId `dev.playground`，数据和云函数注册也按此命名空间隔离。
正式应用的云函数验收应导入该 appId 的安装包。

## 共享配置与文件

默认 `scope: 'shared'`，同一 appId 的所有设备可读写。
`scope: 'private'` 按当前设备安装隔离，不提供跨设备账号存档。
共享数据适合公共地图和协作配置。游戏答案和权威积分通过宿主提供的业务 API 访问。

```js
await ant.cloud.storage.setJSON('world', { map: 'island' });
const world = await ant.cloud.storage.getJSON('world', {});
await ant.cloud.storage.setJSON('save', { level: 3 }, { scope: 'private' });
const save = await ant.cloud.storage.getJSON('save', {}, { scope: 'private' });

await ant.cloud.file.write('maps/island.json', JSON.stringify(world));
const text = await ant.cloud.file.read('maps/island.json');
const files = await ant.cloud.file.list('maps');
await ant.cloud.file.write('cover.png', imageBase64, { encoding: 'base64' });
```

| 方法 | 返回与选项 |
|---|---|
| `storage.get(key, options?)` | 字符串，缺失返回 `null` |
| `storage.set(key, value, options?)` | 值按 `String(value)` 存储，返回 `null` |
| `storage.getJSON(key, fallback, options?)` | 解析 JSON，缺失或解析失败返回 fallback |
| `storage.setJSON(key, value, options?)` | JSON 序列化后存储 |
| `storage.keys(options?)` | 配置键数组 |
| `storage.remove(key, options?)` | 删除配置 |
| `storage.stat(key, options?)` | 元数据或 `null` |
| `file.write(path, content, options?)` | 写入并返回元数据 |
| `file.read(path, options?)` | 返回字符串，缺失报 `NOT_FOUND` |
| `file.stat(path, options?)` | 元数据或 `null` |
| `file.list(directory?, options?)` | 目录前缀下全部文件的元数据数组，省略目录列全部文件 |
| `file.delete(path, options?)` | 删除单个文件 |

所有 options 可传 scope。file 的读写还可传 `encoding: 'text' | 'base64'`，默认 text。
云文件只有相对路径，没有 `mkdir`、`rename`、`append` 接口。
元数据为 `{ path, size, version, modifiedAt }`，size 为字节数，modifiedAt 为毫秒时间戳。

多设备写同一条目时，写入或删除可传 `expectedVersion`，非负整数，0 表示要求不存在。
服务器以事务检查版本，不匹配报 `CONFLICT`。省略版本时后完成的写入覆盖同名内容。

```js
const meta = await ant.cloud.storage.stat('world');
try {
  await ant.cloud.storage.setJSON('world', nextWorld, {
    expectedVersion: meta ? meta.version : 0
  });
} catch (error) {
  if (error.code !== 'CONFLICT') throw error;
  // 重新读取当前值，交给业务合并或提示用户重新编辑。
  const latest = await ant.cloud.storage.getJSON('world', {});
  showMergeDialog(latest, nextWorld);
}
```

| 限制 | 配置 | 文件 |
|---|---|---|
| 键或路径 | 最长 256 字符 | 最长 512 字符，`/` 分隔相对路径，禁止空段、`.`、`..`、反斜杠 |
| 单项 | 256 KiB | 5 MiB |
| 每个 appId 共享范围 | 1 MiB / 512 项 | 20 MiB / 512 文件 |

每台安装的 private 范围单独使用相同配额。大小按实际 UTF-8 或 Base64 解码后的字节计算。

## 全网排行榜

```js
await ant.cloud.leaderboard.submit('season-1', 1200, {
  name: '玩家甲', data: { level: 8 }
});
const ranking = await ant.cloud.leaderboard.list('season-1', { limit: 20, offset: 0 });
// { entries: [{ rank, playerId, name, score, data, updatedAt }], self, total, order }
```

榜单按 appId + board 隔离，每个安装每榜一条记录。
submit 返回榜单结果，默认 `order: 'desc'` 保留最高分。
耗时榜首次提交用 `order: 'asc'`，以后保留最低值，榜单方向创建后固定。
board 长度 1–80，显示名 1–32，score 为 [-1e15, 1e15] 内的有限数值，
data JSON 最大 4096 字节。分页 limit 为 1–100、默认 20，offset 为 0–100000。

通用 submit 接收客户端上报成绩。需要服务端验证胜负与累积积分的游戏，用业务云函数
完成动作验证、事务计分和榜单查询，并维护专用积分表。

## 多人房间与恢复

```js
// 设备 A 创建并加入。
const created = await ant.cloud.room.create({
  roomName: '双人对局', name: '玩家甲', capacity: 2,
  state: { turn: 0, board: [] }, listed: true
});

// 设备 B 从列表选中一个房间，或输入分享得到的 roomId。
const rooms = await ant.cloud.room.list();
const joined = await ant.cloud.room.join(roomId, { name: '玩家乙' });
```

`create`、`join`、`get`、`update`、`send` 返回房间快照。
快照为 `{ id, name, capacity, state, version, seq, hostId, expiresAt, members }`，
members 为 `[{ playerId, name }]`。
`list()` 返回最近 50 个公开、有效且有成员的房间，列表字段为
`{ id, name, capacity, created_at, member_count }`。非公开房间凭 ID 加入。

```js
let lastSeq = 0;
let stopWatching;
async function watchRoom(roomId) {
  stopWatching = await ant.cloud.room.subscribe(roomId, event => {
    if (event.type === 'snapshot') {
      renderGame(event.room.state);
      if (event.resync) discardPendingAnimations();
    }
    if (event.type === 'presence') renderPlayers(event.members);
    if (event.type === 'message') {
      handleMessage(event.playerId, event.data.event, event.data.data);
    }
    if (Number.isInteger(event.seq)) lastSeq = Math.max(lastSeq, event.seq);
    if (event.type === 'error') showError(event.message);
  }, { afterSeq: lastSeq });
}

await watchRoom(roomId);
await ant.cloud.room.send(roomId, 'move', { x: 1, y: 2 });
const current = await ant.cloud.room.get(roomId);
await ant.cloud.room.update(roomId, nextState, current.version);
// update 必须传版本，CONFLICT 时重读并由业务决定如何处理。

// 退出房间时先停订阅，再离开。
await stopWatching();
await ant.cloud.room.leave(roomId);
```

subscribe 返回 Promise，resolve 的值是异步取消函数，必须 await 后再保存和调用。
订阅使用实时通知触发增量读取，每 5 秒补读并续期心跳。
回调先收到最新 snapshot，再收到按 seq 递增的 `message`、`state`、`members` 历史事件，
成员列表改变时另发 `presence`，失败发带 code/message 的 `error`。
不要用较早事件覆盖 snapshot 中更晚的状态。
每房仅保留最近 256 条事件，落后时 snapshot 带 `resync: true`，必须恢复快照。
完整画布或棋盘应有可恢复的状态，不能只依赖短期笔画或走子消息。

容量 2–32、默认 8，状态最大 64 KiB，消息 data 最大 8 KiB，event 名最长 80 字符。
成员 90 秒无心跳后需重新 join，房间 24 小时到期。
每个安装最多创建 10 个有效房间，每个小程序实例最多同时订阅 8 个房间。
文档导航及实例终止会关闭宿主监听，页面自身切换业务房间时也要调用取消函数。
应合并笔画点、控制发送频率，并处理断线与补读延迟。

通用房间的所有成员均可发送消息和按版本更新状态，hostId 不自动赋予游戏规则权限。
隐藏答案、限定画手、验证回合及胜负时使用业务云函数。

## 业务云函数与画猜计分

```js
if (typeof ant.cloud.call !== 'function') throw new Error('需要 SDK 9');
const result = await ant.cloud.call('game', {
  action: 'guess',
  options: { roomId, turnId, text: '西瓜', requestId }
});
```

函数名和参数结构以宿主提供的业务调用约定为准，上例是画猜的调用方式，
其他 appId 不一定具备 game 能力。data 必须为不超过 64 KiB 的 JSON 对象。
宿主管理调用身份，小程序处理返回结果和带 code/message 的调用错误。
`BUSINESS_ERROR` 表示业务请求未被接受，可向用户展示返回的提示。

画猜通过 game 能力获取当前玩家可见的游戏状态、提交画布和猜词、查询累计积分榜。
前端应使用返回的权威积分及回合结果，按公开的玩家视图渲染答案或提示。
对需要 requestId 的动作，重试时复用同一标识，避免重复处理。
实时事件用于提示状态变化和更新画布，断线恢复后重新读取当前游戏状态。

本参考面向小程序开发者，仅介绍 JSAPI 调用契约。宿主内部的数据库结构、
业务处理器实现、部署脚本和运维流程由宿主项目管理，不随公开小程序或技能分发。

## 浏览器联调与安装验收

mock 不会自动连接宿主联网服务。先于 `ant-mock.js` 加载业务适配器，方法结构与 ant.cloud 相同。
可使用固定测试数据做页面交互，也可接入本地测试后端做双浏览器联调。
适配器应只在预览环境加载。

```html
<script>
window.__antMockPermissions = ['ui', 'storage', 'cloud'];
window.__antMockCloud = {
  identity: async () => ({ playerId: 'preview-player-a' }),
  call: async (name, data) => {
    const response = await fetch('./preview-api/' + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('预览服务请求失败');
    return response.json();
  }
};
</script>
<script src="./ant-mock.js"></script>
```

仅实现要用的方法即可，未提供的方法报 `CLOUD_UNAVAILABLE`。
storage 的 getJSON/setJSON 也由适配器提供，room.subscribe 必须返回取消函数。
mock 直接转发参数、返回值和业务错误，所有云方法都检查 cloud 权限。
上例的 preview-api 是需要自己实现的测试路由，不会由静态 HTTP 服务生成。

验收先跑 skill 的预检和打包，再在两台宿主设备安装同一 appId 的 zip。
检查共享读写、private 隔离、加入/离开、消息与快照恢复、断线重连、刷新和重复提交。
对画猜等计分游戏，还要验证猜手拿不到答案、非当前画手不能提交画布、重复请求不加分，
并在两台设备核对同一份服务端排行榜。

## 错误处理

| code | 处理 |
|---|---|
| `PERMISSION_DENIED` | manifest 声明 cloud，并用安装包验证 |
| `CLOUD_UNAVAILABLE` | 宿主联网能力不可用，或 mock 未配置对应适配器 |
| `CLOUD_NOT_DEPLOYED` | 宿主尚未提供所需联网能力，联系宿主维护者 |
| `CLOUD_FORBIDDEN` | 检查设备登记/停用状态，房间成员过期时重新加入 |
| `BUSINESS_ERROR` | 展示业务提示，核对调用名称、参数及当前游戏状态 |
| `CONFLICT` | 重读后合并或重试，避免无条件覆盖 |
| `NOT_FOUND` | 条目/房间不存在，恢复选择或创建流程 |
| `ENTRY_TOO_LARGE` / `QUOTA_EXCEEDED` | 缩小数据或清理旧条目/订阅 |
| `INVALID_PARAMS` | 检查字段类型、长度、版本和大小限制 |
| `CLOUD_DEVICE_ERROR` | 宿主设备会话建立失败，查看宿主日志 |
| `CLOUD_TIMEOUT` / `CLOUD_NETWORK_ERROR` / `CLOUD_ERROR` | 显示离线状态、提供重试，写入须考虑幂等 |
