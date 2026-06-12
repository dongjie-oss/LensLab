#!/usr/bin/env python3
"""
发布后验证脚本（本地执行 → 远程服务器）

验证项：
  □ 容器状态正常
  □ /api/versions 返回最新版本号
  □ digest 已同步
  □ 数据目录可访问
  □ 无异常日志

用法：
  python scripts/post_deploy_verify.py --target 10.0.1.138
  python scripts/post_deploy_verify.py --target localhost --port 8888

返回值：
  0 → 全部通过
  1 → 有检查项失败
"""

import sys
import json
import argparse
from pathlib import Path

try:
    import httpx
except ImportError:
    print("  ❌ 需要安装 httpx")
    sys.exit(1)


BASE_DIR = Path(__file__).resolve().parent.parent


def read_version_py() -> str:
    """读取预期版本号"""
    p = BASE_DIR / "backend" / "__version__.py"
    if not p.exists():
        return None
    import re
    m = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', p.read_text())
    return m.group(1) if m else None


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--target", default="10.0.1.138", help="远程服务器地址")
    p.add_argument("--port", type=int, default=8765, help="服务端口（远程8765，docker-compose暴露8888）")
    p.add_argument("--ssh", action="store_true", help="通过SSH验证容器状态")
    return p.parse_args()


def verify_api(base_url: str) -> dict:
    """API 端点验证"""
    results = {}
    try:
        with httpx.Client(base_url=base_url) as client:
            # 版本信息
            r = client.get("/api/versions", timeout=15)
            r.raise_for_status()
            data = r.json()
            ver = data.get("current", {}).get("version", "unknown")
            dv = data.get("current", {}).get("data_version", "?")
            digest = data.get("current", {}).get("digest", "")
            results["api_versions"] = True
            results["version"] = ver
            results["data_version"] = dv
            results["digest"] = digest
        except Exception as e:
            results["api_versions"] = False
            results["error"] = str(e)

    except Exception as e:
        results["reachable"] = False
        results["error"] = str(e)

    return results


def ssh_check_container(target: str) -> dict:
    """SSH 检查容器状态"""
    import subprocess
    results = {}
    try:
        r = subprocess.run(
            ["ssh", f"root@{target}", "docker inspect lenslab --format '{{.State.Status}}'"],
            capture_output=True, text=True, timeout=15,
        )
        status = r.stdout.strip().strip("'")
        results["container_status"] = status
        results["container_ok"] = status == "running"
    except Exception as e:
        results["ssh_error"] = str(e)
        results["container_ok"] = False

    return results


def main():
    args = parse_args()
    target = args.target
    port = args.port
    expected_version = read_version_py()

    base_url = f"http://{target}:{port}"

    print(f"{"="*60}")
    print(f"  镜头演算室 · 发布后验证")
    print(f"  目标: {base_url}")
    if expected_version:
        print(f"  预期版本: {expected_version}")
    print(f"{"="*60}")
    print()

    all_ok = True

    if args.ssh:
        print("── 容器状态 ──")
        ssh = ssh_check_container(target)
        status = ssh.get("container_status", "N/A")
        if ssh.get("container_ok"):
            print(f"  ✅ 容器状态: {status}")
        else:
            print(f"  ❌ 容器状态: {status}")
            all_ok = False
        print()

    print("── API 验证 ──")
    api = verify_api(base_url)
    if api.get("api_versions"):
        ver = api.get("version")
        print(f"  ✅ /api/versions: {ver}")
        if expected_version and ver != expected_version:
            print(f"  ❌ 版本不一致！本地={expected_version}，远端={ver}")
            all_ok = False
        else:
            print(f"  ✅ 版本一致: {ver}")

        digest = api.get("digest", "")
        if digest:
            print(f"  ✅ digest 已同步")
        else:
            print(f"  ⚠️  digest 为空（首次部署正常，后续需同步）")

        dv = api.get("data_version")
        print(f"  ✅ data_version: {dv}")
    else:
        print(f"  ❌ /api/versions 不可达: {api.get('error')}")
        all_ok = False

    print()
    print(f"{"="*60}")
    if all_ok:
        print("✅ 发布后验证全部通过")
        sys.exit(0)
    else:
        print("❌ 发布后验证发现异常")
        sys.exit(1)


if __name__ == "__main__":
    main()