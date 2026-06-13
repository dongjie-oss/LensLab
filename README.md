# 镜头演算室 · LensLab

> 📷 摄影区域曝光分析 + AI 智能生图工具

[![GitHub release](https://img.shields.io/github/v/release/dongjie-oss/LensLab)](https://github.com/dongjie-oss/LensLab/releases)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://github.com/dongjie-oss/LensLab#docker-部署)

---

## 项目简介

**镜头演算室 LensLab** 是一款基于 Web 的摄影区域曝光分析工具，结合 AI 智能分析与生图能力，帮助摄影师精准判断曝光情况。

### 核心功能

| 功能 | 说明 |
|------|------|
| 🔍 区域曝光分析 | 上传照片 → 可视化 10 区域测光 → 判断曝光状态 |
| 📊 AI 图表分析 | 直方图 / 分区亮度 AI 自动解读 |
| 🎨 AI 智能生图 | 18 种预设风格模板（人像×9 + 通用×9）+ 自定义提示词生图 |
| 🤖 AI 内容识别 | 自动识别图片内容类型（人像/风景/静物），匹配对应生图策略 |
| 🖼️ 大图预览 | 预览图旁完整展示当前图片的提示词和标签 |
| 🧹 系统管理 | AI 生成图片自动/手动清理 |
| ⚙️ 设置面板 | 模型配置、版本查看、一键检查更新 |

### 技术栈

- **后端**：Python 3.11 + FastAPI + Pillow + Uvicorn
- **前端**：原生 JS（编译为单文件，无需 Node 运行时）
- **AI**：支持 OpenAI 兼容 API（DeepSeek、Kimi、OpenAI 等）
- **部署**：Docker + Docker Compose 一键启动
- **端口**：`8765`（所有部署方式统一）

---

## 部署

### Docker 一行启动

```bash
docker run -d \
  -p 8765:8765 \
  -v ./lenslab-data:/app/data \
  -e TZ=Asia/Shanghai \
  --name lenslab \
  --restart unless-stopped \
  registry.cn-hangzhou.aliyuncs.com/exposure-lab/exposure-lab:latest
```

访问：`http://localhost:8765`

### Docker Compose

```yaml
version: "3.8"

services:
  lenslab:
    image: registry.cn-hangzhou.aliyuncs.com/exposure-lab/exposure-lab:latest
    container_name: lenslab
    restart: unless-stopped
    ports:
      - "8765:8765"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Asia/Shanghai
      - DATA_DIR=/app/data
```

```bash
# 启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 数据目录

| 路径 | 说明 |
|------|------|
| `/app/data/config.json` | AI 模型配置（API Key 等） |
| `/app/data/uploads/` | 用户上传照片 |
| `/app/data/results/` | 分析结果 JSON |
| `/app/data/generated/` | AI 生图临时缓存 |
| `/app/data/VERSIONS.json` | 版本元数据 |

> ⚠️ 挂载 `./data` 即可持久化所有数据，容器重建不丢失。

---

## 更新日志

### v1.0.3（2026-06-13）
- **新增**：AI 图片内容智能识别 — 自动分类人像 / 风景 / 静物
- **新增**：9 种人像专属风格模板（复古街拍 / 日系清新 / 时尚杂志 / 黑白质感 / 暖调写真 / 冷艳大片 / 电影感人像 / 自然纪实 / 创意光影）
- **新增**：大图预览提示词面板 — 预览图旁完整展示提示词和标签
- **优化**：无限想象生成策略根据内容类型自适应，人像场景使用专属风格
- **修复**：文生图模式下分析结果栏误显示、describe 返回格式健壮性

### v1.0.2（2026-06-12）
- **新增**：系统管理 tab — 自动/手动清理 AI 生成临时图片
- **优化**：AI 生图设置面板 UI 布局改进（比例→方向→分辨率单行排列）
- **修复**：AI 生图弹窗白屏、配置丢失问题

### v1.0.1（2026-06-07）
- **新增**：自定义提示词功能、无限想象优先级系统
- **优化**：AI 生图速度（并行执行）、前端按钮动态化
- **重构**：elif 分支精简、启动检查优化

### v1.0.0（2026-06-03）
- **初始版本**：区域曝光分析、AI 图表分析、AI 生图、Docker 一键部署

---

## 更新检测

应用会自动从本仓库的 `version.json` 检查是否有新版本：

- **查询地址**：`https://raw.githubusercontent.com/dongjie-oss/LensLab/main/version.json`
- **无需认证**：仓库公开，直接 HTTP GET 即可
- **检查频率**：设置页面手动点击 / 启动时自动检查

---

## 许可

本项目为闭源软件。你可以自由部署和使用，但不得修改、分发源码或进行商业再分发。

---

<p align="center">
  <i>LensLab · 让每一张照片的曝光都经得起推敲</i>
</p>
