# LX Music Web

<div align="center">
  <img src="/music/assets/logo.svg" width="120" height="120" alt="LX Music Logo">
  <br>
  <h1>LX Music Web</h1>
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/hash-{{buildHash}}-%2310b981?style=flat-square" alt="Build Hash">
    <img src="https://img.shields.io/badge/version-{{version}}-blue?style=flat-square" alt="Version">
    <a href="/music/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-orange?style=flat-square" alt="License"></a>
  </p>
</div>

LX Music Sync Server 内置的高性能 Web 播放器，提供原生 App 般的音乐体验。

## ✨ 核心特性

- **现代化界面**: 采用清爽的现代化 UI 设计，支持 Glassmorphism 玻璃拟态效果。
- **多源搜索**: 支持聚合搜索各大音乐平台的资源。
- **歌单同步**: 与 LX Music 客户端数据完美互通，云端同步我的收藏。
- **PWA 支持**: 支持安装为桌面/手机独立应用，离线也能秒开。
- **自定义源**: 支持导入自定义源脚本，无限扩展音乐来源。

## 📱 移动端适配

针对手机端触摸操作进行了深度优化，支持移动端侧边栏、播放详情页手势操作。

## 🔒 隐私安全

支持开启访问密码，保护你的个人音乐隐私。

## 📜 项目协议

本项目基于 Apache License 2.0 许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。

**词语约定**：本协议中的“本项目”指 LX Music Web 播放器；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。

### 一、数据来源

1. **官方平台**: 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据，经过对数据简单地筛选与合并后进行展示(与未登录状态在官方APP获取的数据相同)，因此本项目不对数据的合法性、准确性负责。
2. **音频数据**: 本项目本身没有获取某个音频数据的能力，所使用的在线音频数据来源来自设置内“自定义源”所选择的“源”返回的在线链接。本项目无法校验其准确性，使用过程中可能会出现播放异常。
3. **其他数据**: 本项目的非官方平台数据（例如“我的列表”内列表）来自服务器存储数据，本项目不对这些数据的合法性、准确性负责。

### 二、免责声明

1. **版权数据**: 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。
2. **责任承担**: 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害由使用者负责。
3. **法律法规**: 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。**禁止**在违反当地法律法规的情况下使用本项目。对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担。

### 三、其他

1. **资源使用**: 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。
2. **非商业性质**: 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。
3. **接受协议**: 若你使用了本项目，即代表你接受本协议。

## 🤝 致谢

本项目的 Web 播放器参考了 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) 的设计与实现。

感谢 [lyswhut](https://github.com/lyswhut) 开发了如此优秀的开源音乐软件。

核心接口基于 `musicsdk` 实现。

<div align="center" style="margin-top: 20px;">
  <a href="https://github.com/XCQ0607/lxserver" target="_blank" style="display: inline-block; padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
    <i class="fab fa-github"></i> GitHub 仓库
  </a>
</div>

Copyright © 2026 [xcq0607](https://github.com/xcq0607)
