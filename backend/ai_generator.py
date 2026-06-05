"""
AI 图片生成引擎 - 基于 Agnes AI 图片生成 API
使用 agnes-image-2.1-flash 模型
"""

import base64
import io
import json
import logging
import threading
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path
from typing import Optional
from PIL import Image
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    from .config_manager import get_ai_image_config, get_ai_config
except ImportError:
    from config_manager import get_ai_image_config, get_ai_config

_tasks = {}
_lock = threading.Lock()
_cancelled = set()  # 已取消的任务 ID
_cancel_lock = threading.Lock()

import os
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent.parent / "data")).resolve()
GENERATED_DIR = DATA_DIR / "generated"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)


def _get_cfg():
    return get_ai_image_config()


def _analyze_image_content(image_path: Path) -> str:
    """用 PIL 本地分析图片内容：色彩、亮度、构图方向，生成详细的中文描述"""
    try:
        img = Image.open(image_path).convert('RGB')
        w, h = img.size
        # 缩小采样
        small = img.copy()
        small.thumbnail((200, 200))
        pixels = list(small.getdata())
        total = len(pixels)
        if total == 0:
            return "一张照片"

        # 平均色
        r_avg = sum(p[0] for p in pixels) // total
        g_avg = sum(p[1] for p in pixels) // total
        b_avg = sum(p[2] for p in pixels) // total
        brightness = (r_avg * 0.299 + g_avg * 0.587 + b_avg * 0.114) / 255.0

        # 主色调
        warm = 0  # 暖色像素
        cool = 0  # 冷色像素
        dark = 0  # 暗像素
        greenish = 0
        skin_like = 0
        sky_like = 0
        for r, g, b in pixels:
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum < 50:
                dark += 1
            if r > b + 20:
                warm += 1
            elif b > r + 20:
                cool += 1
            if g > r and g > b:
                greenish += 1
            # 类肤色检测
            if 100 < r < 240 and 60 < g < 200 and 40 < b < 180 and r > g > b:
                skin_like += 1
            # 类天空检测
            if 100 < b and b > r + 10 and b > g:
                sky_like += 1

        warm_pct = warm / total * 100
        cool_pct = cool / total * 100
        dark_pct = dark / total * 100
        green_pct = greenish / total * 100
        skin_pct = skin_like / total * 100
        sky_pct = sky_like / total * 100

        # 方向
        orientation = '竖构图' if h > w else ('横构图' if w > h else '正方形构图')

        # 光线描述
        if brightness < 0.3:
            lighting = '光线较暗，低调氛围'
        elif brightness < 0.45:
            lighting = '光线柔和偏暗'
        elif brightness < 0.6:
            lighting = '曝光适中，光线自然'
        elif brightness < 0.75:
            lighting = '光线明亮'
        else:
            lighting = '高调明亮，光感充足'

        # 色调描述
        tone_parts = []
        if warm_pct > cool_pct and warm_pct > 15:
            tone_parts.append('暖色调')
        elif cool_pct > warm_pct and cool_pct > 15:
            tone_parts.append('冷色调')
        if dark_pct > 30:
            tone_parts.append('暗调为主')
        if green_pct > 15:
            tone_parts.append('有绿色植被')
        if skin_pct > 5:
            tone_parts.append('有人物（肤色区域）')
        if sky_pct > 10:
            tone_parts.append('有天空或蓝色背景')
        tone_desc = '，'.join(tone_parts) if tone_parts else '混合色调'

        # 主色
        main_color = f'RGB({r_avg},{g_avg},{b_avg})'

        desc = (
            f"这是一张{orientation}的照片（{w}×{h}）。"
            f"画面以{tone_desc}为主，{lighting}。"
            f"平均色彩为{main_color}，" 
            f"暖色区域占{warm_pct:.0f}%，冷色区域占{cool_pct:.0f}%。"
            f"画面整体亮度为{brightness:.0%}。"
        )
        return desc
    except Exception as e:
        logger.warning(f"Image analysis failed: {e}")
        return "一张照片"


