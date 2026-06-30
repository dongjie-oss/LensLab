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

### 后台管理

- 入口：应用左上角齿轮图标（⚙️ 设置面板）
- 默认账号：`admin`
- 默认密码：`admin`
- 首次登录后请及时修改密码

### 技术栈

- **后端**：Python 3.11 + FastAPI + Pillow + Uvicorn
- **前端**：原生 JS（编译为单文件，无需 Node 运行时）
- **AI**：支持 OpenAI 兼容 API（DeepSeek、Kimi、OpenAI 等）
- **部署**：Docker + Docker Compose 一键启动 / Windows 独立 EXE
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

### Windows 独立 EXE

无需 Docker，直接双击运行：

- 📦 下载：[LensLab-Setup-1.0.5.exe](https://github.com/dongjie-oss/LensLab/releases/latest)
- 安装后自动创建桌面图标
- 数据目录：`C:\Users\<用户名>\.exposure-lab\`
- 单实例保护，自动选择可用端口（8765-8799）

---

## 更新日志

### v1.0.5（2026-06-30）
- **新增**：AI 生图下载按钮 — 9宫格预览每张图下方显示"下载原图"
- **新增**：历史图片预览下载按钮 — EXE 环境显示，Docker 环境隐藏
- **新增**：Windows 原生保存对话框 — PowerShell WPF SaveFileDialog，无需浏览器
- **新增**：Windows 独立 EXE 发布 — Inno Setup 中文安装包
- **新增**：Windows 单实例检测 + 自动端口选择（8765-8799）
- **新增**：配置 schema v2 结构化迁移（备份→合并→验证→删备份）
- **修复**：AI 生图 SSL 证书错误 — Nuitka 打包后 HTTPS 失败，改用 certifi
- **修复**：PowerShell 保存对话框中文乱码 — UTF-8 BOM + 英文文本
- **修复**：下载按钮位置 — 历史预览窗口按钮从图片右侧改为图片下方居中
- **修复**：前端 downloadImage 兼容 pywebview — fetch+blob 替代 `<a download>`
- **修复**：前端 metering_points 空值保护 — 防止 null/undefined 导致黑屏
- **修复**：Windows GBK 编码兼容 — 所有文件读写显式指定 encoding=utf-8
- **修复**：Inno Setup 覆盖安装桌面图标重复 — 加 AppId 统一应用标识

### v1.0.4（2026-06-16）
- **新增**：移动端适配 — 抽屉导航、顶栏精简、触摸滚动、safe area
- **新增**：mobile-enhancer.js — fixed 抽屉 + 遮罩方案
- **新增**：AI 生图预览移动端布局 — 图片在上 + 提示词在下
- **新增**：版本检测升级 — GitHub version.json 零认证优先 → ACR fallback
- **新增**：手动检查更新按钮、开发版蓝色提示
- **新增**：数据持久化 — docker-entrypoint.sh 自动创建数据目录
- **新增**：启动自检增强 — 目录就绪检查、配置完整性校验
- **修复**：AI 生图 N 个提示词生成 N×9 张图 BUG
- **修复**：移动端左侧抽屉文字被全局 CSS 隐藏
- **修复**：移动端 AI 预览弹窗提示词卡片位置
- **修复**：多选模式下点击历史图片不关闭抽屉
- **修复**：右侧面板 w-0 时黑边问题
- **修复**：版本信息启动自动同步

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
