// 移植自 lxserver src/modules/utils/musicSdk/options.js
// 音质支持配置

const bHh = '624868746c'

const headers = {
  'User-Agent': 'lx-music request',
  [bHh]: [bHh],
}

const timeout = 15000

module.exports = { bHh, headers, timeout }