def _call_llm_describe(api_key: str, base_url: str, model: str, image_path: Path) -> str:
    """调用文字 AI 的 vision 能力描述图片内容，返回详细中文描述"""
    try:
        # 编码图片为 base64
        img = Image.open(image_path)
        if max(img.size) > 1024:
            scale = 1024 / max(img.size)
            img = img.resize((int(img.width * scale), int(img.height * scale)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        b64 = base64.b64encode(buf.getvalue()).decode()

        # 构造 vision 请求
        base = base_url.rstrip('/')
        if base.endswith('/v1'):
            url = base + '/chat/completions'
        else:
            url = base + '/v1/chat/completions'

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "仔细描述这张照片的内容：拍摄了什么主体或场景、什么样的构图、光线如何、"
                                    "主要颜色、画面氛围、这是一张什么类型的照片（人像/风景/街拍/静物等）。"
                                    "请用一段流畅的中文描述，80-120字。"
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                        }
                    ]
                }
            ],
            "max_tokens": 300,
            "temperature": 0.1,
        }

        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "choices" in data and len(data["choices"]) > 0:
            desc = data["choices"][0]["message"]["content"]
            logger.info(f"AI describe: {desc[:120]}")
            return desc.strip()
        return "一张照片"
    except Exception as e:
        logger.warning(f"Failed to describe image via LLM: {e}")
        return "一张照片"


def _generate_one(api_key: str, base_url: str, model: str, prompt: str, image_path: Optional[Path] = None) -> Optional[bytes]:
    """生成单张图片（图生图：传原图 base64 给 extra_body.image）"""
    try:
        url = f"{base_url}/images/generations"
        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            "extra_body": {
                "response_format": "url",
            },
        }

        # 图生图：把原图编码为 base64 data URL
        if image_path and image_path.exists():
            img = Image.open(image_path)
            # 限制尺寸避免 payload 过大
            if max(img.size) > 1536:
                scale = 1536 / max(img.size)
                img = img.resize((int(img.width * scale), int(img.height * scale)))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            payload["extra_body"]["image"] = [f"data:image/png;base64,{b64}"]
        body = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "data" in data and len(data["data"]) > 0:
            item = data["data"][0]
            if "url" in item and item["url"]:
                with urllib.request.urlopen(item["url"], timeout=30) as img_resp:
                    return img_resp.read()
            elif "b64_json" in item and item["b64_json"]:
                return base64.b64decode(item["b64_json"])

        logger.error(f"No image data in response: {json.dumps(data)[:300]}")
        return None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        logger.error(f"Image generation API error: {e.code} {err_body[:200]}")
        return None
    except Exception as e:
        logger.error(f"Image generation failed: {e}")
        return None


def _save_generated_image(img_bytes: bytes, task_id: str, index: int) -> str:
    """保存生成的图片，返回相对 URL 路径"""
    filename = f"{task_id}_{index}.png"
    filepath = GENERATED_DIR / filename
    filepath.write_bytes(img_bytes)
    return f"/generated/{filename}"


def start_generation(file_id: str, mode: str = "style", custom_prompts: list = None, similar: bool = False, global_style: dict = None, num_images: int = 9) -> str:
    """启动图片生成任务"""
    task_id = str(uuid.uuid4())[:12]
    with _lock:
        _tasks[task_id] = {
            "status": "generating",
            "progress": 0,
            "total": num_images,
            "images": [],
            "error": None,
            "created_at": time.time(),
            "cancelled": False,
        }
    thread = threading.Thread(
        target=_run_generation, args=(task_id, file_id, mode), kwargs={"custom_prompts": custom_prompts, "similar": similar, "global_style": global_style, "num_images": num_images}, daemon=True
    )
    thread.start()
    return task_id


def cancel_generation(task_id: str) -> bool:
    """取消生图任务"""
    with _lock:
        if task_id not in _tasks:
            return False
        _tasks[task_id]["cancelled"] = True
        _tasks[task_id]["status"] = "cancelled"
    with _cancel_lock:
        _cancelled.add(task_id)
    return True


def _is_cancelled(task_id: str) -> bool:
    with _cancel_lock:
        return task_id in _cancelled


