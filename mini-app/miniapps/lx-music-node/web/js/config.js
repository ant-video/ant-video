// 此文件中仅版本号为静态写死值
// 其余配置由服务端在运行时动态注入 (环境变量 > config.js > defaultConfig.ts)
// 服务端拦截 /js/config.js 请求, 读取此处版本号并合并服务端配置后返回
//
// 小程序版：API_BASE 由 boot.js 动态注入 window.__LX_API_BASE__
window.CONFIG = window.CONFIG || {
    buildHash: 'miniapp',
    version: '1.0.0',
};

// 注入 API_BASE（由 boot.js 设置）
if (window.__LX_API_BASE__) {
    window.CONFIG.apiBase = window.__LX_API_BASE__;
}

// 便捷方法
window.CONFIG.request = function(url, opts) {
    var apiBase = window.__LX_API_BASE__ || '/api/music';
    if (url.indexOf('http') !== 0) {
        url = apiBase + '/' + url.replace(/^\//, '');
    }
    return fetch(url, opts);
};