#!/usr/bin/env python3
"""从模板生成一个小程序骨架。

    python3 new_miniapp.py --app-id com.foo.notes --name 我的笔记 \\
        [--out miniapps/notes] [--permissions ui,storage] [--description '一句话介绍']

骨架里已经预置了相对路径引用、body 背景、安全区、深色模式、TV 遥控焦点，以及浏览器
mock SDK，直接往 app.js 里写业务即可。--permissions 缺省 ui,storage，按需增删——
多声明的权限只会让用户对你的小程序更警惕。
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
    "ui",
    "navigate",
    "miniapp",
    "player",
    "source",
    "service",
]
APP_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$")


def main():
    parser = argparse.ArgumentParser(add_help=True, description="生成小程序骨架")
    parser.add_argument("--app-id", required=True, help="反向域名，如 com.foo.notes；发布后不要改")
    parser.add_argument("--name", required=True, help="展示名")
    parser.add_argument("--out", help="输出目录，缺省 miniapps/<appId 最后一段>")
    parser.add_argument("--permissions", default="ui,storage", help=",".join(KNOWN_PERMS))
    parser.add_argument("--description", default="", help="一句话描述，缺省用 name")
    args = parser.parse_args()

    if not APP_ID_RE.match(args.app_id):
        sys.exit(f"appId 要是至少两段的反向域名、段内只允许字母数字下划线：{args.app_id}")

    perms = [item.strip() for item in args.permissions.split(",") if item.strip()]
    unknown = [item for item in perms if item not in KNOWN_PERMS]
    if unknown:
        sys.exit(f"无法识别的权限 {unknown}，可选：{'/'.join(KNOWN_PERMS)}")

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
        if not src.is_file():
            continue
        text = src.read_text(encoding="utf-8")
        for token, value in replacements.items():
            text = text.replace(token, value)
        (out / src.name).write_text(text, encoding="utf-8")
    shutil.copy2(MOCK_FILE, out / "ant-mock.js")

    checker = SKILL_DIR / "scripts" / "check_miniapp.py"
    packer = SKILL_DIR / "scripts" / "pack_miniapp.py"
    print(f"✓ 已生成 {out}（权限：{', '.join(perms)}）\n")
    print("下一步：")
    print(f"  cd {out} && python3 -m http.server 3000    # 阶段① 浏览器里开发（90% 的时间）")
    print(f"  python3 {checker} {out}    # 打包前预检")
    print(f"  python3 {packer} {out}     # 预检通过后打包成 zip")


if __name__ == "__main__":
    main()