def _run_generation(task_id: str, file_id: str, mode: str, custom_prompts: list = None, similar: bool = False, global_style: dict = None, num_images: int = 9):
    """后台执行图片生成"""
    try:
        cfg = _get_cfg()
        api_key = cfg.get("api_key", "")
        base_url = cfg.get("base_url", "https://apihub.agnes-ai.com/v1")
        if not api_key:
            raise Exception("图片生成服务未配置或 API Key 无效")
        model = cfg.get("model", "agnes-image-2.1-flash")

        # 查找原图
        result_path = DATA_DIR / "results" / f"{file_id}.json"
        if not result_path.exists():
            raise Exception("分析结果不存在，请先分析图片")
        result_data = json.loads(result_path.read_text())
        original_name = result_data.get("original_name", "")

        uploads_dir = DATA_DIR / "uploads"
        image_path = uploads_dir / f"{file_id}_{original_name}"
        if not image_path.exists():
            for f in uploads_dir.iterdir():
                if f.stem.startswith(file_id):
                    image_path = f
                    break
        if not image_path.exists():
            raise Exception(f"原图文件不存在: {file_id}")

        # 检查取消
        if _is_cancelled(task_id):
            with _lock: _tasks[task_id]["status"] = "cancelled"
            return

        # 用 AI 文字 vision 模型详细描述原图内容
        logger.info(f"Describing image: {image_path.name}")
        text_cfg = get_ai_config()
        text_api_key = text_cfg.get("api_key", "")
        text_base_url = text_cfg.get("base_url", "")
        text_model = text_cfg.get("model", "")

        content_desc = _analyze_image_content(image_path)

        logger.info(f"Content description: {content_desc}")

        # 检查取消
        if _is_cancelled(task_id):
            with _lock: _tasks[task_id]["status"] = "cancelled"
            return

        # 9 种风格，支持自定义提示词混合
        default_styles = [
            {"prompt": "电影级布光，金色时刻暖调，细节丰富，8k画质。", "label": "电影感"},
            {"prompt": "阴郁氛围，戏剧性阴影，胶片颗粒感，艺术风格。", "label": "暗调氛围"},
            {"prompt": "柔和漫射光线，粉彩色调，梦幻美感，像艺术品。", "label": "梦幻柔光"},
            {"prompt": "高对比度，鲜艳色彩，充满活力，现代感十足。", "label": "高饱和"},
            {"prompt": "自然日光，干净清新，极简主义，杂志风格。", "label": "清新自然"},
            {"prompt": "落日余晖，暖橙色氛围，浪漫情调，专业摄影。", "label": "暖金落日"},
            {"prompt": "冷蓝色调，安静平和，空灵之美。", "label": "冷色宁静"},
            {"prompt": "影棚布光，锐利细节，精致质感，高端质感。", "label": "高清质感"},
            {"prompt": "户外自然光，色彩丰富，令人惊叹的视野，获奖摄影级别。", "label": "户外风光"},
        ]

        style_prompts = []

        # === 新生图策略 ===
        # 什么都不选 → 9张不同默认风格
        # 只选全局风格 → 1张占满9格
        # 全局+类似图片(无提示词) → 9张不同内容
        # 1个提示词 → 1张占满9格
        # N个提示词 → N张(不足9格空位不显示)
        # 全局+提示词 → 全局风格+提示词按顺序
        # 优先级：全局 > 提示词 > 类似图片

        if global_style and not custom_prompts and not similar:
            # 只选全局风格 → 1张占满9格
            style_text = global_style.get("content", "")
            style_name = global_style.get("name", "全局风格")
            base_prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{style_text}"
            style_prompts.append({"prompt": base_prompt, "label": style_name})
            logger.info(f"全局风格 only → 1 image across all 9 cells")

        elif global_style and not custom_prompts and similar:
            # 全局+类似图片(无提示词) → 9张不同内容/姿态
            style_text = global_style.get("content", "")
            style_name = global_style.get("name", "全局风格")
            diverse_hints = [
                "人物呈现不同姿态和表情",
                "人物面部侧向不同方向",
                "人物手部动作和互动",
                "远景和近景交替构图",
                "不同光影氛围",
                "人物与环境互动",
                "不同角度拍摄",
                "情绪氛围差异化",
                "不同光线色调处理",
            ]
            for i in range(9):
                hint = diverse_hints[i % len(diverse_hints)]
                prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。{hint}。风格：{style_text}。请参考原图的构图和内容。"
                style_prompts.append({"prompt": prompt, "label": f"{style_name}·{hint[:6]}"})
            logger.info(f"全局风格 + 类似图片 → 9 diverse images")

        elif not global_style and not custom_prompts:
            # 什么都不选 → 9张不同默认风格
            for ds in default_styles:
                prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{ds['prompt']}"
                style_prompts.append({"prompt": prompt, "label": ds["label"]})
            logger.info(f"默认模式 → 9 different default styles")

        elif custom_prompts and len(custom_prompts) == 1 and not global_style:
            cp = custom_prompts[0]
            if not similar:
                # 1个提示词(无类似) → 9张不同风格
                for ds in default_styles:
                    prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{ds['prompt']}。{cp.get('content', '')}"
                    style_prompts.append({"prompt": prompt, "label": f"{ds['label']}·{cp.get('name', '提示词')}"})
                logger.info(f"1 custom prompt no similar → 9 images with different styles")
            else:
                # 1个提示词+类似图片 → 9张(1号提示词，2-9号类似图片多样)
                cp_content = cp.get('content', '')
                base_prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。{cp_content}"
                style_prompts.append({"prompt": base_prompt, "label": cp.get('name', '提示词')})
                diverse_hints = [
                    "人物呈现不同姿态和表情",
                    "人物面部侧向不同方向",
                    "人物手部动作和互动",
                    "远景和近景交替构图",
                    "不同光影氛围",
                    "人物与环境互动",
                    "不同角度拍摄",
                    "情绪氛围差异化",
                ]
                for i in range(8):
                    hint = diverse_hints[i]
                    prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。{cp_content}。{hint}。请参考原图的构图和内容。"
                    style_prompts.append({"prompt": prompt, "label": f"{cp.get('name', '提示词')}·{hint[:6]}"})
                logger.info(f"1 custom prompt + similar → 9 images (1 with prompt, 2-9 diverse)")

        elif custom_prompts and len(custom_prompts) > 0:
            # 有提示词（1个或多个）
            for i, cp in enumerate(custom_prompts):
                prompt_text = f"基于以下照片内容重新创作高质量图片：{content_desc}。{cp.get('content', '')}"
                if global_style:
                    # 全局+提示词：全局风格为基底，提示词内容叠加
                    style_text = global_style.get("content", "")
                    style_name = global_style.get("name", "全局风格")
                    prompt_text += f"。风格：{style_text}"
                if similar:
                    prompt_text += "。请参考原图的构图和内容。"
                label = cp.get('name', f'提示词{i+1}')
                if global_style:
                    label = f"{global_style.get('name', '全局')}.{label}"
                style_prompts.append({"prompt": prompt_text, "label": label})
            logger.info(f"{len(custom_prompts)} prompts{' + global' if global_style else ''}{' + similar' if similar else ''} → {len(style_prompts)} images")

        # 确保 total 正确（实际生成数量）
        actual_total = len(style_prompts)
        with _lock:
            _tasks[task_id]["total"] = actual_total

        generated = []
        for i, item in enumerate(style_prompts):
            prompt = item["prompt"]
            label = item["label"]
            # 检查取消
            if _is_cancelled(task_id):
                logger.info(f"Task {task_id} cancelled at image {i}")
                break

            with _lock:
                _tasks[task_id]["progress"] = i
            logger.info(f"Generating image {i+1}/9 for task {task_id} [{label}] (img2img with {image_path.name})")
            img_bytes = _generate_one(api_key, base_url, model, prompt, image_path)
            if img_bytes:
                url = _save_generated_image(img_bytes, task_id, i)
                generated.append({"index": i, "url": url, "status": "done", "label": label})
                logger.info(f"Image {i+1} done: {label} - {url}")
            else:
                generated.append({"index": i, "url": None, "status": "failed", "label": label})
                logger.warning(f"Image {i+1} failed: {label}")
            with _lock:
                _tasks[task_id]["images"] = generated
                _tasks[task_id]["progress"] = i + 1

        with _lock:
            # 如果被取消了，status 可能已经设成了 cancelled
            t = _tasks[task_id]
            if t.get("cancelled"):
                t["status"] = "cancelled"
            else:
                t["status"] = "done"
            t["progress"] = len(generated)
            t["total"] = len(generated)
            t["images"] = generated
        successful = len([g for g in generated if g["status"] == "done"])
        logger.info(f"Task {task_id} completed: {successful}/{len(generated)} success")

    except Exception as e:
        logger.error(f"Generation task {task_id} failed: {e}")
        with _lock:
            _tasks[task_id]["status"] = "failed"
            _tasks[task_id]["error"] = str(e)
    finally:
        with _cancel_lock:
            _cancelled.discard(task_id)


def _basic_image_desc(image_path: Path) -> str:
    """降级方案：基础图片描述"""
    try:
        img = Image.open(image_path)
        w, h = img.size
        ratio = round(w / h, 2)
        return f"一张{['风景','纵向','正方形'][(0 if w>h else 1 if h>w else 2)]}朝向的照片，尺寸{w}x{h}"
    except Exception:
        return "一张照片"


def get_task(task_id: str) -> Optional[dict]:
    return _tasks.get(task_id)


def cleanup_old_tasks():
    cutoff = time.time() - 1800
    with _lock:
        to_remove = [k for k, v in _tasks.items() if v["created_at"] < cutoff]
        for k in to_remove:
            del _tasks[k]
    with _cancel_lock:
        _cancelled.clear()