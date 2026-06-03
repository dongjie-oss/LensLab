FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# 创建上传和结果目录
RUN mkdir -p uploads results

# 暴露端口
EXPOSE 8765

# 启动
CMD ["python", "-m", "uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8765"]
