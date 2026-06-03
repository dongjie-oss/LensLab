"""
曝光分析引擎 - 区域测光核心算法
支持多种区域划分模式：9宫格/16宫格/25宫格/中心点测光/自定义
"""

import numpy as np
from PIL import Image
from dataclasses import dataclass, field
from typing import List, Tuple, Optional
import json


@dataclass
class MeteringPoint:
    """单个测光点"""
    name: str          # 区域名称
    ev: float          # 曝光指数 (-3.0 ~ +3.0)
    brightness: int    # 原始亮度 (0-255)
    cx: int            # 中心点 x
    cy: int            # 中心点 y
    x1: int            # 区域左上角 x
    y1: int            # 区域左上角 y
    x2: int            # 区域右下角 x
    y2: int            # 区域右下角 y


@dataclass
class AnalysisResult:
    """分析结果"""
    metering_points: List[MeteringPoint]
    mode: str
    avg_brightness: float
    histogram: List[int] = field(default_factory=list)
    width: int = 0
    height: int = 0


# 区域模式定义
GRID_MODES = {
    "9": {
        "name": "九宫格",
        "rows": 3,
        "cols": 3,
        "labels": [
            ["左上", "正上", "右上"],
            ["左中", "正中", "右中"],
            ["左下", "正下", "右下"],
        ],
    },
    "16": {
        "name": "十六宫格",
        "rows": 4,
        "cols": 4,
        "labels": [
            ["左上1", "左上2", "右上1", "右上2"],
            ["左上3", "左上4", "右上3", "右上4"],
            ["左下1", "左下2", "右下1", "右下2"],
            ["左下3", "左下4", "右下3", "右下4"],
        ],
    },
    "25": {
        "name": "二十五宫格",
        "rows": 5,
        "cols": 5,
        "labels": [
            ["A1", "A2", "A3", "A4", "A5"],
            ["B1", "B2", "B3", "B4", "B5"],
            ["C1", "C2", "C3", "C4", "C5"],
            ["D1", "D2", "D3", "D4", "D5"],
            ["E1", "E2", "E3", "E4", "E5"],
        ],
    },
    "center": {
        "name": "中心点测光",
        "rows": 1,
        "cols": 1,
        "labels": ["中心点"],
    },
    "spot": {
        "name": "重点测光",
        "rows": 3,
        "cols": 3,
        "labels": [
            ["周边1", "周边2", "周边3"],
            ["周边4", "中心重点", "周边5"],
            ["周边6", "周边7", "周边8"],
        ],
    },
}


def brightness_to_ev(brightness: float, method: str = "standard") -> float:
    """
    将亮度值(0-255)转换为曝光指数(-3 ~ +3)
    128 为正确曝光 (EV=0)
    """
    if method == "standard":
        # 标准映射: 128=0EV, 每约45个亮度值对应1档EV
        ev = (brightness - 128) / 45.0
    elif method == "strict":
        # 严格映射: 每32个亮度值对应1档
        ev = (brightness - 128) / 32.0
    elif method == "loose":
        # 宽松映射: 每64个亮度值对应1档
        ev = (brightness - 128) / 64.0
    else:
        ev = (brightness - 128) / 45.0

    return round(max(-3.0, min(3.0, ev)), 1)


def format_ev(ev: float) -> str:
    """格式化曝光指数显示"""
    if ev > 0:
        return f"+{ev:.1f}"
    elif ev < 0:
        return f"{ev:.1f}"
    else:
        return "±0"


def analyze_image(
    image_path: str,
    mode: str = "9",
    ev_method: str = "standard",
    custom_model: Optional[dict] = None,
) -> AnalysisResult:
    """
    分析图片的区域曝光
    
    Args:
        image_path: 图片路径
        mode: 区域模式 ("9"/"16"/"25"/"center"/"spot")
        ev_method: EV计算方法 ("standard"/"strict"/"loose")
        custom_model: 自定义模型参数（预留）
    
    Returns:
        AnalysisResult
    """
    img = Image.open(image_path).convert("RGB")
    gray = img.convert("L")
    arr = np.array(gray)
    h, w = arr.shape

    grid_config = GRID_MODES.get(mode, GRID_MODES["9"])
    rows = grid_config["rows"]
    cols = grid_config["cols"]
    labels = grid_config["labels"]

    cell_h = h / rows
    cell_w = w / cols

    metering_points = []
    total_brightness = 0
    count = 0

    for r in range(rows):
        for c in range(cols):
            y1 = int(r * cell_h)
            y2 = int((r + 1) * cell_h) if r < rows - 1 else h
            x1 = int(c * cell_w)
            x2 = int((c + 1) * cell_w) if c < cols - 1 else w

            region = arr[y1:y2, x1:x2]
            avg = float(np.mean(region))
            ev = brightness_to_ev(avg, ev_method)

            # 中心点坐标
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2

            # 应用自定义模型权重（预留）
            if custom_model and "weights" in custom_model:
                weight = custom_model["weights"].get(labels[r][c], 1.0)
                ev = round(ev * weight, 1)

            point = MeteringPoint(
                name=labels[r][c],
                ev=ev,
                brightness=int(avg),
                cx=cx,
                cy=cy,
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
            )
            metering_points.append(point)
            total_brightness += avg
            count += 1

    # 计算直方图
    histogram_arr, _ = np.histogram(arr, bins=256, range=(0, 256))
    # 压缩到32个bin便于前端展示
    histogram = [
        int(np.sum(histogram_arr[i * 8 : (i + 1) * 8])) for i in range(32)
    ]

    return AnalysisResult(
        metering_points=metering_points,
        mode=mode,
        avg_brightness=round(total_brightness / count, 1),
        histogram=histogram,
        width=w,
        height=h,
    )


def result_to_dict(result: AnalysisResult) -> dict:
    """将分析结果转为字典"""
    return {
        "mode": result.mode,
        "mode_name": GRID_MODES.get(result.mode, {}).get("name", result.mode),
        "avg_brightness": result.avg_brightness,
        "histogram": result.histogram,
        "width": result.width,
        "height": result.height,
        "metering_points": [
            {
                "name": p.name,
                "ev": p.ev,
                "ev_display": format_ev(p.ev),
                "brightness": p.brightness,
                "cx": p.cx,
                "cy": p.cy,
                "x1": p.x1,
                "y1": p.y1,
                "x2": p.x2,
                "y2": p.y2,
            }
            for p in result.metering_points
        ],
    }
