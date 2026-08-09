

# 蚂蚁影视

跨平台影音娱乐应用，支持 Android、iOS、macOS、Windows。

## 功能概览

| 模块 | 说明 |
|------|------|
| 影视 | 多源视频播放，支持 CMS/T3 JS/Python/JAR 数据源 |
| 音乐 | 多音源播放，歌词显示，歌单管理，插件扩展 |
| 阅读 | 兼容 Legado 书源（搜索/目录/正文/分页/付费解锁），6种翻页动画，TTS朗读，有声书 |
| 漫画 | 漫画阅读，收藏/历史，下载管理 |
| 磁力 | BitTorrent 边下边播，下载管理 |
| 直播 | IPTV 直播，支持 Xtream Codes API 和 M3U |
| TV | Android TV 适配，焦点导航，DLNA投屏 |

### 影视数据源支持

| 类型 | 说明 | 平台支持 | 版本 |
|------|------|---------|------|
| **CMS (type 0/1)** | 传统 CMS 接口 | 全平台 | v1.0+ |
| **T3 Spider (type 3)** | JS/Python 爬虫，支持加密/Cookie 管理 | 全平台 | v1.0+ |
| **T3 JAR Spider (type 3)** | `api` 为 `csp_` 的 Android 原生 Java 爬虫(兼容 FongMi/TVBox) | 仅 Android | v1.0.11+ |

**Python 爬虫特性** (全平台):
- 内置 Python
- 预装常用库: flask / requests / httpx / lxml / beautifulsoup4 / pycryptodome
- 支持自定义 Python 源编写和调试

## 核心特性

- 双播放引擎（MediaKit/MPV + FVP/MDK），可切换
- HLS/M3U8 代理，智能广告过滤（5种检测策略）
- 多站点并发搜索，结果聚合
- 弹幕系统，样式定制
- 主题定制（浅色/深色/动态取色/自定义背景）
- 内置脚本编辑器（Monaco），支持 Spider 源编写和测试
- 动态氛围背景（粒子效果、Ken Burns 动画）
- 🆕 原生 JAR 爬虫支持(Android，兼容 FongMi/TVBox 生态)
- 🆕 跨平台 Python 爬虫

**阅读模块当前 Legado 兼容范围**:
- 支持 `searchUrl` / `ruleSearch.url`、`checkKeyWord`、`@jsoup:`、增强 JSONPath、`webJs`、`sourceRegex`
- 支持 `nextTocUrl` / `nextContentUrl` 分页目录与正文、Legado URL 请求配置（`url,{method,body,headers}`）
- 支持 `header` 变量替换、`enabledCookieJar`、`loginCheckJs` 基础校验、`payAction` 解锁跳转
- 支持 `imageStyle` 的文本占位兼容，以及分页图片相对路径按当前页解析
- 详情页与阅读页之间复用已加载章节列表，并为传统书源目录增加会话级缓存，避免重复整本解析

关注频道：[Ant Video](https://t.me/ant_video)
