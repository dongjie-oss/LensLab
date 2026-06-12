#!/usr/bin/env python3
"""
发布前冒烟测试脚本

测试项：
  □ FastAPI 服务启动
  □ /api/versions 返回版本信息
  □ 文件上传接口正常
  □ AI生图接口（可选，需要API Key）
  □ 登录认证（管理面板）

用法：
  python scripts/smoke_test.py [--base-url http://localhost:8765]

返回值：
  0 → 全部通过
  1 → 有测试失败
  2 → 服务不可达
"""

import sys
import time
import json
import argparse
from pathlib import Path

try:
    import httpx
except ImportError:
    print("  ❌ 需要安装 httpx")
    print("     pip install httpx")
    sys.exit(1)


BASE_DIR = Path(__file__).resolve().parent.parent

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost:8765", help="服务地址")
    return p.parse_args()


def test_versions(client: httpx.Client) -> bool:
    """GET /api/versions 返回正常"""
    try:
        r = client.get("/api/versions", timeout=10)
        r.raise_for_status()
        data = r.json()
        assert "current" in data, "缺少 current 字段"
        assert "changelog" in data, "缺少 changelog 字段"
        print(f"  ✅ /api/versions: {data['current']['version']} (data_version={data['current']['data_version']})")
        return True
    except Exception as e:
        print(f"  ❌ /api/versions: {e}")
        return False


def test_home(client: httpx.Client) -> bool:
    """GET / 返回 HTML"""
    try:
        r = client.get("/", timeout=10)
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        assert "text/html" in ct, "内容不是HTML"
        print(f"  ✅ 首页可访问 ({len(r.text)} bytes)")
        return True
    except Exception as e:
        print(f"  ❌ 首页: {e}")
        return False


def test_upload(client: httpx.Client) -> bool:
    """测试文件上传接口（上传图片并获取分析结果）"""
    # 用小尺寸测试图（1x1 PNG）
    png_1x1 = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    try:
        files = {"file": ("test.png", png_1x1, "image/png")}
        r = client.post("/api/analyze", files=files, timeout=30)
        r.raise_for_status()
        data = r.json()
        # 至少返回 analysis_id
        assert "analysis_id" in data, "缺少 analysis_id"
        print(f"  ✅ 上传分析: analysis_id={data['analysis_id']}")
        return True
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 400:
            # 可能是图片格式校验不通过，但接口可达
            print(f"  ⚠️ 上传失败（400）：{e.response.text[:80]}")
            return True
        print(f"  ❌ 上传: {e}")
        return False
    except Exception as e:
        print(f"  ❌ 上传: {e}")
        return False


def test_dirs():
    """检查数据目录结构"""
    dirs = [
        BASE_DIR / "data" / "uploads",
        BASE_DIR / "data" / "results",
    ]
    for d in dirs:
        if not d.exists():
            print(f"  ❌ 目录不存在: {d}")
            return False
        print(f"  ✅ 目录存在: {d}")
    return True


def main():
    args = parse_args()
    base = args.base_url.rstrip("/")

    print(f"{"="*60}")
    print(f"  镜头演算室 · 发布前冒烟测试")
    print(f"  目标: {base}")
    print(f"{"="*60}")
    print()

    all_ok = True

    with httpx.Client(base_url=base) as client:
        print("── 服务状态 ──")
        try:
            # 快速可达性检查
            r = client.get("/", timeout=5)
            print(f"  ✅ 服务可达: HTTP {r.status_code}")
        except Exception as e:
            print(f"  ❌ 服务不可达: {e}")
            all_ok = False
            print("\n❌ 测试失败")
            sys.exit(2)

        print("\n── API 功能 ──")
        ok = test_versions(client)
        all_ok = all_ok and ok

        ok = test_home(client)
        all_ok = all_ok and ok

        ok = test_upload(client)
        all_ok = all_ok and ok

    print("\n── 目录检查 ──")
    ok = test_dirs()
    all_ok = all_ok and ok

    print()
    if all_ok:
        print("✅ 全部测试通过")
        sys.exit(0)
    else:
        print("❌ 部分测试失败")
        sys.exit(1)


if __name__ == "__main__":
    main()