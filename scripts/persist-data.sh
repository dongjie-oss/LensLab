#!/bin/bash
# ============================================================
# 镜头演算室 · LensLab 数据持久化管理脚本
# 用途：确保容器内 /app/data 目录始终持久化到宿主机
# 用法：./persist-data.sh [init|verify|backup|restore|clean]
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/data"
IMAGE_NAME="exposure-lab"
CONTAINER_NAME="lenslab"
HOST_PORT=8888
CONTAINER_PORT=8765

# ---------- 颜色 ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_ok()  { echo -e "${GREEN}✓${NC} $1"; }
log_warn(){ echo -e "${YELLOW}⚠${NC} $1"; }
log_err() { echo -e "${RED}✗${NC} $1"; }

# ---------- init: 初始化数据目录 ----------
do_init() {
    echo "📁 初始化数据目录: $DATA_DIR"
    mkdir -p "$DATA_DIR/uploads"
    mkdir -p "$DATA_DIR/results"
    mkdir -p "$DATA_DIR/generated"
    mkdir -p "$DATA_DIR/templates"
    
    # 如果 config.json 不存在则创建默认
    if [ ! -f "$DATA_DIR/config.json" ]; then
        echo '{}' > "$DATA_DIR/config.json"
        log_ok "已创建默认 config.json"
    fi
    
    # 如果 history.json 不存在则创建
    if [ ! -f "$DATA_DIR/history.json" ]; then
        echo '{"data_version":1,"items":[]}' > "$DATA_DIR/history.json"
        log_ok "已创建默认 history.json"
    fi
    
    # 如果 VERSIONS.json 不存在则从代码库复制
    if [ ! -f "$DATA_DIR/VERSIONS.json" ]; then
        cp "$PROJECT_DIR/data/VERSIONS.json.bak" "$DATA_DIR/VERSIONS.json" 2>/dev/null || true
    fi
    
    log_ok "数据目录初始化完成"
    echo "   目录结构:"
    tree -L 1 "$DATA_DIR" 2>/dev/null || ls -la "$DATA_DIR"
}

# ---------- verify: 验证持久化配置 ----------
do_verify() {
    echo "🔍 验证数据持久化配置..."
    echo ""
    
    # 检查容器是否在运行
    if ! docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "容器未运行"
        echo "   运行: cd $PROJECT_DIR && ./docker-run.sh start"
        return 1
    fi
    
    # 检查挂载
    MOUNTS=$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} {{.Type}}\n{{end}}')
    
    if echo "$MOUNTS" | grep -q "/app/data"; then
        log_ok "数据目录已挂载: /app/data"
    else
        log_err "数据目录未挂载！容器可能丢失数据"
        echo "   挂载信息:"
        echo "$MOUNTS" | sed 's/^/   /'
        return 1
    fi
    
    # 对比容器内外数据一致性
    CONTAINER_FILES=$(docker exec "$CONTAINER_NAME" find /app/data -type f 2>/dev/null | wc -l)
    HOST_FILES=$(find "$DATA_DIR" -type f 2>/dev/null | wc -l)
    
    echo "   宿主机文件数: $HOST_FILES"
    echo "   容器内文件数: $CONTAINER_FILES"
    
    if [ "$HOST_FILES" -gt 0 ]; then
        log_ok "数据持久化正常"
    else
        log_warn "宿主机数据目录为空"
    fi
}

# ---------- backup: 备份数据 ----------
do_backup() {
    local BACKUP_DIR="$PROJECT_DIR/data-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    echo "💾 备份数据到: $BACKUP_DIR"
    
    # 如果有运行的容器，先导出容器内数据
    if docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        docker exec "$CONTAINER_NAME" tar czf /tmp/lenslab-data.tar.gz -C /app data 2>/dev/null && \
            docker cp "$CONTAINER_NAME:/tmp/lenslab-data.tar.gz" "$BACKUP_DIR/" 2>/dev/null && \
            docker exec "$CONTAINER_NAME" rm -f /tmp/lenslab-data.tar.gz
        log_ok "已从容器导出备份"
    fi
    
    # 也复制宿主机数据
    cp -r "$DATA_DIR"/* "$BACKUP_DIR/" 2>/dev/null || true
    log_ok "宿主机数据已备份"
    
    echo "   备份大小: $(du -sh "$BACKUP_DIR" | cut -f1)"
}

# ---------- restore: 从备份恢复 ----------
do_restore() {
    local BACKUPS=$(ls -dt "$PROJECT_DIR"/data-backup-* 2>/dev/null | head -5)
    
    if [ -z "$BACKUPS" ]; then
        log_err "没有找到备份目录"
        return 1
    fi
    
    echo "可用的备份:"
    echo "$BACKUPS" | nl -v 0
    echo ""
    
    read -p "选择备份编号 (0-$(echo "$BACKUPS" | wc -l | tr -d ' ')，输入 q 退出): " idx
    if [ "$idx" = "q" ] || [ -z "$idx" ]; then
        echo "取消恢复"
        return 0
    fi
    
    local TARGET=$(echo "$BACKUPS" | sed -n "$((idx+1))p")
    if [ -z "$TARGET" ]; then
        log_err "无效的编号"
        return 1
    fi
    
    echo "⚠️  从 $TARGET 恢复数据到 $DATA_DIR"
    read -p "确认恢复？(y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "取消恢复"
        return 0
    fi
    
    # 停止容器
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    
    # 恢复数据
    cp -rf "$TARGET"/* "$DATA_DIR/"
    chown -R 1000:1000 "$DATA_DIR" 2>/dev/null || true
    
    # 重启容器
    docker start "$CONTAINER_NAME"
    log_ok "数据恢复完成，容器已重启"
}

# ---------- clean: 清理生成的临时文件 ----------
do_clean() {
    echo "🧹 清理 AI 生成的临时文件..."
    
    GENERATED_SIZE=$(du -sh "$DATA_DIR/generated" 2>/dev/null | cut -f1)
    echo "   当前 generated/ 大小: ${GENERATED_SIZE:-0}"
    
    read -p "删除 generated/ 下的所有文件？(y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "取消清理"
        return 0
    fi
    
    rm -rf "$DATA_DIR/generated"/*
    log_ok "临时文件已清理"
}

# ---------- 主入口 ----------
case "${1:-help}" in
    init)     do_init ;;
    verify)   do_verify ;;
    backup)   do_backup ;;
    restore)  do_restore ;;
    clean)    do_clean ;;
    *)
        echo "=========================================="
        echo "  镜头演算室 · LensLab 数据管理"
        echo "=========================================="
        echo ""
        echo "用法: $0 [init|verify|backup|restore|clean]"
        echo ""
        echo "  init     初始化数据目录结构"
        echo "  verify   验证数据持久化配置"
        echo "  backup   备份全部数据"
        echo "  restore  从备份恢复数据"
        echo "  clean    清理 AI 生成的临时文件"
        echo ""
        echo "数据目录: $DATA_DIR"
        echo "=========================================="
        ;;
esac
