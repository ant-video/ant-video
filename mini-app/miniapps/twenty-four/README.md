# 24点对决

用四张 1 到 13 的数字牌算出 24。每张牌都要用一次，允许加、减、乘、除和括号，中间结果可以是分数。题目生成后会确认有解。

- **离线练习**可换题、撤销、清空和查看一种解法。宿主保存练习算式。
- **好友对战**为双人五题连赛。每题限时 75 秒，先提交正确算式的一方得 1 分，超时无人得分。每题结束可查看获胜算式，任一方都可以进入下一题。五题答对较多的一方赢下本场。
- **好友胜场榜**展示前 50 名。获胜端同步本场胜场，断线后可重试。同一场对局只登记一次。
- **控制**用触屏、鼠标或宿主遥控器选择牌、运算符和按钮。刷新或重开时可恢复联网房间和当前算式。

新建房间会显示在联机大厅。其他玩家可以直接点击「加入」，也可以输入 4 位房间码。房间开局、关闭或过期后会从等待列表移除。

## 安装与验证

在已开通小程序联网能力的蚂蚁影视中，打开「小程序 → + → 导入 zip 包」，选择 [twenty-four-v2.zip](../../market/zip/twenty-four-v2.zip)。

两端安装相同的小程序 ID `com.leospring.twentyfour`，创建房间后将房间码发给好友。应用复用 SDK 8 的房间、设备身份、私有云存储和通用排行榜，安装后即可使用宿主现有的联网服务。胜场由客户端结算，适合好友休闲对战。

在本仓库的 `mini-app` 目录运行预检。

```sh
python3 skills/miniapp-dev/scripts/check_miniapp.py miniapps/twenty-four
```

浏览器可用 `python3 -m http.server 8081 --bind 127.0.0.1 --directory miniapps/twenty-four` 预览离线练习。联机使用宿主 SDK，盒子真机联调待验证。

修改源码后可从 `mini-app` 目录重新打包。

```sh
python3 -B skills/miniapp-dev/scripts/pack_miniapp.py miniapps/twenty-four -o market/zip/twenty-four-v2.zip
```
