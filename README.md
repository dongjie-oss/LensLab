# ⚡ 镜头演算室 · LensLab

> 专业级 Web 区域曝光分析工具 — 简洁 · 精准 · 大师风范

![Exposure Lab](https://img.shields.io/badge/Exposure-Lab-blue?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11+-green?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-Latest-009688?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## 功能特性

- 📸 **图片导入** — 支持 JPG / PNG，拖拽上传
- 🎯 **5种区域测光模式** — 九宫格 / 十六宫格 / 二十五宫格 / 中心点 / 重点测光
- 📊 **智能曝光指数** — 每区域独立 EV 值（-3EV ~ +3EV），128灰为基准
- 🗺️ **实时叠加显示** — 测光点直接标注在原图上，十字线 + 区域名称 + EV值
- 📈 **亮度直方图** — 全局亮度分布可视化
- 💡 **曝光评估** — 智能分析过曝/欠曝/光比，给出拍摄建议
- 🗂️ **历史记录** — 自动保存分析结果，方便前后对比
- 🎨 **大师级 UI** — 深色主题，干净简洁，专业摄影工具风格

## 适用场景

| 场景 | 推荐模式 |
|------|---------|
| 风景摄影 | 九宫格 / 十六宫格 |
| 人像摄影 | 重点测光 / 中心点 |
| 扫街街拍 | 九宫格 |
| 产品静物 | 二十五宫格 |

## 快速启动

### 方式一：本地运行

```bash
# 克隆项目
git clone https://github.com/YOUR_USERNAME/exposure-lab.git
cd exposure-lab

# 安装依赖
pip install -r backend/requirements.txt

# 启动服务
python3 run.py
```

浏览器访问: http://localhost:8765

### 方式二：Docker

```bash
docker build -t exposure-lab .
docker run -p 8765:8765 exposure-lab
```

浏览器访问: http://localhost:8765

## 项目结构

```
exposure-lab/
├── backend/
│   ├── analyzer.py        # 核心测光算法引擎
│   ├── server.py          # FastAPI 后端服务
│   └── requirements.txt   # Python 依赖
├── frontend/
│   └── index.html         # 单页前端 (React + Tailwind)
├── Dockerfile             # Docker 构建
├── run.py                 # 一键启动脚本
└── .gitignore
```

## 区域测光原理

1. 图片转为灰度图（L通道）
2. 按选定模式划分区域网格
3. 计算每个区域平均亮度（0-255）
4. 映射到曝光指数：`EV = (亮度 - 128) / 45`
5. 结果限制在 -3EV ~ +3EV 范围

## 技术栈

- **后端**: Python 3.11+ / FastAPI / Pillow / NumPy
- **前端**: React 18 / Tailwind CSS / Babel Standalone
- **部署**: Docker / 任意支持 Python 的平台

## License

MIT
