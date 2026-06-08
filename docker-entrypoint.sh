#!/bin/bash
set -e

# LensLab Entrypoint
# 1. 初始化配置（新建/迁移）
# 2. 启动自检（配置完整性、API Key、并发参数、目录就绪）
# 3. 启动服务

echo "======================================"
echo " 镜头演算室 · LensLab 启动中..."
echo " DATA_DIR: ${DATA_DIR:-/app/data}"
echo "======================================"

# 初始化配置
python /app/backend/init_config.py

# 启动自检（配置完整性、API Key、并发参数、目录就绪）
echo ""
echo "🔍 运行启动自检..."
python /app/backend/check_startup.py
echo ""

# 启动服务
echo ""
echo "当前版本: $(cat /app/version.json 2>/dev/null | python -c 'import sys,json; print(json.load(sys.stdin).get("version","unknown"))' 2>/dev/null || echo "dev")"
echo "启动 FastAPI 服务..."
echo "======================================"
echo ""

exec uvicorn server:app --host 0.0.0.0 --port 8765
