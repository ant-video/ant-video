#!/usr/bin/env node

/**
 * LX Music miniapp 构建脚本
 * 使用 Node.js 内置 ES 模块功能打包（不依赖 esbuild）
 *
 * 说明：实际生产环境建议使用 esbuild 或 rollup
 * 这里演示的是纯 Node 方案，适用于快速原型
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createHash } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = __dirname
const DIST_DIR = join(__dirname, 'dist', 'lx-music-node')

// 确保目录存在
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// 递归复制目录
function copyDir(src, dest) {
  if (!existsSync(src)) return

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }

  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isFile() && !entry.name.endsWith('.DS_Store')) {
      copyFileSync(srcPath, destPath)
    }
  }
}

// 简单的 ES module 合并器（仅适用于本项目的 Node 服务）
// 这是一个简化版，用于演示；生产环境请使用 esbuild
function bundleNodeServer(srcDir, outFile) {
  const files = new Map()

  // 收集所有需要打包的文件
  function collectFiles(dir, basePath = '') {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relPath = basePath ? join(basePath, entry.name) : entry.name

      if (entry.isDirectory()) {
        collectFiles(fullPath, relPath)
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        files.set(relPath, readFileSync(fullPath, 'utf-8'))
      }
    }
  }

  collectFiles(join(srcDir, 'server'))
  collectFiles(join(srcDir, 'server', 'engine'))
  collectFiles(join(srcDir, 'server', 'vendor'))
  collectFiles(join(srcDir, 'server', 'data'))

  // 生成 bundle
  const lines = [
    '// LX Music Node 服务 - Bundled version',
    '// Auto-bundled by build-miniapp.mjs (Node native)',
    '',
    'const path = require("path");',
    'const fs = require("fs");',
    'const http = require("http");',
    'const https = require("https");',
    'const crypto = require("crypto");',
    'const { URL } = require("url");',
    'const vm2 = require("vm2");',
    '',
    'const bHh = "624868746c";',
    'const defaultHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" };',
    ''
  ]

  // 合并所有 JS 文件内容
  for (const [relPath, content] of files) {
    lines.push(`// ===== file: ${relPath} =====`)
    lines.push(content)
    lines.push('')
  }

  // 添加主入口
  lines.push(`
// ===== server/index.js 主入口 ======
let server = null;
let started = false;

function getPort() {
  return Number(process.env.DEV_HTTP_PORT || "0");
}

function applyConfig(config) {
  const srcDir = path.join(__dirname, "vendor");
  const dataDir = path.join(__dirname, "data");
  process.env.LX_SRC_DIR = srcDir;
  process.env.LX_DATA_DIR = dataDir;

  Object.entries(config || {}).forEach(([key, value]) => {
    if (value != null && value !== "") {
      process.env[key] = String(value);
    } else if (value === null || value === undefined || value === "") {
      delete process.env[key];
    }
  });
}

async function loadEngine() {
  const routerPath = path.join(__dirname, "engine", "router.js");
  if (!fs.existsSync(routerPath)) {
    throw new Error("引擎路由未找到");
  }
  delete require.cache[require.resolve(routerPath)];
  return require(routerPath);
}

function createHandler(engine) {
  return function(requestHandler(req, res) {
    const url = new URL(req.url, \`http://\${req.headers.host}\`);
    const pathname = url.pathname;

    if (pathname === "/check" || pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ ok: true, service: "lx-music-node" }));
    }

    try {
      engine.handleRequest(req, res, url);
    } catch (e) {
      console.error("[LX Music] 请求处理错误:", e);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: e.message || "Internal Server Error" }));
    }
  });
}

module.exports = {
  async start(config) {
    if (started) return;

    console.log("[LX Music] 正在启动 Node 服务...");
    applyConfig(config);

    const engine = await loadEngine();
    server = globalThis.catServerFactory
      ? globalThis.catServerFactory(createHandler(engine))
      : createHandler(engine);

    await new Promise((resolve, reject) => {
      server.listen(getPort(), "127.0.0.1", () => {
        const actualPort = server.address().port;
        console.log(\`[LX Music] 服务已启动：http://127.0.0.1:\${actualPort}\`);
        resolve();
      });
      server.on("error", reject);
    });

    started = true;
  },

  async stop() {
    if (!started || !server) return;
    try {
      await new Promise((resolve) => server.close(resolve));
      console.log("[LX Music] 服务已停止");
    } catch (e) {
      console.error("[LX Music] 停止服务出错:", e);
    } finally {
      server = null;
      started = false;
    }
  }
};
`)

  // 写入文件
  writeFileSync(outFile, lines.join('\n'))
  console.log(`[LX Music] 已生成 bundle: ${outFile}`)
}

console.log('[LX Music] 开始构建...')

// 步骤 1: 确保 dist 目录结构
ensureDir(join(DIST_DIR, 'server'))
ensureDir(join(DIST_DIR, 'web'))

// 步骤 2: 打包 Node 服务
try {
  bundleNodeServer(ROOT_DIR, join(DIST_DIR, 'server', 'index.js'))
  console.log('[LX Music] ✓ Node 服务已打包')
} catch (e) {
  console.error('[LX Music] 打包 Node 服务失败:', e)
  process.exit(1)
}

// 步骤 3: 复制 index.config.js
copyFileSync(
  join(ROOT_DIR, 'server', 'index.config.js'),
  join(DIST_DIR, 'server', 'index.config.js')
)
console.log('[LX Music] ✓ index.config.js 已复制')

// 步骤 4: 复制 vendor 目录
copyDir(
  join(ROOT_DIR, 'server', 'vendor'),
  join(DIST_DIR, 'server', 'vendor')
)
console.log('[LX Music] ✓ vendor 目录已复制')

// 步骤 5: 复制 data 目录
ensureDir(join(DIST_DIR, 'server', 'data'))

// 步骤 6: 复制 web 目录（前端）
copyDir(
  join(ROOT_DIR, 'web'),
  join(DIST_DIR, 'web')
)
console.log('[LX Music] ✓ web 目录已复制')

// 步骤 7: 复制 manifest.json
copyFileSync(
  join(ROOT_DIR, 'manifest.json'),
  join(DIST_DIR, 'manifest.json')
)
console.log('[LX Music] ✓ manifest.json 已复制')

console.log('[LX Music] 构建完成！')
console.log('[LX Music] 输出目录:', DIST_DIR)

// 输出统计
function getStats(dir) {
  let totalSize = 0
  let totalFiles = 0
  let totalJsSize = 0

  function walk(currentDir) {
    if (!existsSync(currentDir)) return
    const entries = readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        const size = statSync(fullPath).size
        totalSize += size
        totalFiles++
        if (fullPath.endsWith('.js')) totalJsSize += size
      }
    }
  }
  walk(dir)
  return { totalSize, totalFiles, totalJsSize }
}

const stats = getStats(DIST_DIR)

console.log(`📦 包大小: ${(stats.totalSize / 1024).toFixed(1)} KB`)
console.log(`📄 文件数: ${stats.totalFiles}`)
console.log(`📝 JS 总计: ${(stats.totalJsSize / 1024).toFixed(1)} KB`)