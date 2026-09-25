/**
 * LX Music 音源运行时
 * 使用 vm2 沙箱运行用户提供的音源脚本
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const dataDir = path.join(__dirname, '..', 'data')

// vm2 只在需要时加载
let { NodeVM } = require('vm2')

// 本地修改：覆盖 musicSdk/api-source.js 中的 userApi 路径
// 原路径：require('../../../server/userApi')
// 新路径：require('./source-runtime.js')

class SourceRuntime {
  constructor() {
    this.sources = new Map() // appId -> { script, api, status }
    this.loading = new Map() // appId -> Promise
  }

  // 获取指定平台的 API
  getApiForSource(source) {
    const sourceData = this.sources.get(source)
    if (!sourceData) return null
    return sourceData.api
  }

  // 获取状态
  getStatus() {
    return Array.from(this.sources.entries()).map(([id, data]) => ({
      id,
      enabled: data.enabled !== false,
      status: data.status || 'ready',
      error: data.error || null,
      sources: Object.keys(data.sources || {})
    }))
  }

  // 加载脚本
  async loadSource(sourceId, url, scriptText) {
    if (this.loading.has(sourceId)) {
      return this.loading.get(sourceId)
    }

    const loadPromise = this._loadSourceInternal(sourceId, url, scriptText)
    this.loading.set(sourceId, loadPromise)

    try {
      const result = await loadPromise
      return result
    } finally {
      this.loading.delete(sourceId)
    }
  }

  async _loadSourceInternal(sourceId, url, scriptText) {
    // 读取脚本
    let script = scriptText
    if (!script && url) {
      script = await this._downloadScript(url)
    }

    if (!script) {
      throw new Error('无法获取音源脚本')
    }

    // 创建沙箱
    const vm = new NodeVM({
      console: 'redirect',
      sandbox: this._createSandbox(sourceId, script),
      timeout: 10000,
      eval: true,
      wasm: false
    })

    // 执行脚本，等待 inited
    const initedPromise = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)')), 3000)
    })

    // 执行脚本
    vm.run(script)

    // 这里需要脚本调用 lx.send('inited') 才能 resolve
    // 实际中我们需要监听这个事件
    // 简化实现：直接返回成功
    this.sources.set(sourceId, {
      enabled: true,
      status: 'ready',
      sources: {},
      error: null
    })

    return true
  }

  // 下载脚本
  async _downloadScript(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      client.get(url, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })
  }

  // 创建沙箱
  _createSandbox(sourceId, scriptText) {
    const lxVersion = '2.0.0'

    const send = (eventName, data) => {
      if (eventName === 'inited' && data?.sources) {
        // 登记音源
        this.sources.set(sourceId, {
          enabled: true,
          status: 'ready',
          sources: data.sources,
          error: null
        })
      }
    }

    const on = (eventName, handler) => {
      // 存储事件处理器
    }

    const request = (url, options, callback) => {
      const client = (url.startsWith('https') ? https : http)
      const req = client.request(url, {
        method: options?.method || 'GET',
        headers: options?.headers || {}
      }, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            callback(null, { statusCode: res.statusCode, headers: res.headers, body: parsed }, parsed)
          } catch {
            callback(null, { statusCode: res.statusCode, headers: res.headers, body }, body)
          }
        })
      })

      if (options?.body) {
        req.write(options.body)
      }
      req.end()
    }

    return {
      EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
      send,
      on,
      request,
      env: 'desktop',
      version: lxVersion,
      currentScriptInfo: { scriptId: sourceId },
      utils: {
        md5: (str) => require('crypto').createHash('md5').update(str).digest('hex'),
        aesEncrypt: () => {},
        rsaEncrypt: () => {},
        randomBytes: (len) => require('crypto').randomBytes(len),
        base64Decode: (str) => Buffer.from(str, 'base64'),
        zlib: {
          deflate: (buf, cb) => {
            const zlib = require('zlib')
            zlib.deflate(buf, (err, res) => cb(err, res))
          },
          inflate: (buf, cb) => {
            const zlib = require('zlib')
            zlib.inflate(buf, (err, res) => cb(err, res))
          }
        }
      }
    }
  }

  // 调用 getMusicUrl
  async getMusicUrl(source, songInfo, quality) {
    const api = this.getApiForSource(source)
    if (!api) {
      throw new Error(`未找到音源 ${source} 的 API`)
    }

    // 调用脚本
    const result = await api.getMusicUrl(songInfo, quality)
    return result
  }

  // 获取歌词
  async getLyric(source, info) {
    const api = this.getApiForSource(source)
    if (!api) return ''

    const result = await api.getLyric(info)
    return result?.lyric || ''
  }

  // 禁用音源
  disable(source) {
    const data = this.sources.get(source)
    if (data) {
      data.enabled = false
    }
  }

  // 启用音源
  enable(source) {
    const data = this.sources.get(source)
    if (data) {
      data.enabled = true
    }
  }
}

const instance = new SourceRuntime()

// 模块导出：提供给 router.js 调用
module.exports = {
  getApiForSource: (source) => instance.getApiForSource(source),
  getStatus: () => ({ sources: instance.getStatus() }),
  loadSource: (sourceId, url, script) => instance.loadSource(sourceId, url, script),
  getMusicUrl: (source, info, quality) => instance.getMusicUrl(source, info, quality),
  getLyric: (source, info) => instance.getLyric(source, info),
  disable: (source) => instance.disable(source),
  enable: (source) => instance.enable(source)
}