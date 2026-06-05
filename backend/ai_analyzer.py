"""
AI 分析引擎 - OpenAI 兼容协议
支持任何 OpenAI API 兼容的模型服务（DeepSeek、Moonshot、本地 Ollama 等）
"""

import os
import json
import logging
from typing import Optional
from openai import OpenAI

logger = logging.getLogger(__name__)

# 从 config_manager 读取配置（与后台管理面板统一）
try:
    from .config_manager import get_ai_config
except ImportError:
    from config_manager import get_ai_config


def _get_cfg():
    cfg = get_ai_config()
    return cfg.get("api_key", ""), cfg.get("base_url", "https://api.openai.com/v1"), cfg.get("model", "gpt-4o-mini")


def get_client() -> Optional[OpenAI]:
    """获取 OpenAI 客户端"""
    api_key, base_url, _ = _get_cfg()
    if not api_key:
        return None
    return OpenAI(api_key=api_key, base_url=base_url)


# AI 分析系统提示词
SYSTEM_PROMPT = """你是一位资深摄影曝光分析专家。请根据测光数据对照片进行深度逐区域分析。

要求：
1. **整体曝光判断**：根据平均亮度和直方图分布，判断曝光是否准确，给出EV补偿建议
2. **逐区域测光分析**：针对每个测光点（如左上、正中、右下等），分析该区域曝光是否合理，是否存在过曝/欠曝风险
3. **明暗对比与动态范围**：分析最亮和最暗区域的EV差值，判断光比大小
4. **直方图解读**：解读亮度分布（暗部/中间调/高光的比例），指出是否有信息溢出
5. **拍摄建议**：具体的拍摄参数调整建议（曝光补偿、光圈、ISO方向）
6. **后期方向**：针对当前曝光情况的具体后期调整建议

注意：
- 每个测光点单独点评，说明该位置在画面中的作用
- 指出最需要关注的区域
- 给出明确、可操作的建议
- 使用专业但易懂的语言
- 总字数控制在 400 字以内，语言精炼"""


def build_user_prompt(
    mode_name: str,
    avg_brightness: float,
    metering_points: list[dict],
    scene: str = "",
    histogram: list[int] = None,
    img_width: int = 0,
    img_height: int = 0,
) -> str:
    """构建用户提示词"""
    # 直方图分析
    hist_section = "直方图未提供"
    if histogram and len(histogram) == 32:
        shadows = sum(histogram[:11])
        mids = sum(histogram[11:21])
        highlights = sum(histogram[21:])
        total = shadows + mids + highlights
        if total > 0:
            pct = lambda v: round(v / total * 100, 1)
            hist_section = f"亮度分布：暗部占{pct(shadows)}%，中间调占{pct(mids)}%，高光占{pct(highlights)}%"

    ev_list = [p.get("ev", 0) for p in metering_points]
    max_ev = max(ev_list) if ev_list else 0
    min_ev = min(ev_list) if ev_list else 0
    ev_range = max_ev - min_ev

    lines = [f"测光模式：{mode_name}（{len(metering_points)}个区域）"]
    if scene:
        lines.append(f"拍摄场景：{scene}")
    lines.append(f"图片尺寸：{img_width}×{img_height}")
    lines.append(f"整体平均亮度：{avg_brightness} / 255（参考：中性灰≈128）")
    lines.append(f"EV范围：{min_ev:.2f} ~ {max_ev:.2f}（差值{ev_range:.2f}）")
    lines.append("")
    lines.append(hist_section)
    lines.append("")
    lines.append(f"=== 逐区域测光数据（{len(metering_points)}个区域）===")

    for p in metering_points:
        ev = p.get("ev", 0)
        bri = p.get("brightness", 0)
        status = ""
        if ev >= 1.5:
            status = "⚠️ 过曝风险"
        elif ev >= 0.7:
            status = "偏高"
        elif ev <= -1.5:
            status = "⚠️ 欠曝风险"
        elif ev <= -0.7:
            status = "偏低"
        elif abs(ev) < 0.3:
            status = "准确"
        else:
            status = "可接受"
        cx_pct = round(p.get("cx", 0) / max(img_width, 1) * 100, 1)
        cy_pct = round(p.get("cy", 0) / max(img_height, 1) * 100, 1)
        lines.append(f"  {p['name']}（位于画面{cx_pct}%/{cy_pct}%）：亮度={bri}, EV={p.get('ev_display', '')}, 状态={status}")

    return "\n".join(lines)


def analyze_with_ai(
    mode_name: str,
    avg_brightness: float,
    metering_points: list[dict],
    scene: str = "",
    histogram: list[int] = None,
    img_width: int = 0,
    img_height: int = 0,
) -> Optional[str]:
    """
    调用 AI 模型分析曝光数据

    Args:
        mode_name: 测光模式名称
        avg_brightness: 整体平均亮度
        metering_points: 测光点数据列表
        scene: 拍摄场景（可选）
        histogram: 直方图数据（32个bin）
        img_width: 图片宽度
        img_height: 图片高度

    Returns:
        AI 分析文本，失败返回 None
    """
    client = get_client()
    if not client:
        logger.info("AI analysis skipped: no API key configured")
        return None

    _, _, model = _get_cfg()
    user_prompt = build_user_prompt(
        mode_name, avg_brightness, metering_points, scene,
        histogram=histogram, img_width=img_width, img_height=img_height,
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=600,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"AI analysis failed: {e}")
        return None
