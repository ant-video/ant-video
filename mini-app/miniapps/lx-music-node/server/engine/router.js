/**
 * LX Music API 路由层
 * 兼容 lxserver 的 /api/music/* 接口
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')
const path = require('path')
const fs = require('fs')

const musicSdkDir = path.join(__dirname, '..', '..', 'vendor', 'musicSdk')
const apiSourcePath = path.join(musicSdkDir, 'api-source.js')

// 动态加载 musicSdk
let musicSdk = null
let sourceRuntime = null

async function ensureLoaded() {
  if (musicSdk) return

  try {
    musicSdk = require(path.join(musicSdkDir, 'index.js')).default
    await musicSdk.init()

    // 加载音源运行时，替换 api-source.js 中的 userApi 调用
    sourceRuntime = require('./source-runtime.js')

    // 覆盖 api-source.js 中的 apis(source) 函数
    const apiSource = require(apiSourcePath)
    apiSource.apis = (source) => {
      return sourceRuntime.getApiForSource(source)
    }
    apiSource.supportQuality = musicSdk.supportQuality || {}
  } catch (e) {
    console.error('[LX Music] musicSdk 初始化失败:', e)
    throw e
  }
}

// 统一响应格式
function jsonResponse(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Origin, X-Requested-With'
  })
  res.end(JSON.stringify(data))
}

// 搜索接口
async function handleSearch(req, res, query) {
  const { name = '', singer = '', source, page = 1, limit = 20 } = query

  if (!name) {
    return jsonResponse(res, 400, { code: 400, message: '搜索关键词不能为空' })
  }

  try {
    await ensureLoaded()

    const results = await musicSdk.searchMusic({
      name,
      singer: singer || undefined,
      source: source || undefined,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10)
    })

    // 归一化响应格式
    const data = results.map(item => ({
      name: item.name || item.song || item.title,
      singer: item.singer || (item.artist ? [item.artist] : []) || [],
      album: item.album,
      duration: item.interval || item.duration,
      source: item.source,
      qualitys: item.qualitys || [],
      url: item.url,
      pic: item.pic || item.album || item.img,
      id: item.id || item.songId || item.hash,
      type: item.type || 'song',
      _raw: item // 保留原始数据，便于后续使用
    }))

    jsonResponse(res, 200, {
      code: 200,
      data: {
        list: data,
        total: data.length,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
      }
    })
  } catch (e) {
    console.error('[LX Music] 搜索失败:', e)
    jsonResponse(res, 500, { code: 500, message: e.message || '搜索失败' })
  }
}

// 取流接口
async function handleMusicUrl(req, res, body) {
  const { source, musicInfo, quality } = body

  if (!source || !musicInfo) {
    return jsonResponse(res, 400, { code: 400, message: '缺少 source 或 musicInfo' })
  }

  try {
    await ensureLoaded()

    // 归一化 musicInfo
    const normalizedInfo = normalizeSongInfo(musicInfo, source)

    // 调用音源运行时
    const api = sourceRuntime.getApiForSource(source)
    if (!api) {
      return jsonResponse(res, 404, {
        code: 404,
        message: `未找到支持 ${source} 平台的音源，请在设置中添加或启用相关源`
      })
    }

    const url = await api.getMusicUrl(normalizedInfo, quality)

    jsonResponse(res, 200, { code: 200, url, data: { url } })
  } catch (e) {
    console.error('[LX Music] 取流失败:', e)
    jsonResponse(res, 500, { code: 500, message: e.message || '取流失败' })
  }
}

// 音源归一化函数
function normalizeSongInfo(info, source) {
  const result = { source }

  // 标准化 ID 字段
  const idFields = ['id', 'songId', 'songmid', 'hash', 'rid', 'musicId', 'copyrightId', 'songid']
  for (const f of idFields) {
    if (info[f]) {
      result[f] = info[f]
      break
    }
  }

  // 标准化歌曲名
  const nameFields = ['name', 'songName', 'title', 'song']
  for (const f of nameFields) {
    if (info[f]) {
      result.name = info[f]
      break
    }
  }

  // 标准化歌手
  result.singer = info.singer || []
  if (Array.isArray(result.singer) && result.singer.length === 1 && result.singer[0].includes('、')) {
    result.singer = result.singer[0].split('、')
  }

  // 专辑
  result.albumName = info.albumName || info.album || ''

  // 封面
  result.pic = info.pic || info.img || ''

  // 质量
  result.qualitys = info.qualitys || info.types || []

  // 区间时长
  result.interval = info.interval || info.duration || 0

  // 额外字段
  if (info.albumId) result.albumId = info.albumId
  if (info.albumMid) result.albumMid = info.albumMid
  if (info.strMediaMid) result.strMediaMid = info.strMediaMid

  // 平台相关
  if (source === 'kg' && info.hash) result.hash = info.hash
  if (source === 'mg' && info.copyrightId) result.copyrightId = info.copyrightId

  return result
}

// 歌词接口
async function handleLyric(req, res, query) {
  const { source, musicInfo: info } = query

  try {
    await ensureLoaded()

    const normalized = normalizeSongInfo(info, source)
    const lyric = await sourceRuntime.getLyric(source, normalized)

    jsonResponse(res, 200, {
      code: 200,
      data: {
        lyric: lyric || '',
        tlyric: null,
        rlyric: null,
        lxlyric: null
      }
    })
  } catch (e) {
    jsonResponse(res, 200, { code: 200, data: { lyric: '', tlyric: null, rlyric: null, lxlyric: null } })
  }
}

// 歌单接口
async function handleSongList(req, res, query) {
  const { id, type = 'list' } = query

  try {
    await ensureLoaded()

    let data = []
    if (type === 'list') {
      data = await musicSdk.songList.list(id)
    } else if (type === 'detail') {
      data = await musicSdk.songList.detail(id)
      data = { info: data, list: [] }
    }

    const list = (data.list || data).map(item => ({
      name: item.name,
      singer: item.singer || [],
      duration: item.interval || 0,
      source: item.source || 'custom',
      pic: item.pic || '',
      id: item.id || item.songId,
      type: 'song',
      _raw: item
    }))

    jsonResponse(res, 200, {
      code: 200,
      data: { list, name: data.name || data.title || '' }
    })
  } catch (e) {
    jsonResponse(res, 500, { code: 500, message: e.message || '获取歌单失败' })
  }
}

// 排行榜接口
async function handleLeaderboard(req, res, query) {
  const { type = 'daily' } = query

  try {
    await ensureLoaded()

    const boards = Object.keys(musicSdk.supportQuality || {})
    const data = await musicSdk.leaderboard.list(type)

    const list = (data || []).map(item => ({
      name: item.name || item.song,
      singer: item.singer || [],
      duration: item.interval || 0,
      source: item.source || 'leaderboard',
      pic: item.pic || '',
      id: item.id,
      type: 'song',
      _raw: item
    }))

    jsonResponse(res, 200, {
      code: 200,
      data: {
        boards,
        list,
        info: { name: type, type }
      }
    })
  } catch (e) {
    jsonResponse(res, 500, { code: 500, message: e.message || '获取排行榜失败' })
  }
}

// 热搜接口
async function handleHotSearch(req, res, query) {
  try {
    await ensureLoaded()

    const data = await Promise.all(
      Object.keys(musicSdk.supportQuality || {}).map(async (source) => {
        try {
          const hot = await musicSdk.hotSearch.search()
          return hot
        } catch {
          return []
        }
      })
    )

    const list = data.flat(10).slice(0, 20).map((item, index) => ({
      name: item.name || item.keyword || '',
      singer: [],
      source: item.source || 'hotSearch',
      type: index < 3 ? 'hot' : 'search'
    }))

    jsonResponse(res, 200, { code: 200, data: list })
  } catch (e) {
    jsonResponse(res, 200, { code: 200, data: [] })
  }
}

// 流代理
function handleStream(req, res, urlObj) {
  const u = urlObj.searchParams.get('u')
  const h = urlObj.searchParams.get('h')
  const range = req.headers.range

  if (!u) {
    return jsonResponse(res, 400, { code: 400, message: '缺少 u 参数' })
  }

  // 安全校验：只允许 http/https，拒绝内网地址
  if (!/^https?:\/\//.test(u)) {
    return jsonResponse(res, 400, { code: 400, message: '只允许 http/https URL' })
  }

  // 检测内网地址
  try {
    const targetHost = new URL(u).host
    if (targetHost.startsWith('127.') || targetHost.startsWith('10.') ||
        targetHost.startsWith('192.168.') || targetHost.startsWith('localhost')) {
      return jsonResponse(res, 403, { code: 403, message: '禁止访问内网地址' })
    }
  } catch (e) {
    return jsonResponse(res, 400, { code: 400, message: '无效 URL' })
  }

  // 解析 headers
  let headersToPass = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  if (h) {
    try {
      const decoded = JSON.parse(Buffer.from(h, 'base64').toString())
      headersToPass = { ...headersToPass, ...decoded }
    } catch {
      // 忽略无效的 headers
    }
  }

  const protocol = u.startsWith('https') ? https : http
  const proxyReq = protocol.request({
    method: 'GET',
    url: u,
    headers: headersToPass,
    headerClass: headersToPass['Referer'] ? { 'Referer': headersToPass['Referer'] } : undefined
  }, (proxyRes) => {
    // 处理 Range 请求
    if (range && proxyRes.headers['accept-ranges'] === 'bytes') {
      res.writeHead(206, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Content-Range': proxyRes.headers['content-range'],
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      })
    } else {
      res.writeHead(200, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      })
    }
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (e) => {
    console.error('[LX Music] 流代理错误:', e)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ error: '代理失败', message: e.message }))
  })

  req.on('error', (e) => {
    console.error('[LX Music] 请求错误:', e)
  })
}

// 音源管理路由
async function handleLxSources(req, res) {
  const sourcesStore = require('./sources-store.js')

  if (req.method === 'GET') {
    const sources = sourcesStore.list()
    jsonResponse(res, 200, { code: 200, data: sources })
  } else if (req.method === 'POST') {
    const sources = sourcesStore.load()
    jsonResponse(res, 200, { code: 200, data: sources })
  }
}

// 统一请求处理器
function handleRequest(req, res, urlObj) {
  const pathname = urlObj.pathname

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' })
    return res.end()
  }

  // 音源管理
  if (pathname.startsWith('/api/lx/sources')) {
    return handleLxSources(req, res)
  }

  // 搜索
  if (pathname === '/api/music/search') {
    const query = Object.fromEntries(urlObj.searchParams)
    return handleSearch(req, res, query)
  }

  // 取流
  if (pathname === '/api/music/url') {
    return handleMusicUrl(req, res, urlObj)
  }

  // 歌词
  if (pathname === '/api/music/lyric') {
    return handleLyric(req, res, Object.fromEntries(urlObj.searchParams))
  }

  // 歌单
  if (pathname.startsWith('/api/music/songList')) {
    return handleSongList(req, res, Object.fromEntries(urlObj.searchParams))
  }

  // 排行榜
  if (pathname === '/api/music/leaderboard') {
    return handleLeaderboard(req, res, Object.fromEntries(urlObj.searchParams))
  }

  // 热搜
  if (pathname === '/api/music/hotSearch') {
    return handleHotSearch(req, res, Object.fromEntries(urlObj.searchParams))
  }

  // 流代理
  if (pathname === '/api/stream') {
    return handleStream(req, res, urlObj)
  }

  // 未实现的接口返回 501
  jsonResponse(res, 501, { code: 501, message: '接口未实现' })
}

module.exports = {
  handleRequest,
  normalizeSongInfo
}