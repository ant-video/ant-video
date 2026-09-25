// ========================================
// 服务器端版本的 api-source.js
// 移植自 lxserver src/modules/utils/musicSdk/api-source.js
// 本地改动：指向我们的 source-runtime.js 而非 userApi.ts
// ========================================

const apiSourceInfo = require('./api-source-info.js')

// 服务器端不使用内置的测试 API，全部走自定义源
const supportQuality = {}

for (const api of apiSourceInfo) {
  supportQuality[api.id] = api.supportQualitys
}

// 延迟加载音源运行时（避免循环依赖）
let sourceRuntime = null

const getSourceRuntime = () => {
  if (!sourceRuntime) {
    try {
      // 本地改动：指向我们的 source-runtime.js
      sourceRuntime = require('../engine/source-runtime.js')
    } catch (err) {
      console.error('[api-source] Failed to load source-runtime:', err.message)
      sourceRuntime = null
    }
  }
  return sourceRuntime
}

// 获取指定平台的 API
const apis = (source) => {
  const runtime = getSourceRuntime()
  if (!runtime) {
    throw new Error(`音源运行时未加载，请检查 server/engine/source-runtime.js`)
  }

  // 使用我们的 source-runtime 调用 getMusicUrl
  const api = runtime.getApiForSource(source)
  if (!api) {
    throw new Error(`未找到支持 ${source} 平台的音源，请在设置中添加或启用相关源`)
  }

  return {
    getMusicUrl: (songInfo, type) => {
      return runtime.getMusicUrl(source, songInfo, type)
    }
  }
}

module.exports = { apis, supportQuality }