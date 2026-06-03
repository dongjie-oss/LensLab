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

# 从环境变量读取配置
AI_API_KEY = os.environ.get("AI_API_KEY", "")
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o-mini")
AI_ENABLED = bool(AI_API_KEY)


def get_client() -> Optional[OpenAI]:
    """获取 OpenAI 客户端"""
    if not AI_ENABLED:
        return None
    return OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)


# AI 分析系统提示词
SYSTEM_PROMPT = """你是一位专业的摄影曝光分析顾问。
用户会提供一张照片的区域测光数据，包括：
- 各区域的亮度值（0-255）和曝光指数 EV（-3.0 ~ +3.0）
- 整体平均亮度
- 测光模式（九宫格/十六宫格/中心点测光等）

请根据这些数据，用中文给出专业、简洁的曝光分析建议：
1. **曝光评价**：整体曝光是否准确，是否存在过曝/欠曝
2. **高光/阴影分析**：哪些区域需要特别注意
3. **拍摄建议**：具体的曝光补偿建议（如"建议 -0.7EV"）
4. **后期建议**：如果需要后期调整，给出具体方向

请用简洁专业的语言回答，控制在 200 字以内。"""


def build_user_prompt(
    mode_name: str,
    avg_brightness: float,
    metering_points: list[dict],
    scene: str = "",
) -> str:
    """构建用户提示词"""
    lines = [f"测光模式：{mode_name}"]
    if scene:
        lines.append(f"拍摄场景：{scene}")
    lines.append(f"整体平均亮度：{avg_brightness}")
    lines.append("")
    lines.append("各区域测光数据：")

    for p in metering_points:
        ev_display = p.get("ev_display", f"{p['ev']:+.1f}")
        lines.append(
            f"  - {p['name']}: 亮度={p['brightness']}, EV={ev_display}"
        )

    return "\n".join(lines)


def analyze_with_ai(
    mode_name: str,
    avg_brightness: float,
    metering_points: list[dict],
    scene: str = "",
) -> Optional[str]:
    """
    调用 AI 模型分析曝光数据

    Args:
        mode_name: 测光模式名称
        avg_brightness: 整体平均亮度
        metering_points: 测光点数据列表
        scene: 拍摄场景（可选）

    Returns:
        AI 分析文本，失败返回 None
    """
    client = get_client()
    if not client:
        logger.info("AI analysis skipped: no API key configured")
        return None

    user_prompt = build_user_prompt(mode_name, avg_brightness, metering_points, scene)

    try:
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=500,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"AI analysis failed: {e}")
        return None
