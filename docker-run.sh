#!/bin/bash
# Exposure Lab - Docker 启动脚本
# 用法：./docker-run.sh [start|stop|restart|logs|status|rebuild]

set -e

IMAGE_NAME="exposure-lab"
CONTAINER_NAME="exposure-lab"
HOST_PORT=8888
CONTAINER_PORT=8765
DATA_DIR="$(cd "$(dirname "$0")" && pwd)/data"

usage() {
    echo "用法: $0 [start|stop|restart|logs|status|rebuild]"
    echo ""
    echo "  start    启动容器（首次运行会自动构建）"
    echo "  stop     停止并删除容器"
    echo "  restart  重新构建并启动"
    echo "  logs     查看容器日志"
    echo "  status   查看容器状态"
    echo "  rebuild  重新构建镜像"
    echo ""
    echo "数据目录: $DATA_DIR"
    echo "访问地址: http://localhost:$HOST_PORT"
}

do_start() {
    echo "🚀 启动 Exposure Lab..."
    mkdir -p "$DATA_DIR"
    
    if ! docker image inspect "$IMAGE_NAME:latest" &>/dev/null; then
        echo "📦 首次构建镜像..."
        docker build -t "$IMAGE_NAME:latest" .
    fi
    
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    docker run -d \
        --name "$CONTAINER_NAME" \
        -p "$HOST_PORT:$CONTAINER_PORT" \
        -v "$DATA_DIR:/app/data" \
        -e TZ=Asia/Shanghai \
        -e DATA_DIR=/app/data \
        --restart unless-stopped \
        "$IMAGE_NAME:latest"
    
    sleep 2
    if docker ps --filter "name=$CONTAINER_NAME" --format "{{.Status}}" | grep -q "Up"; then
        echo "✅ 容器启动成功"
        echo "   访问地址: http://localhost:$HOST_PORT"
        echo "   数据目录: $DATA_DIR"
    else
        echo "❌ 容器启动失败，查看日志：docker logs $CONTAINER_NAME"
        exit 1
    fi
}

do_stop() {
    echo "🛑 停止容器..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    echo "✅ 容器已停止"
}

do_restart() {
    echo "🔄 重新构建并启动..."
    do_stop
    echo "📦 重新构建镜像..."
    docker build -t "$IMAGE_NAME:latest" .
    do_start
}

do_logs() {
    docker logs -f "$CONTAINER_NAME"
}

do_status() {
    echo "=== 容器状态 ==="
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "容器未运行"
    echo ""
    echo "=== 数据目录 ==="
    ls -la "$DATA_DIR" 2>/dev/null || echo "数据目录不存在"
}

do_rebuild() {
    echo "📦 重新构建镜像..."
    docker build -t "$IMAGE_NAME:latest" .
    echo "✅ 镜像构建完成"
}

case "${1:-}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_restart ;;
    logs)    do_logs ;;
    status)  do_status ;;
    rebuild) do_rebuild ;;
    *)       usage ;;
esac