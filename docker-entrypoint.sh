#!/bin/bash
set -e

# LensLab Entrypoint
# 0. 数据目录持久化初始化
# 1. 初始化配置（新建/迁移）
# 2. 启动自检（配置完整性、API Key、并发参数、目录就绪）
# 3. 启动服务

echo "======================================"
echo " 镜头演算室 · LensLab 启动中..."
echo " DATA_DIR: ${DATA_DIR:-/app/data}"
echo "======================================"

# 数据目录持久化初始化：确保挂载点下有完整数据
DATA_DIR=${DATA_DIR:-/app/data}
mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/results" "$DATA_DIR/generated" "$DATA_DIR/templates"

# 如果关键数据文件不存在，从镜像模板复制
for f in VERSIONS.json; do
    if [ ! -f "$DATA_DIR/$f" ]; then
        cp "/app/data/$f" "$DATA_DIR/$f" 2>/dev/null || true
    fi
done

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
