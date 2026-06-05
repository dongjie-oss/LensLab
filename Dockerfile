FROM python:3.12

WORKDIR /app

# 安装依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -U pip setuptools wheel && \
    pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# 复制代码
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# 创建数据目录（Docker 挂载点）
RUN mkdir -p /app/data /app/backend/uploads /app/backend/results

# 写入版本文件（CI 构建时会覆盖）
RUN echo '{"version":"1.0.0","build_time":"dev","git_sha":"dev"}' > /app/version.json

# 复制入口脚本
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8765

WORKDIR /app/backend

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
