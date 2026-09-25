// 移植自 lxserver src/modules/utils/request.js
// needle 依赖：音源脚本常用的 HTTP 请求库
// 此文件在小程序 Node 服务中使用 needle 7.x+（纯 JS）

const needle = require('needle')

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

const bHh = '624868746c'

const request = (url, options, callback) => {
  let data

  if (options?.body) {
    data = options.body
  } else if (options?.form) {
    data = options.form
    options.json = false
  } else if (options?.formData) {
    data = options.formData
    options.json = false
  }

  options.response_timeout = options?.timeout || 15000
  options.timeout = options?.timeout || 15000

  needle.request(options.method || 'get', url, data, {
    ...options,
    headers: Object.assign({}, defaultHeaders, options?.headers || {}),
    responseTimeout: options?.timeout || 15000,
    json: options?.json !== false
  }, (err, resp, body) => {
    if (!err) {
      body = resp.body
      try {
        if (typeof body === 'string') {
          body = JSON.parse(body)
        }
      } catch (_) {}
    }
    callback(err, resp, body)
  }).on('error', callback)
}

const buildHttpPromise = (url, options) => {
  let requestObj
  let cancelFn = null

  const promise = new Promise((resolve, reject) => {
    cancelFn = reject
    fetchData(url, options?.method, options || {}, (err, resp, body) => {
      if (err) return reject(err)
      resolve({ statusCode: resp.statusCode, headers: resp.headers, body, raw: resp.raw })
    })
  })

  requestObj = {
    promise,
    cancelHttp: () => {
      if (requestObj) {
        try {
          // needle request has abort method
          requestObj.abort?.()
        } catch {}
      }
    }
  }

  return requestObj
}

const fetchData = async (url, method, { headers = {}, format = 'json', timeout = 15000 }) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? require('https') : require('http')

    const req = client.request({
      method: method || 'get',
      headers: Object.assign({}, defaultHeaders, headers),
      timeout: timeout
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          if (format === 'json' && typeof body === 'string') {
            body = JSON.parse(body)
          }
        } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body, raw: res })
      })
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })

    req.end()
  })
}

module.exports = {
  httpFetch: (url, options = { method: 'get' }) => buildHttpPromise(url, options),
  http: (url, options, cb) => {
    if (typeof options === 'function') {
      cb = options
      options = {}
    }
    fetchData(url, options.method, options, (err, resp) => {
      if (err) return cb(err)
      cb(null, resp)
    })
  },
  httpGet: (url, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    fetchData(url, 'get', options, (err, resp) => {
      if (err) return callback(err)
      callback(null, resp)
    })
  },
  httpPost: (url, data, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    fetchData(url, 'post', { ...options, body: data }, (err, resp) => {
      if (err) return callback(err)
      callback(null, resp)
    })
  },
  checkUrl: (url, options = {}) => fetchData(url, 'head', options).then(() => {}, () => false),
  cancelHttp: (requestObj) => requestObj?.cancelHttp?.()
}