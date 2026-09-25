// 移植自 lxserver src/modules/utils/message.js
// 错误消息常量

const requestMsg = {
  cancelRequest: '请求被取消',
  unachievable: '无法获取资源',
  timeout: '请求超时',
  notConnectNetwork: '无法连接网络',
  unLogin: '请先登录',
  invalid: '无效的请求',
  error: '网络错误'
}

module.exports = { requestMsg }