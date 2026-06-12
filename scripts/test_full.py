#!/usr/bin/env python3
"""
全流程冒烟测试 — 开发用
（无需服务启动，测试核心模块直接导入）
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# 把 backend 目录加入路径
sys.path.insert(0, str(BASE_DIR / "backend"))

all_ok = True

def test_imports():
    """测试所有核心模块能否导入"""
    modules = [
        "server",
        "analyzer",
        "ai_generator",
        "config_manager",
        "data_manager",
        "versions",
    ]
    ok = True
    for mod in modules:
        try:
            __import__(mod)
            print(f"  ✅ import {mod}")
        except ImportError as e:
            print(f"  ❌ import {mod}: {e}")
            ok = False
    return ok

def test_analyzer():
    """核心分析算法测试"""
    from analyzer import analyze_image, GRID_MODES, AnalysisResult
    import numpy as np
    from PIL import Image
    from pathlib import Path

    # 创建临时测试图（100x100 随机像素）
    import tempfile
    img = Image.fromarray(np.uint8(np.random.randint(0, 256, (100, 100, 3))))
    tmp = Path(tempfile.mkdtemp()) / "test.png"
    img.save(tmp)

    mode_key = list(GRID_MODES.keys())[0]  # "9"
    results = analyze_image(str(tmp), mode_key)

    # AnalysisResult 是个 dataclass，直接访问属性
    assert isinstance(results, AnalysisResult), "返回类型不正确"
    assert len(results.metering_points) > 0, "metering_points 为空"
    mode_name = GRID_MODES[mode_key]['name']
    print(f"  ✅ analyze_image (mode={results.mode}, points={len(results.metering_points)})")
    return True

def test_versions():
    """版本模块加载测试"""
    from versions import BUNDLED_CHANGELOG
    assert len(BUNDLED_CHANGELOG) > 0, "changelog 不应为空"
    print(f"  ✅ versions: {len(BUNDLED_CHANGELOG)} changelog entries, latest: {BUNDLED_CHANGELOG[0]['version']}")
    return True

print("="*60)
print("  镜头演算室 · 模块冒烟测试")
print("="*60)
print()

print("── 模块导入 ──")
ok = test_imports()
all_ok = all_ok and ok

print("\n── 核心功能 ──")
ok = test_analyzer()
all_ok = all_ok and ok

print("\n── 版本管理 ──")
ok = test_versions()
all_ok = all_ok and ok

print()
if all_ok:
    print("✅ 全部通过")
else:
    print("❌ 有测试失败")
    sys.exit(1)