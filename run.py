#!/usr/bin/env python3
"""
LensLab - 启动脚本
"""

import os
import sys
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).parent


def check_dependencies():
    try:
        import fastapi, uvicorn, PIL, numpy
        return True
    except ImportError:
        return False


def install_dependencies():
    req = BASE_DIR / "backend" / "requirements.txt"
    print("📦 安装依赖...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req)])
    print("✅ 依赖安装完成")


def start_server():
    os.chdir(str(BASE_DIR))
    sys.path.insert(0, str(BASE_DIR / "backend"))
    from backend.server import app
    import uvicorn
    port = 8765
    print(f"\n🚀 镜头演算室 已启动！")
    print(f"   本地访问: http://localhost:{port}")
    print(f"   Ctrl+C 停止服务\n")
    uvicorn.run(app, host="0.0.0.0", port=port)


def main():
    print("╔══════════════════════════════════════╗")
    print("║      ⚡ 镜头演算室 · LensLab   ║")
    print("╚══════════════════════════════════════╝")
    if not check_dependencies():
        install_dependencies()
    start_server()


if __name__ == "__main__":
    main()
