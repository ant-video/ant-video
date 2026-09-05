#!/usr/bin/env python3
"""预检并把小程序目录打包成可导入宿主的 zip。预检不通过就不打包。

    python3 pack_miniapp.py <小程序目录> [-o 输出路径]

只依赖 python3 标准库（不需要 zip / md5 / md5sum 命令），macOS / Linux / Windows 都能跑。
关键点：manifest.json 必须落在包根，所以打包以目录内部为基准，不把这层目录本身压进去，
否则宿主报 MISSING_MANIFEST。以 . 开头的文件与目录一律不进包（免得把 .env 之类带出去）。
"""

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True    # 别在 skill 目录里留 __pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_miniapp    # noqa: E402  复用同一套预检与跳过规则


def md5_of(path):
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="预检并打包小程序")
    parser.add_argument("src", help="小程序目录（有构建流程时给产物目录）")
    parser.add_argument("-o", "--out", help="输出 zip，缺省 <同级>/<目录名>-v<versionCode>.zip")
    args = parser.parse_args()

    src = Path(args.src).expanduser().resolve()
    if not src.is_dir():
        sys.exit(f"不是目录：{src}")
    if check_miniapp.main(["check_miniapp.py", str(src)]) != 0:
        return 1

    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    if args.out:
        out = Path(args.out).expanduser().resolve()
    else:
        out = src.parent / f"{src.name}-v{manifest['versionCode']}.zip"

    files = check_miniapp.collect(src, check_miniapp.Report())
    packed, hidden = [], []
    for rel, full in sorted(files):
        if any(part.startswith(".") for part in Path(rel).parts):
            hidden.append(rel)
        else:
            packed.append((rel, full))

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel, full in packed:
            archive.write(full, arcname=rel.replace("\\", "/"))

    if hidden:
        print(f"\n已排除隐藏文件：{'、'.join(hidden[:4])}{'…' if len(hidden) > 4 else ''}")
    print(f"\n✓ {out}")
    print(f"  {len(packed)} 个文件 · size {out.stat().st_size} · md5 {md5_of(out)}")
    print("  装进宿主：小程序 → 右上角 + → 导入 zip 包")
    print("  上架市场 JSON 时把上面的 size / md5 填进条目（宿主会校验 md5）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
