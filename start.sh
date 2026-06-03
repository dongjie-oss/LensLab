#!/bin/bash
# Render 启动脚本
cd /opt/render/project/src/backend
pip install --no-cache-dir -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port $PORT
