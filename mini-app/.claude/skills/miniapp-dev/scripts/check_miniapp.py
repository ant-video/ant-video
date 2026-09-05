#!/usr/bin/env python3
"""小程序包预检。

覆盖宿主安装器的全部校验（manifest 合法性、入口存在、符号链接、体积与文件数上限），
外加几项只有装到真机才会暴露的问题：权限漏声明、绝对路径引用、body 背景缺失、
TV 按键缺失。ERROR 必须清零再进宿主。

    python3 check_miniapp.py <小程序目录>

有构建流程时检查产物目录（dist/），不是源码目录。
"""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

SKIPPED_DIRS = {".git", ".svn", "node_modules", "__MACOSX", ".idea", ".vscode"}
SCAN_EXT = {".html", ".htm", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte"}
# 这两个文件本身就在定义 / 模拟 ant.*，扫权限时要跳过，否则全是假阳性。
SDK_FILES = {"ant-mock.js", "ant-sdk.js"}

MAX_ENTRY_SIZE = 20 * 1024 * 1024
MAX_TOTAL_SIZE = 100 * 1024 * 1024
MAX_ENTRY_COUNT = 2000

APP_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$")
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

# ant.<第一段> → 需要的权限。不在表里的第一段不需要权限。
PERM_OF = {
    "request": "network",
    "requestJson": "network",
    "requestBytes": "network",
    "storage": "storage",
    "ui": "ui",
    "clipboard": "ui",
    "navigateTo": "navigate",
    "redirectTo": "navigate",
    "navigateBack": "navigate",
    "exitMiniApp": "navigate",
    "miniApp": "miniapp",
    "player": "player",
    "source": "source",
    "serve": "service",
}
# 允许 ant 与 . 之间换行：prettier 会把链式调用写成 `ant\n  .request({...})`。
ANT_REF_RE = re.compile(r"\bant\s*\.\s*(\w+)(?:\s*\.\s*(\w+))?\s*(\()?")
URL_HOST_RE = re.compile(r"https?://([A-Za-z0-9._\-]+)")

class Report:
    def __init__(self):
        self.errors = []
        self.warns = []
        self.notes = []

    def error(self, code, message):
        self.errors.append((code, message))

    def warn(self, code, message):
        self.warns.append((code, message))

    def note(self, message):
        self.notes.append(message)

    def dump(self):
        for code, message in self.errors:
            print(f"ERROR  {code:<20} {message}")
        for code, message in self.warns:
            print(f"WARN   {code:<20} {message}")
        for message in self.notes:
            print(f"       {message}")
        print()
        if self.errors:
            print(f"✗ {len(self.errors)} 个 ERROR、{len(self.warns)} 个 WARN —— 修完 ERROR 再装进宿主")
        elif self.warns:
            print(f"✓ 无 ERROR，{len(self.warns)} 个 WARN —— 逐条确认后可以打包")
        else:
            print("✓ 全部通过")
        return 1 if self.errors else 0


def is_blocked_host(host):
    """与宿主 MiniAppBasicApi.isBlockedHost 对齐的回环/内网判定。"""
    host = host.lower()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        return True
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        a, b = int(parts[0]), int(parts[1])
        if a in (0, 10, 127):
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        if a == 192 and b == 168:
            return True
        if a == 169 and b == 254:
            return True
    return False


def collect(root, report):
    """走一遍会被真正打进包的文件，同时记录符号链接与被跳过的开发目录。"""
    files = []
    symlinks = []
    skipped = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in list(dirnames):
            full = Path(dirpath) / name
            if name in SKIPPED_DIRS:
                skipped.append(str(full.relative_to(root)))
                dirnames.remove(name)
            elif full.is_symlink():
                symlinks.append(str(full.relative_to(root)))
                dirnames.remove(name)
        for name in filenames:
            full = Path(dirpath) / name
            rel = str(full.relative_to(root))
            if name == ".DS_Store":
                skipped.append(rel)
                continue
            if full.is_symlink():
                symlinks.append(rel)
                continue
            files.append((rel, full))
    for rel in symlinks:
        report.error("SYMLINK", f"包里不允许符号链接：{rel}")
    if skipped:
        head = "、".join(skipped[:4]) + ("…" if len(skipped) > 4 else "")
        report.note(f"打包时会跳过：{head}")
    return files


def check_limits(files, report):
    total = 0
    for rel, full in files:
        size = full.stat().st_size
        total += size
        if size > MAX_ENTRY_SIZE:
            report.error("ENTRY_TOO_LARGE", f"单文件超过 20MB：{rel}（{size / 1048576:.1f}MB）")
    if len(files) > MAX_ENTRY_COUNT:
        report.error("TOO_MANY_ENTRIES", f"文件数 {len(files)} 超过上限 {MAX_ENTRY_COUNT}")
    if total > MAX_TOTAL_SIZE:
        report.error("TOTAL_TOO_LARGE", f"总体积 {total / 1048576:.1f}MB 超过上限 100MB")
    unit = f"{total / 1048576:.2f}MB" if total >= 1048576 else f"{total / 1024:.1f}KB"
    report.note(f"共 {len(files)} 个文件、{unit}")


def check_remote_entry(entry, report):
    """entry 写成 http/https 地址就是在线站点型小程序，返回 True。

    与宿主 MiniAppManifest._ensureValidEntry + MiniAppHostPolicy.rejectRemoteEntry 对齐：
    其它协议、协议相对地址、指向本机/内网的入口，宿主都会直接拒绝安装。
    """
    if entry.startswith("//"):
        report.error("INVALID_ENTRY", f"entry 不支持协议相对地址，请写完整的 http/https 地址：{entry}")
        return False

    parsed = urlsplit(entry)
    if not parsed.scheme:
        return False
    if parsed.scheme not in {"http", "https"}:
        report.error("INVALID_ENTRY", f"entry 只支持包内相对路径或 http/https 地址：{entry}")
        return False

    host = (parsed.hostname or "").lower()
    if not host:
        report.error("INVALID_ENTRY", f"entry 地址缺少域名：{entry}")
        return False
    if is_blocked_host(host):
        report.error(
            "FORBIDDEN_ENTRY_HOST",
            f"在线入口不允许指向本机或内网：{host}（要连开发机 dev server 请用宿主的调试模式）",
        )
    if parsed.scheme == "http":
        report.warn("INSECURE_ENTRY", f"在线入口走的是明文 http：{entry}，页面能被改包且拿着宿主权限，建议上 https")
    return True


def check_manifest(root, report):
    path = root / "manifest.json"
    if not path.is_file():
        nested = [p for p in root.iterdir() if p.is_dir() and (p / "manifest.json").is_file()]
        hint = f"；但 {nested[0].name}/manifest.json 存在，检查是不是多套了一层目录" if nested else ""
        report.error("MISSING_MANIFEST", f"包根目录缺少 manifest.json{hint}")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        report.error("INVALID_JSON", f"manifest.json 不是合法 JSON：{exc}")
        return None
    if not isinstance(data, dict):
        report.error("INVALID_JSON", "manifest.json 顶层必须是对象")
        return None

    app_id = str(data.get("appId", "")).strip()
    if not app_id:
        report.error("MISSING_APP_ID", "manifest 缺少 appId")
    elif not APP_ID_RE.match(app_id):
        report.error(
            "INVALID_APP_ID",
            f"appId 要是至少两段的反向域名、段内只允许字母数字下划线：{app_id}",
        )

    if not str(data.get("name", "")).strip():
        report.error("MISSING_NAME", "manifest 缺少 name")

    version_code = data.get("versionCode")
    if isinstance(version_code, bool) or not isinstance(version_code, int) or version_code <= 0:
        report.error("INVALID_VERSION_CODE", f"versionCode 必须是大于 0 的整数，当前 {version_code!r}")

    renderer = str(data.get("renderer", "webview")).strip().lower()
    if renderer != "webview":
        report.error("UNSUPPORTED_RENDERER", f"当前宿主只支持 renderer=webview，写了 {renderer}")

    entry = str(data.get("entry") or "index.html").strip()
    remote_entry = check_remote_entry(entry, report)
    if not remote_entry and not (root / entry).is_file():
        report.error("ENTRY_MISSING", f"entry 指向的文件不存在：{entry}")

    perms = data.get("permissions", [])
    if not isinstance(perms, list):
        report.error("INVALID_PERMISSIONS", "permissions 必须是数组")
        perms = []
    unknown = [str(p) for p in perms if p not in KNOWN_PERMS]
    if unknown:
        report.warn(
            "UNKNOWN_PERMISSION",
            f"无法识别的权限会被静默忽略：{unknown}；可选 {'/'.join(KNOWN_PERMS)}",
        )

    icon = str(data.get("icon", "")).strip()
    if icon and not icon.startswith(("http://", "https://")):
        report.warn("ICON_NOT_URL", f"icon 只认 http/https 网络地址，包内路径会退回名称首字：{icon}")

    allowlist = []
    network = data.get("network")
    if isinstance(network, dict) and network.get("allowlist") is not None:
        raw = network["allowlist"]
        if isinstance(raw, list):
            allowlist = [str(x).strip().lower() for x in raw if str(x).strip()]
        else:
            report.warn("INVALID_ALLOWLIST", "network.allowlist 必须是数组，写错会被当成不限制")

    return {
        "entry": entry,
        "remote_entry": remote_entry,
        "permissions": [p for p in perms if p in KNOWN_PERMS],
        "allowlist": allowlist,
    }


BODY_RULE_RE = re.compile(r"([^{}]*)\{([^{}]*)\}")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
# 行注释：前面是 : 或 / 时不算，免得把 https:// 里的双斜杠当注释开头。
LINE_COMMENT_RE = re.compile(r"(?<![:/])//[^\n]*")


def strip_comments(text, ext):
    """去掉注释再扫 ant.*，否则"// ant.source.* 的假数据"这类说明会被当成调用。"""
    if ext in {".html", ".htm", ".vue", ".svelte"}:
        text = HTML_COMMENT_RE.sub("", text)
    text = BLOCK_COMMENT_RE.sub("", text)
    if ext != ".css":    # CSS 没有行注释，而 url(//cdn/x) 会被误伤
        text = LINE_COMMENT_RE.sub("", text)
    return text


def has_body_background(text):
    """找 body 选择器里的 background 声明。CSS 与 HTML 内联 <style> 都能扫到。"""
    for match in BODY_RULE_RE.finditer(text):
        selector, decls = match.group(1), match.group(2)
        if re.search(r"(^|[\s,>+~])body\b", selector) and "background" in decls:
            return True
    return bool(re.search(r"""<body[^>]+style\s*=\s*["'][^"']*background""", text))


def allowed_by(allowlist, host):
    """与宿主 MiniAppManifest.allowsHost 对齐。"""
    if not allowlist:
        return True
    for rule in allowlist:
        if rule == "*":
            return True
        if rule.startswith("*."):
            domain = rule[2:]
            if domain and (host == domain or host.endswith("." + domain)):
                return True
        elif host == rule:
            return True
    return False


def scan(root, files, manifest, report):
    called, referenced, hosts = {}, {}, {}
    abs_refs, sdk_script, localstorage = [], [], []
    has_tv_key = uses_invoke = body_bg = False
    entry_text = ""

    for rel, full in files:
        ext = full.suffix.lower()
        if ext != ".css" and ext not in SCAN_EXT:
            continue
        try:
            raw = full.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # 域名要在原文里找（注释里的 URL 也值得提醒），其余判断都用去注释后的正文。
        for match in URL_HOST_RE.finditer(raw):
            hosts.setdefault(match.group(1).lower(), rel)
        text = strip_comments(raw, ext)

        if not body_bg and has_body_background(text):
            body_bg = True

        if ext in {".html", ".htm"}:
            if re.search(r"""(?:src|href)\s*=\s*["']/(?!/)""", text):
                abs_refs.append(rel)
            if re.search(r"""<script[^>]+src\s*=\s*["'][^"']*ant-sdk\.js""", text):
                sdk_script.append(rel)
        if rel == manifest["entry"]:
            entry_text = text

        if full.name in SDK_FILES or ext == ".css":
            continue    # SDK 文件在定义 ant.*；CSS 不可能调 JSAPI（`.ant .player{}` 会误报）

        if "localStorage" in text:
            localstorage.append(rel)

        for match in ANT_REF_RE.finditer(text):
            first, second, is_call = match.group(1), match.group(2), match.group(3)
            if first == "tv" and second == "onKey":
                has_tv_key = True
            if first == "invoke":
                uses_invoke = True
            # 目标小程序接收参数和做 feature detection 不需要权限；只有主动 open 需要。
            if first == "miniApp" and second != "open":
                continue
            perm = PERM_OF.get(first)
            if perm is None:
                continue
            api = "ant." + first + ("." + second if second else "")
            bucket = called if is_call else referenced
            bucket.setdefault(perm, f"{rel} 里的 {api}")

    declared = set(manifest["permissions"])
    for perm, where in sorted(called.items()):
        if perm not in declared:
            report.error(
                "MISSING_PERMISSION",
                f'permissions 缺少 "{perm}"：{where} 运行时会 PERMISSION_DENIED',
            )
    for perm, where in sorted(referenced.items()):
        if perm not in declared and perm not in called:
            report.warn("MISSING_PERMISSION", f'{where} 引用了 "{perm}" 能力但没声明该权限')
    for perm in sorted(declared - (set(called) | set(referenced))):
        report.warn("UNUSED_PERMISSION", f'声明了 "{perm}" 但代码里没用到，按需申请')
    if uses_invoke:
        report.warn("RAW_INVOKE", "用了 ant.invoke()，静态推断不出它需要哪些权限，请自行核对")
    # service 是唯一会改变实例生命周期的权限，值得单独说一句。
    if "service" in declared:
        report.note(
            "声明了 service：宿主会在用户没打开小程序时把它后台拉起，handler 必须能在页面"
            "不可见时工作（别依赖 requestAnimationFrame / DOM / 用户点击）；"
            "dev server 实例没有 loopback 服务，这部分只能装成 zip 之后验",
        )
    if "miniapp" in declared:
        report.note(
            "声明了 miniapp：只能由当前可见的前台页面响应用户操作调用 open；"
            "目标必须已安装，宿主每次都会让用户确认",
        )

    for rel in dict.fromkeys(abs_refs):
        report.error(
            "ABSOLUTE_PATH",
            f"{rel} 有以 / 开头的资源引用。小程序挂在 /<token>/ 下，会 404 白屏，改成相对路径",
        )
    for rel in sdk_script:
        report.warn("MANUAL_SDK", f"{rel} 手动引了 ant-sdk.js；宿主已在 document-start 注入，不要自己引")
    if not body_bg:
        report.warn("NO_BODY_BG", "没找到 body 的 background 声明；容器 WebView 透明，会透出宿主背景图")
    if not has_tv_key:
        report.warn("NO_TV_KEY", "没实现 ant.tv.onKey；TV 上 WebView 不参与系统焦点，遥控器会毫无反应")
    if localstorage:
        report.warn(
            "LOCALSTORAGE",
            f"{localstorage[0]} 用了 localStorage；每次启动 origin 端口都变，要持久化请用 ant.storage",
        )
    if entry_text and "viewport-fit=cover" not in entry_text:
        report.warn("NO_VIEWPORT_FIT", "入口页 viewport 缺 viewport-fit=cover，刘海屏与手势条区域会被裁")

    if manifest["allowlist"]:
        outside = sorted(
            h for h in hosts if not allowed_by(manifest["allowlist"], h) and not is_blocked_host(h)
        )
        if outside:
            report.warn(
                "HOST_NOT_ALLOWED",
                f"不在 network.allowlist 里的域名：{outside[:5]}"
                "（只有 ant.request 受白名单约束，img/link 不受）",
            )
    blocked = sorted(h for h in hosts if is_blocked_host(h))
    if blocked:
        hint = "，ant.request 打过去一律失败"
        if "service" in declared:
            # 服务型小程序常常要合成一个喂给自己 handler 的 URL，那种回环地址是正常的。
            hint += "；如果只是喂给自己 ant.serve handler 的合成地址，可以忽略"
        report.warn("FORBIDDEN_HOST", f"代码里有回环/内网地址：{blocked[:5]}{hint}")


def main(argv):
    if len(argv) != 2 or argv[1] in {"-h", "--help"}:
        print(__doc__.strip())
        return 2
    root = Path(argv[1]).expanduser().resolve()
    if not root.is_dir():
        print(f"不是目录：{root}")
        return 2

    print(f"检查 {root}\n")
    report = Report()
    files = collect(root, report)
    check_limits(files, report)
    manifest = check_manifest(root, report)
    if manifest and manifest["remote_entry"]:
        # 页面代码在别人服务器上，静态检查无从下手，只能核 manifest 并点出人工项。
        report.note(f"在线站点型小程序，入口：{manifest['entry']}")
        report.note("包里没有页面代码，权限 / 绝对路径 / body 背景 / TV 按键这些检查跳过")
        report.note("请人工确认：登录域、www 与裸域、页面 CDN 都写进了 network.allowlist（不写就只有入口 origin 能跳）")
        report.note("请人工确认：站点自己实现了 TV 遥控焦点（ant.tv.onKey），否则 TV 上按不动")
    elif manifest:
        scan(root, files, manifest, report)
    return report.dump()


if __name__ == "__main__":
    sys.exit(main(sys.argv))


