/**
 * 音源持久化存储
 * 使用 ant.storage 的数据（由页面推送），持久化到本地文件
 */

const fs = require('fs')
const path = require('path')

const dataDir = path.join(__dirname, '..', 'data')
const sourcesFile = path.join(dataDir, 'sources.json')

// 确保 data 目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

function load() {
  try {
    if (fs.existsSync(sourcesFile)) {
      const content = fs.readFileSync(sourcesFile, 'utf-8')
      return JSON.parse(content)
    }
  } catch (e) {
    console.error('[LX Music] 加载音源失败:', e)
  }
  return []
}

function save(sources) {
  const data = Array.isArray(sources) ? sources : (sources.sources || [])
  try {
    fs.writeFileSync(sourcesFile, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[LX Music] 保存音源失败:', e)
  }
}

function list() {
  return load()
}

module.exports = {
  load,
  save,
  list
}