/**
 * LX Music Node 服务启动入口
 * 宿主契约：导出 start(config) / stop()
 * 监听 process.env.DEV_HTTP_PORT，绑定 127.0.0.1
 */

const path = require('path')
const fs = require('fs')

let server = null
let started = false

function getPort() {
  return Number(process.env.DEV_HTTP_PORT || '0')
}

function applyConfig(config) {
  const srcDir = path.join(__dirname, 'vendor')
  const dataDir = path.join(__dirname, 'data')

  // 确保 data 目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // 设置运行时环境变量
  process.env.LX_SRC_DIR = srcDir
  process.env.LX_DATA_DIR = dataDir
  process.env.LX_DEBUG = config?.debug ? '1' : '0'

  // 合并配置项到 env
  Object.entries(config || {}).forEach(([key, value]) => {
    if (value != null && value !== '') {
      process.env[key] = String(value)
    } else if (value === null || value === undefined || value === '') {
      delete process.env[key]
    }
  })
}

async function loadEngine() {
  const routerPath = path.join(__dirname, 'engine', 'router.js')
  if (!fs.existsSync(routerPath)) {
    throw new Error('引擎路由未找到：server/engine/router.js')
  }
  // 动态加载，避免热重载时循环依赖
  return require(routerPath)
}

function createHandler(engine) {
  return function(requestHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname

    // 就绪探测
    if (pathname === '/check' || pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, service: 'lx-music-node' }))
    }

    // 代理给引擎
    try {
      engine.handleRequest(req, res, url)
    } catch (e) {
      console.error('[LX Music] 请求处理错误:', e)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
      }
      res.end(JSON.stringify({ error: e.message || 'Internal Server Error' }))
    }
  }
}

module.exports = {
  async start(config) {
    if (started) return

    console.log('[LX Music] 正在启动 Node 服务...')

    applyConfig(config)

    const engine = await loadEngine()
    server = globalThis.catServerFactory
      ? globalThis.catServerFactory(createHandler(engine))
      : createHandler(engine)

    await new Promise((resolve, reject) => {
      server.listen(getPort(), '127.0.0.1', () => {
        const actualPort = server.address().port
        console.log(`[LX Music] 服务已启动：http://127.0.0.1:${actualPort}`)
        resolve()
      })
    })

    started = true
  },

  async stop() {
    if (!started || !server) return

    try {
      await new Promise((resolve) => {
        server.close(() => resolve())
      })
      console.log('[LX Music] 服务已停止')
    } catch (e) {
      console.error('[LX Music] 停止服务出错:', e)
    } finally {
      server = null
      started = false
    }
  }
}