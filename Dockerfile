# =============================================
# 镜头演算室 · LensLab v1.0.2
# 三阶段构建：Node 编译 → Python 依赖 → 精简运行时
# 目标：从 2.4GB 压到 ~300-500MB
# =============================================

ARG BUILD_VERSION=1.0.4

# ---- Stage 1: 前端编译 ----
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 只复制依赖声明，利用 Docker 缓存层
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# 复制前端源码并编译
COPY frontend/ ./
RUN node compile.js

# ---- Stage 2: Python 依赖（用虚拟环境减小镜像层）----
FROM python:3.11-slim AS python-builder

WORKDIR /app

COPY backend/requirements.txt .
RUN python -m venv /install/venv && \
    /install/venv/bin/pip install --no-cache-dir -r requirements.txt && \
    find /install/venv/bin -maxdepth 1 -type f -name 'uvicorn*' -exec sh -c 'printf "#!/opt/venv/bin/python\n" | cat - "${1}" > "${1}.tmp" && mv "${1}.tmp" "${1}" && chmod +x "${1}"' _ {} \;

# ---- Stage 3: 运行时（精简镜像）----
FROM python:3.11-slim

ARG BUILD_VERSION=1.0.4

WORKDIR /app

# 复制虚拟环境（比 /usr/local 方式更精简）
COPY --from=python-builder /install/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 复制后端代码
COPY backend/ ./backend/

# 复制前端编译产物（仅 dist 文件，不含 node_modules）
COPY --from=frontend-builder /app/frontend/index.html ./frontend/index.html
COPY --from=frontend-builder /app/frontend/assets ./frontend/assets

# 数据目录（挂载点）
RUN mkdir -p /app/data /app/data/uploads /app/data/results /app/data/generated /app/data/templates

# 预置默认配置文件到镜像（首次启动时自动复制）
COPY data/VERSIONS.json.bak /app/data/VERSIONS.json
RUN echo '{"data_version":1,"items":[]}' > /app/data/history.json
RUN echo '{}' > /app/data/config.json

# 版本文件
RUN echo "{\"version\":\"${BUILD_VERSION}\",\"build_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"git_sha\":\"dev\"}" > /app/version.json

# 入口脚本
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8765

WORKDIR /app/backend

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
