#!/usr/bin/env python3
"""
版本号一致性检查脚本
检测项目中所有版本号定义源是否一致。

检查项：
1. backend/__version__.py
2. VERSION 文件
3. data/VERSIONS.json → current.version
4. Dockerfile → ARG BUILD_VERSION
5. docker-compose.yml → image tag

用法：
  python scripts/check_version_consistency.py
  python scripts/check_version_consistency.py --verbose
  python scripts/check_version_consistency.py --fix    # 自动修正 VERSION 文件

返回值：
  0 → 全部一致
  1 → 存在不一致（有 ❌ 条目）
  2 → 无法读取关键文件
"""

import sys
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def read_file_safe(path: Path) -> str:
    """安全读取文件内容"""
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception:
        return None


def extract_py_version(path: Path) -> str:
    """从 __version__.py 提取版本号"""
    content = read_file_safe(path)
    if content is None:
        return None
    m = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', content)
    return m.group(1) if m else None


def extract_dockerfile_version(path: Path) -> str:
    """从 Dockerfile 提取 BUILD_VERSION"""
    content = read_file_safe(path)
    if content is None:
        return None
    # 找第一行 ARG BUILD_VERSION=xxx
    m = re.search(r'ARG\s+BUILD_VERSION\s*=\s*["\']?([0-9]+\.[0-9]+\.[0-9]+)', content)
    return m.group(1) if m else None


def extract_versions_json(path: Path) -> dict:
    """解析 VERSIONS.json"""
    content = read_file_safe(path)
    if content is None:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def extract_compose_version(path: Path) -> str:
    """从 docker-compose.yml 提取镜像版本号"""
    content = read_file_safe(path)
    if content is None:
        return None
    # 匹配 image: ...:X.X.X
    m = re.search(r'image\s*:.*:([0-9]+\.[0-9]+\.[0-9]+)', content)
    if m:
        return m.group(1)
    # 也匹配 BUILD_VERSION=xxx
    m = re.search(r'BUILD_VERSION\s*=\s*([0-9]+\.[0-9]+\.[0-9]+)', content)
    return m.group(1) if m else None


def check_all(verbose: bool = False) -> int:
    """执行全部版本号一致性检查"""

    sources = {
        "backend/__version__.py": extract_py_version(BASE_DIR / "backend" / "__version__.py"),
        "VERSION": read_file_safe(BASE_DIR / "VERSION"),
        "data/VERSIONS.json → current.version": None,
        "Dockerfile → BUILD_VERSION": extract_dockerfile_version(BASE_DIR / "Dockerfile"),
        "docker-compose.yml": extract_compose_version(BASE_DIR / "docker-compose.yml"),
    }

    # VERSIONS.json 特殊处理
    vj = extract_versions_json(BASE_DIR / "data" / "VERSIONS.json")
    if vj:
        sources["data/VERSIONS.json → current.version"] = vj.get("current", {}).get("version", None)
    else:
        sources["data/VERSIONS.json → current.version"] = None

    # 收集有效版本号
    valid_versions = [v for v in sources.values() if v is not None]
    if not valid_versions:
        print("❌ 无法读取任何版本号源")
        return 2

    # 取第一个作为基准
    baseline = valid_versions[0]

    print(f"  基准版本号: {baseline}")
    print()

    all_ok = True
    for name, version in sources.items():
        status = "✅" if version == baseline else ("❌" if version is not None else "⚠️")
        if version == baseline:
            detail = version
        elif version is None:
            detail = "文件不存在或无法解析"
        else:
            detail = f"{version} (期望: {baseline})"
            all_ok = False

        if verbose or status != "✅":
            print(f"  {status}  {name:50s} → {detail}")

    # 简洁模式只显示不一致的
    if not verbose and all_ok:
        print(f"  ✅ 全部一致: {baseline}")
    elif not verbose:
        print()
        for name, version in sources.items():
            if version != baseline:
                v = version or "N/A"
                print(f"  ❌  {name} = {v}")

    print()
    return 0 if all_ok else 1


def auto_fix():
    """自动修正 VERSION 文件以匹配 __version__.py"""
    py_ver = extract_py_version(BASE_DIR / "backend" / "__version__.py")
    if py_ver is None:
        print("❌ 无法读取 backend/__version__.py")
        return False

    current_ver = read_file_safe(BASE_DIR / "VERSION")
    if current_ver == py_ver:
        print(f"  ℹ️ VERSION 文件已经是最新: {py_ver}")
        return True

    # 备份
    vf = BASE_DIR / "VERSION"
    bak = vf.with_suffix(".bak")
    if vf.exists():
        vf.rename(bak)
        print(f"  📦 已备份: VERSION → VERSION.bak")

    vf.write_text(py_ver + "\n")
    print(f"  ✅ VERSION 已更新: {current_ver or '(空)'} → {py_ver}")
    return True


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    fix = "--fix" in sys.argv

    print(f"{"="*60}")
    print(f"  镜头演算室 · 版本号一致性检查")
    print(f"  项目目录: {BASE_DIR}")
    print(f"{"="*60}")
    print()

    if fix:
        print("── 自动修正 VERSION 文件 ──")
        auto_fix()
        print()

    print("── 一致性检查 ──")
    exit_code = check_all(verbose)
    print(f"{"="*60}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()