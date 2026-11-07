#!/usr/bin/env python3
"""从模板生成一个小程序骨架。

    python3 new_miniapp.py --app-id com.foo.notes --name 我的笔记 \\
        [--out miniapps/notes] [--permissions ui,storage] [--description '一句话介绍'] [--node | --python]

骨架里已经预置了相对路径引用、body 背景、安全区、深色模式、TV 遥控焦点，以及浏览器
mock SDK，直接往 app.js 里写业务即可。--permissions 缺省 ui,storage，按需增删——
多声明的权限只会让用户对你的小程序更警惕。

--node 额外生成 server/ 目录（index.js + index.config.js）并在 manifest 里写 node 块 +
node 权限：宿主会用内嵌 node 把 server/index.js 当 worker 跑起来，详见开发引导 §4.11。
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = SKILL_DIR / "assets" / "template"
MOCK_FILE = SKILL_DIR / "assets" / "ant-mock.js"
KNOWN_PERMS = [
    "network",
    "storage",
    "filesystem",
    "ui",
    "navigate",
    "miniapp",
    "player",
    "source",
    "service",
    "node",
    "python",
]
APP_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$")

NODE_SERVER_JS = """\
// Node 服务入口：宿主以内嵌 node worker 运行本文件（见开发引导 §4.11）。
// 契约：导出 start(config)；监听端口用 process.env.DEV_HTTP_PORT，不要写死；
// /check 是宿主的就绪探测口，必须尽快 200。
const http = require('http');

let server = null;

module.exports = {
  start: (config) => {
    const handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.url.split('?')[0] === '/check') {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found', path: req.url }));
      }
    };
    // 经宿主注入的 catServerFactory 起服务，宿主能立刻感知监听端口与状态
    server = globalThis.catServerFactory
      ? globalThis.catServerFactory(handler)
      : http.createServer(handler);
    server.listen(Number(process.env.DEV_HTTP_PORT), '127.0.0.1');
  },
  stop: () => { if (server) server.close(); },
};
"""

NODE_CONFIG_JS = """\
// start(config) 收到的就是这里的导出值
module.exports = {};
"""


def main():
    parser = argparse.ArgumentParser(add_help=True, description="生成小程序骨架")
    parser.add_argument("--app-id", required=True, help="反向域名，如 com.foo.notes；发布后不要改")
    parser.add_argument("--name", required=True, help="展示名")
    parser.add_argument("--out", help="输出目录，缺省 miniapps/<appId 最后一段>")
    parser.add_argument("--permissions", default="ui,storage", help=",".join(KNOWN_PERMS))
    parser.add_argument("--description", default="", help="一句话描述，缺省用 name")
    runtime = parser.add_mutually_exclusive_group()
    runtime.add_argument(
        "--node",
        action="store_true",
        help="生成 server/ 骨架并声明 node 块（宿主以 worker 跑你的 Node.js 后端）",
    )
    runtime.add_argument(
        "--python", action="store_true",
        help="生成 app.py 与 ant.python.call 示例（宿主内嵌 CPython，不与 --node 共用）",
    )
    args = parser.parse_args()

    if not APP_ID_RE.match(args.app_id):
        sys.exit(f"appId 要是至少两段的反向域名、段内只允许字母数字下划线：{args.app_id}")

    perms = [item.strip() for item in args.permissions.split(",") if item.strip()]
    unknown = [item for item in perms if item not in KNOWN_PERMS]
    if unknown:
        sys.exit(f"无法识别的权限 {unknown}，可选：{'/'.join(KNOWN_PERMS)}")
    if args.node and "node" not in perms:
        perms.append("node")
    if args.python and "python" not in perms:
        perms.append("python")

    out = Path(args.out).expanduser() if args.out else Path("miniapps") / args.app_id.rsplit(".", 1)[-1]
    if out.exists() and any(out.iterdir()):
        sys.exit(f"目录已存在且非空：{out}")

    out.mkdir(parents=True, exist_ok=True)
    replacements = {
        "__APP_ID__": args.app_id,
        "__NAME__": args.name,
        "__DESCRIPTION__": args.description or args.name,
        "__PERMISSIONS__": json.dumps(perms, ensure_ascii=False),
        "__PERMISSIONS_JS__": json.dumps(perms, ensure_ascii=False),
    }
    for src in sorted(TEMPLATE_DIR.iterdir()):
        if not src.is_file() or src.name == "manifest.json":
            continue
        text = src.read_text(encoding="utf-8")
        for token, value in replacements.items():
            text = text.replace(token, value)
        (out / src.name).write_text(text, encoding="utf-8")
    manifest = {
        "appId": args.app_id, "name": args.name, "version": "1.0.0",
        "versionCode": 1, "renderer": "webview", "entry": "index.html",
        "description": args.description or args.name, "permissions": perms,
    }
    if args.node:
        manifest["node"] = {"entry": "server/index.js", "config": "server/index.config.js"}
    if args.python:
        manifest["python"] = {"entry": "app.py"}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(MOCK_FILE, out / "ant-mock.js")
    if args.node:
        server_dir = out / "server"
        server_dir.mkdir()
        (server_dir / "index.js").write_text(NODE_SERVER_JS, encoding="utf-8")
        (server_dir / "index.config.js").write_text(NODE_CONFIG_JS, encoding="utf-8")
    if args.python:
        shutil.copy2(SKILL_DIR / "assets" / "python" / "app.py", out / "app.py")
        html_path = out / "index.html"
        html = html_path.read_text(encoding="utf-8")
        html = html.replace('</main>', '<button data-action="python">调用 Python hello</button>\n  </main>')
        html = html.replace('<script src="./ant-mock.js">', '''<script>
    window.__antMockPython = function (method, args) {
      return fetch('./__python/' + encodeURIComponent(method), {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({args: args})
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.message || 'Python 调用失败');
          return data;
        });
      });
    };
  </script>\n  <script src="./ant-mock.js">''')
        html_path.write_text(html, encoding="utf-8")
        js_path = out / "app.js"
        js = js_path.read_text(encoding="utf-8").replace("var actions = {", """var actions = {
    python: function () {
      return ant.python.call('hello', {name: '蚂蚁影视'}, 2).then(function (result) {
        show('Python hello', result);
      });
    },""")
        js_path.write_text(js, encoding="utf-8")

    checker = SKILL_DIR / "scripts" / "check_miniapp.py"
    packer = SKILL_DIR / "scripts" / "pack_miniapp.py"
    print(f"✓ 已生成 {out}（权限：{', '.join(perms)}{'，含 Node 服务' if args.node else '，含 Python 后端' if args.python else ''}）\n")
    print("下一步：")
    print(f"  cd {out} && python3 -m http.server 3000    # 阶段① 浏览器里开发（90% 的时间）")
    if args.node:
        print('  # 本地 Node 自测需调用导出的 start(config)，并设置 DEV_HTTP_PORT；不能只执行入口文件')
    if args.python:
        print(f"  python3 {SKILL_DIR / 'scripts' / 'dev_python.py'} {out} --port 3000    # HTML + 真 Python 本地联调")
    print(f"  python3 {checker} {out}    # 打包前预检")
    print(f"  python3 {packer} {out}     # 预检通过后打包成 zip")


if __name__ == "__main__":
    main()
