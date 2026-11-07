# 速读谷小说 Python 小程序

从速读谷浏览分类、搜索书名/作者、查看简介和目录、阅读正文，支持书架、章节与正文分页的
阅读位置保存、字号/行距、清爽/护眼/夜间配色以及 TV 方向键阅读。

宿主内嵌 Python 负责采集，无需额外部署服务器，也不需要先配置宿主采集源。
安装要求：支持 python 服务块与 ant.python.call 的完整宿主构建；Android 使用 ARM 设备。

## 安装

将打包后的 sudugu-reader-v1.zip 导入宿主「小程序 → + → 导入 zip 包」。
公开项目的包在 mini-app/market/zip/ 下，市场清单也包含此应用。
从文件夹安装时选择本目录；包根必须包含 manifest.json。

## 本地开发

在宿主源码仓库根目录执行：

```bash
python3 -m venv /tmp/sudugu-reader-venv
/tmp/sudugu-reader-venv/bin/pip install -r miniapps/sudugu-reader/requirements.txt
/tmp/sudugu-reader-venv/bin/python .agents/skills/miniapp-dev/scripts/dev_python.py miniapps/sudugu-reader --port 3000
```

打开 http://127.0.0.1:3000 使用真实 Python 采集；?demo=1 展示明确标注的样例内容。
公开项目则在 mini-app/ 中执行，并把 .agents/skills/ 替换为 skills/。
修改 Python 后重启联调服务。静态 http.server 和宿主 dev server 调试不会加载包内 Python。

```bash
python3 .agents/skills/miniapp-dev/scripts/check_miniapp.py miniapps/sudugu-reader
python3 .agents/skills/miniapp-dev/scripts/pack_miniapp.py miniapps/sudugu-reader
python3 test/python_sudugu_reader_test.py
```

## 文件与接口

- sudugu_spider.py 来自用户提供的《速读谷.py》，只去掉未使用的 base.spider 导入与基类继承。
- reader_backend.py 复用原条目提取逻辑，适配当前 suduguu.com 域名、sor.aspx?key= 搜索、
  /分类/2.html 分页、.des 简介、.con 正文，保留中文章号/番外的目录顺序并按 URL 去重。
- app.py 提供 home/listing/search/detail/chapter 顶层函数及 Flask app。
  前端用 ant.python.call，HTTP 服务另可通过 miniapp://com.leospring.sudugu_reader/check
  和 /api/home、/api/listing、/api/search、/api/detail、/api/chapter 调用。
- 长章节的 -2.html/-3.html 分页显示“下一页正文”，同时保存具体分页位置。正文直接在阅读页
  展示，不将 novel:// 交给视频播放器。网络/解析失败显示可重试提示，HTTP 200 首页不冒充正文。
- preview.js 只供浏览器 ?demo=1 使用，宿主中始终调用真实 SDK。

数据存放在 ant.storage（按 appId 隔离），升级保留，卸载清除。requirements.txt 用于本机开发；
宿主不会自动 pip 安装，示例所用 requests/beautifulsoup4/flask 已属于宿主 Python 依赖。
