/**
 * LX Music 小程序启动脚本
 * 负责发现 Node 服务地址并注入 API_BASE
 */

const APP_ID = 'com.leospring.lx_music_node'

async function discoverEngine() {
  try {
    // 尝试读取历史记忆
    const savedBase = window.__LX_API_BASE__
    if (savedBase) {
      console.log('[LX Music] 使用历史记忆的 API_BASE:', savedBase)
      return savedBase
    }

    // 通过 miniapp:// 调用自身服务的 /check 接口
    if (window.ant && window.ant.request) {
      const response = await ant.request({
        url: `miniapp://${APP_ID}/check`,
        timeout: 15000
      })

      const realUrl = response?.data?.url || response?.url
      if (realUrl) {
        const baseUrl = realUrl.replace(/\/check$/, '').replace(/\/$/, '')
        console.log('[LX Music] 发现引擎地址:', baseUrl)
        return baseUrl
      }
    }
  } catch (e) {
    console.error('[LX Music] 发现引擎地址失败:', e)
  }
  return null
}

function showApp() {
  document.body.classList.add('lx-app-ready')
}

function showFallback() {
  document.body.classList.add('lx-app-fallback')
  const fallback = document.getElementById('fallback-page')
  if (fallback) {
    fallback.style.display = 'block'
  }
}

async function init() {
  const base = await discoverEngine()

  if (base) {
    window.__LX_API_BASE__ = base
    showApp()
  } else {
    showFallback()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}