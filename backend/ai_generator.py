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
from concurrent.futures import ThreadPoolExecutor, as_completed
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

# ===================== 并发控制参数（从 config.json 读取，此处为 fallback 默认值） =====================
MAX_CONCURRENT = 3
REQUEST_INTERVAL = 1
MAX_429_RETRIES = 3
BACKOFF_BASE = 15

def _load_concurrent_params():
    """从配置文件加载并发参数，返回 (max_concurrent, interval_sec, max_retries, backoff_base)"""
    try:
        cfg = get_ai_image_config()
        return (
            cfg.get("max_concurrent", MAX_CONCURRENT),
            cfg.get("request_interval", REQUEST_INTERVAL),
            cfg.get("max_429_retries", MAX_429_RETRIES),
            cfg.get("429_backoff_base", BACKOFF_BASE),
        )
    except Exception:
        return MAX_CONCURRENT, REQUEST_INTERVAL, MAX_429_RETRIES, BACKOFF_BASE


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
                            "text": "请用不超过50字的中文概括这张照片的拍摄场景类型和氛围特点，只需要说明场景（如：城市街景/室内客厅/海边沙滩/公园草地等）和氛围（如：阴天/日落/明亮/昏暗等），绝对不要描述照片中的人物外貌、具体物体名称或细节。例如：\n\n正确的描述：一个阴天下的城市街头，路面湿滑，远处有模糊的行人剪影。\n错误的描述：一个穿着红色外套的女人在雨中走着。\n请用正确的格式输出。"
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



def _call_llm_generate_prompts(api_key: str, base_url: str, model: str, image_path: Path, num_images: int = 9) -> list[dict]:
    """调用文本模型生成多个创意提示词
    每个提示词包含：场景、主体、角度、风格
    要求：环境类似，人物动作形态各异
    """
    try:
        # 读取图片并编码
        img = Image.open(image_path)
        if max(img.size) > 1024:
            scale = 1024 / max(img.size)
            img = img.resize((int(img.width * scale), int(img.height * scale)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        b64 = base64.b64encode(buf.getvalue()).decode()

        # 构造请求
        base = base_url.rstrip('/')
        url = base + '/chat/completions' if base.endswith('/v1') else base + '/v1/chat/completions'

        # 构建提示词：让文本模型根据原图生成 num_images 个创意
        prompt_content = f"""基于以下图片内容，生成{num_images}个完全不同的创意场景描述。
要求：
1. 每个场景保持与原图类似的总体环境氛围
2. 人物和动作必须完全不同
3. 每个场景需包含：场景描述、主体描述、拍摄角度
4. 风格多样化，涵盖不同艺术风格
5. 保持高质量摄影/绘画风格

请严格按以下JSON格式返回，不要有任何额外文字：
[
    {{"scene": "场景描述", "subject": "主体描述", "angle": "拍摄角度", "style": "风格描述"}},
    ...共{num_images}个对象
]"""

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_content
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                        }
                    ]
                }
            ],
            "max_tokens": 2000,
            "temperature": 0.8,  # 提高随机性以获得更多样化的创意
        }

        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "choices" in data and len(data["choices"]) > 0:
            response_text = data["choices"][0]["message"]["content"].strip()
            # 尝试从响应中提取 JSON
            json_start = response_text.find('[')
            json_end = response_text.rfind(']') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response_text[json_start:json_end]
                try:
                    creative_prompts = json.loads(json_str)
                    logger.info(f"✅ LLM 生成 {len(creative_prompts)} 个创意提示词")
                    return creative_prompts
                except json.JSONDecodeError:
                    logger.warning("LLM 返回格式非预期 JSON，降级使用默认提示词")
        
        logger.warning("LLM 响应格式非预期，降级使用默认提示词")
        return []
    except Exception as e:
        logger.warning(f"Failed to generate creative prompts via LLM: {e}")
        return []


def _fallback_generate_prompts(creative_prompts, style_text, style_name, content_desc, default_styles):
    """降级方案：当文本模型不可用时，用默认风格生成创意提示词"""
    for i in range(9):
        ds = default_styles[i]
        if style_text:
            prompt = (
                f"请创作第{i+1}张高质量图片："
                f"基于以下描述：{content_desc}。"
                f"风格：{style_text}，{ds['prompt']}"
                f"要求：画面丰富、构图精美、色彩协调，不要使用真实人物照片。"
            )
        else:
            prompt = (
                f"请创作第{i+1}张高质量图片："
                f"基于以下描述：{content_desc}。"
                f"风格：{ds['prompt']}"
                f"要求：画面丰富、构图精美、色彩协调，不要使用真实人物照片。"
            )
        creative_prompts.append({"prompt": prompt, "label": f"{style_name}·创意{i+1}" if style_name else f"{ds['label']}·创意{i+1}"})
        logger.info(f"降级方案 → 使用默认风格生成 {len(creative_prompts)} 个创意提示词")


def _add_default_similar_prompts(style_prompts, cp_content, cp_name):
    """降级方案：文本模型不可用时，用默认场景生成创意提示词"""
    scenes = ["繁忙的城市十字路口，车流如织的都市景观", "清晨阳光穿透薄雾的森林深处", "黄昏时分的海边渔村，渔民收网归来",
              "雪山脚下的藏族村落，经幡随风飘动", "江南水乡的乌篷船在狭窄河道中穿行", "废弃工厂里的工业废墟艺术", "樱花盛开的日本京都庭院",
              "纽约时代广场的霓虹夜景", "非洲草原上正在迁徙的角马群"]
    subjects = ["一位撑着油纸伞的江南姑娘", "一个背着竹篓的老人", "奔跑在草地上的金毛犬", "穿着汉服的少女在亭子里",
                "坐在长椅上读书的大学生", "老工匠在工作台前打铁", "在桥头拍照的外国游客", "卖花的小女孩", "放风筝的儿童"]
    angles = ["平视角度", "俯视45度仰拍", "侧面平视", "仰视低角度", "45度侧面俯视", "背面平视", "鸟瞰俯视", "超近距离特写", "远景斜侧面"]
    for i in range(9):
        prompt = (
            f"请创作第{i+1}张高质量图片，必须满足："
            f"场景：{scenes[i]}。"
            f"画面主体：{subjects[i]}。"
            f"拍摄角度：{angles[i]}。"
            f"要求：{cp_content}"
            f"不要使用真实人物照片。"
        )
        style_prompts.append({"prompt": prompt, "label": f"{cp_name}·创意{i+1}"})
    logger.info(f"降级方案 → {cp_name} + similar → 9 completely different images")


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

        # 从配置读取 429 重试参数
        _, _, max_429_retries, backoff_base = _load_concurrent_params()
        result = None
        for attempt in range(max_429_retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < max_429_retries:
                    wait = backoff_base * (attempt + 1)
                    logger.warning(f"Image generation 429 rate limit, retrying in {wait}s (attempt {attempt+1}/{max_429_retries})...")
                    time.sleep(wait)
                    continue
                raise Exception(f"Image generation failed: HTTP {e.code}")
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 0:
                    logger.warning(f"Image generation timeout, retrying once...")
                    continue
                raise Exception(f"Image generation failed after retry: {e}")

        if "data" in result and len(result["data"]) > 0:
            item = result["data"][0]
            if "url" in item and item["url"]:
                with urllib.request.urlopen(item["url"], timeout=30) as img_resp:
                    return img_resp.read()
            elif "b64_json" in item and item["b64_json"]:
                return base64.b64decode(item["b64_json"])

        logger.error(f"No image data in response: {json.dumps(result)[:300]}")
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

        # 并行执行：LLM describe原图 + LLM生成创意提示词
        logger.info(f"Starting parallel LLM calls for: {image_path.name}")
        text_cfg = get_ai_config()
        text_api_key = text_cfg.get("api_key", "")
        text_base_url = text_cfg.get("base_url", "")
        text_model = text_cfg.get("model", "")
        text_available = bool(text_api_key and text_model and text_base_url)

        content_desc = None
        creative_prompts = None

        if text_available:
            # 并行：describe + generate_prompts 两个 LLM 调用
            with ThreadPoolExecutor(max_workers=2) as llm_executor:
                # describe future
                describe_future = llm_executor.submit(
                    _call_llm_describe, text_api_key, text_base_url, text_model, image_path
                )
                # generate_prompts future
                prompts_future = llm_executor.submit(
                    _call_llm_generate_prompts, text_api_key, text_base_url, text_model, image_path
                )
                try:
                    content_desc = describe_future.result(timeout=60)
                    if content_desc and content_desc != "一张照片":
                        logger.info(f"AI vision describe: {content_desc[:120]}")
                    else:
                        content_desc = None
                except Exception as e:
                    logger.warning(f"LLM describe failed: {e}")
                try:
                    creative_prompts = prompts_future.result(timeout=60)
                    if creative_prompts:
                        logger.info(f"LLM generated {len(creative_prompts)} creative prompts")
                except Exception as e:
                    logger.warning(f"LLM generate_prompts failed: {e}")

        if not content_desc:
            content_desc = _analyze_image_content(image_path)
            logger.info(f"Using local analysis: {content_desc[:120]}")

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

        # === similar=true → 完全不同的内容，原图仅作场景参考 ===
        # 不参考具体人物外貌、建筑、树木，只用于触发场景类型（街景/室内等）
        # 每次生成时要求AI完全创造新的人物、新环境、新细节

        # === 新生图策略 ===
        # 什么都不选 → 9张不同默认风格
        # 只选全局风格 → 1张占满9格
        # 全局+类似图片(无提示词) → 9张不同风格
        # 1个提示词 → 1张占满9格
        # N个提示词 → N张(不足9格空位不显示)
        # 全局+提示词 → 全局风格+提示词按顺序
        # 优先级：全局 > 提示词 > 类似图片

        # === Priority-based prompt generation (similar=true: always 9 images) ===
        # Priority: 全局风格 > 提示词 > 无限想象
        # When similar=True:
        #   - First N slots = user prompts in order
        #   - Remaining (9-N) slots = 全局风格 if set, else random style + 无限想象
        
        if similar:
            # --- Always generate exactly 9 images ---
            style_prompts = []
            
            # creative_prompts already fetched via parallel LLM call above, skip duplicate
            
            user_prompt_count = len(custom_prompts)
            
            # Fill first N slots with user's selected prompts
            for i, cp in enumerate(custom_prompts):
                if global_style:
                    # Global style overrides prompt content: use style as the style component
                    style_text = global_style.get("content", "")
                    style_name = global_style.get("name", "全局风格")
                    prompt = f"请创作高质量图片：{cp.get('content', '')}。风格：{style_text}。画面丰富、构图精美，不要使用真实人物照片。"
                    label = f"{style_name}.{cp.get('name', f'提示词{i+1}')}"
                else:
                    prompt = f"请创作高质量图片：{cp.get('content', '')}。画面丰富、构图精美，不要使用真实人物照片。"
                    label = cp.get('name', f'提示词{i+1}')
                style_prompts.append({"prompt": prompt, "label": label})
                logger.info(f"Slot {i+1}: user prompt '{cp.get('name', '')}'")
            
            # Fill remaining slots (9 - N)
            remaining = 9 - user_prompt_count
            if remaining > 0:
                if global_style:
                    # Remaining slots use global style with unlimited imagination content
                    style_text = global_style.get("content", "")
                    style_name = global_style.get("name", "全局风格")
                    for i in range(remaining):
                        creative = creative_prompts[i] if creative_prompts and i < len(creative_prompts) else None
                        if creative:
                            scene = creative.get("scene", f"场景{i+1}")
                            subject = creative.get("subject", f"主体{i+1}")
                            angle = creative.get("angle", "平视")
                            prompt = f"请创作第{user_prompt_count + i + 1}张高质量图片：场景：{scene}。主体：{subject}。角度：{angle}。风格：{style_text}。画面丰富、构图精美，不要使用真实人物照片。"
                        else:
                            prompt = f"请创作高质量图片：场景为{default_styles[(user_prompt_count + i) % len(default_styles)]['prompt']}。风格：{style_text}。画面丰富、构图精美，不要使用真实人物照片。"
                        style_prompts.append({"prompt": prompt, "label": f"{style_name}·无限想象{user_prompt_count + i + 1}"})
                else:
                    # No global style: random style + unlimited imagination
                    for i in range(remaining):
                        creative = creative_prompts[i] if creative_prompts and i < len(creative_prompts) else None
                        if creative:
                            scene = creative.get("scene", f"场景{i+1}")
                            subject = creative.get("subject", f"主体{i+1}")
                            angle = creative.get("angle", "平视")
                            style = creative.get("style", "高质量摄影风格")
                            prompt = f"请创作第{user_prompt_count + i + 1}张高质量图片：场景：{scene}。主体：{subject}。角度：{angle}。风格：{style}。画面丰富、构图精美，不要使用真实人物照片。"
                        else:
                            ds = default_styles[(user_prompt_count + i) % len(default_styles)]
                            prompt = f"请创作高质量图片：场景为{ds['prompt']}。风格：{ds['prompt']}。画面丰富、构图精美，不要使用真实人物照片。"
                        style_prompts.append({"prompt": prompt, "label": f"无限想象{user_prompt_count + i + 1}"})
            
            logger.info(f"✅ 无限想象模式 → {len(style_prompts)} 个提示词 (用户{user_prompt_count}个 + 补位{remaining}个)")
        
        elif global_style and not custom_prompts:
            # 只选全局风格 → 1张占满9格
            style_text = global_style.get("content", "")
            style_name = global_style.get("name", "全局风格")
            base_prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{style_text}"
            style_prompts.append({"prompt": base_prompt, "label": style_name})
            logger.info(f"全局风格 only → 1 image across all 9 cells")

        elif global_style and custom_prompts:
            # 全局风格 + 自定义提示词 → 每个提示词都加全局风格
            for i, cp in enumerate(custom_prompts):
                prompt_text = f"基于以下照片内容重新创作高质量图片：{content_desc}。{cp.get('content', '')}"
                style_text = global_style.get("content", "")
                prompt_text += f"。风格：{style_text}"
                label = f"{global_style.get('name', '全局')}.{cp.get('name', f'提示词{i+1}')}"
                style_prompts.append({"prompt": prompt_text, "label": label})
            logger.info(f"全局风格 + {len(custom_prompts)} 自定义 → {len(style_prompts)} images")

        elif custom_prompts and not global_style:
            # 只有自定义提示词，无全局风格
            if num_images == 1 or len(custom_prompts) == 1:
                # 1个提示词 → 1张，纯用户提示词 + 原图内容
                cp = custom_prompts[0]
                prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。{cp.get('content', '')}"
                style_prompts.append({"prompt": prompt, "label": cp.get('name', '自定义')})
                logger.info(f"自定义提示词 only → 1 image")
            else:
                # 多个提示词 → 每个提示词 9 张不同风格
                for i, cp in enumerate(custom_prompts):
                    for ds in default_styles:
                        prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{ds['prompt']}。{cp.get('content', '')}"
                        style_prompts.append({"prompt": prompt, "label": f"{ds['label']}·{cp.get('name', f'提示词{i+1}')}"})
                logger.info(f"{len(custom_prompts)} prompts × 9 风格 → {len(style_prompts)} images")

        elif not global_style and not custom_prompts:
            # 什么都不选(无相似) → 9张不同默认风格
            for ds in default_styles:
                prompt = f"基于以下照片内容重新创作高质量图片：{content_desc}。风格：{ds['prompt']}"
                style_prompts.append({"prompt": prompt, "label": ds["label"]})
            logger.info(f"默认模式 → 9 different default styles")



        # 确保 total 正确（实际生成数量）
        actual_total = len(style_prompts)
        with _lock:
            _tasks[task_id]["total"] = actual_total

        generated = []
        total_items = len(style_prompts)
        max_conc, interval, *_ = _load_concurrent_params()

        def _gen_one(i, item):
            prompt = item["prompt"]
            label = item["label"]
            if _is_cancelled(task_id):
                return None
            gen_image_path = image_path  # img2img: always use original image as composition/color reference
            mode = 'img2img' if gen_image_path else 'text2img'
            logger.info(f"Generating image {i+1}/{total_items} for task {task_id} [{label}] ({mode})")
            t0 = time.time()
            img_bytes = _generate_one(api_key, base_url, model, prompt, gen_image_path)
            elapsed = time.time() - t0
            if img_bytes:
                url = _save_generated_image(img_bytes, task_id, i)
                logger.info(f"Image {i+1} done: {label} - {url} ({elapsed:.0f}s)")
                return {"index": i, "url": url, "status": "done", "label": label}
            else:
                logger.warning(f"Image {i+1} failed: {label} ({elapsed:.0f}s)")
                return {"index": i, "url": None, "status": "failed", "label": label}

        # 低并发 + 请求间隔控制，避免触发 429 频率限制
        with ThreadPoolExecutor(max_workers=max_conc) as executor:
            pending = []
            for i in range(total_items):
                fut = executor.submit(_gen_one, i, style_prompts[i])
                pending.append(fut)
                if i < total_items - 1:
                    time.sleep(interval)
            for fut in as_completed(pending):
                if _is_cancelled(task_id):
                    logger.info(f"Task {task_id} cancelled during parallel gen")
                    executor.shutdown(wait=False, cancel_futures=True)
                    break
                result_item = fut.result()
                if result_item:
                    generated.append(result_item)
                with _lock:
                    _tasks[task_id]["progress"] = len(generated)
                    _tasks[task_id]["images"] = sorted(generated, key=lambda x: x["index"])

        # 排序确保按 index 排列
        generated.sort(key=lambda x: x["index"])

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
def start_text_generation(text: str, mode: str = "text", custom_prompts: list = None, similar: bool = False, global_style: dict = None, num_images: int = 9) -> str:
    """启动纯文字生图任务"""
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
        target=_run_text_generation, args=(task_id, text),
        kwargs={"custom_prompts": custom_prompts, "similar": similar, "global_style": global_style, "num_images": num_images},
        daemon=True,
    )
    thread.start()
    return task_id


def _run_text_generation(task_id: str, user_text: str, custom_prompts: list = None, similar: bool = False, global_style: dict = None, num_images: int = 9):
    """纯文字生图：根据文本描述生成 N 张风格各异的图片（不与原图关联）"""
    try:
        cfg = _get_cfg()
        api_key = cfg.get("api_key", "")
        base_url = cfg.get("base_url", "https://apihub.agnes-ai.com/v1")
        if not api_key:
            raise Exception("图片生成服务未配置或 API Key 无效")
        model = cfg.get("model", "agnes-image-2.1-flash")

        if _is_cancelled(task_id):
            with _lock: _tasks[task_id]["status"] = "cancelled"
            return

        with _lock:
            _tasks[task_id]["total"] = num_images

        # ── 用文字 AI 把用户输入扩写成 9 个不同侧重的 prompt ──
        # 不用任何硬编码的场景/主体/角度/风格，全部从文字本身自然衍生
        text_cfg = get_ai_config()
        text_api_key = text_cfg.get("api_key", "")
        text_base_url = text_cfg.get("base_url", "")
        text_model = text_cfg.get("model", "")
        text_available = bool(text_api_key and text_model and text_base_url and text_model != "agnes-2.0-flash")

        style_prompts = []

        if text_available:
            # 有文字 AI → 让它根据用户输入扩写成 9 个不同的详细 prompt
            expand_prompt = (
                f"用户输入的主题是：{user_text}\n\n"
                f"请根据用户主题，写出 9 个不同的图片生成 prompt，编号 1-9。"
                f"每个 prompt 必须围绕用户主题，但从不同侧面展开（不同的构图思路、不同的画面焦点、不同的光影氛围）。"
                f"不要使用任何用户未提及的场景、人物、物体。"
                f"格式要求：每行一个，用编号开头，例如：\n"
                f"1. prompt内容\n"
                f"2. prompt内容\n"
                f"...\n"
                f"每个 prompt 控制在 80-150 字，中文，高清画质描述。"
            )
            try:
                base = text_base_url.rstrip('/')
                url = (base + '/v1/chat/completions') if not base.endswith('/v1') else (base + '/chat/completions')
                payload = {
                    "model": text_model,
                    "messages": [{"role": "user", "content": expand_prompt}],
                    "max_tokens": 2048,
                    "temperature": 0.7,
                }
                body = json.dumps(payload).encode()
                req = urllib.request.Request(url, data=body, method="POST")
                req.add_header("Authorization", f"Bearer {text_api_key}")
                req.add_header("Content-Type", "application/json")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    result = json.loads(resp.read().decode())
                if "choices" in result and result["choices"]:
                    raw = result["choices"][0]["message"]["content"]
                    # 解析编号行
                    import re
                    lines = raw.strip().split('\n')
                    parsed = []
                    for line in lines:
                        m = re.match(r'^\s*\d+[.、]\s*(.*)', line)
                        if m:
                            parsed.append(m.group(1).strip())
                    if len(parsed) >= 9:
                        for i, p in enumerate(parsed[:9]):
                            style_prompts.append({"prompt": p, "label": f"{user_text[:12]}·{i+1}"})
                        logger.info(f"Text AI expanded '{user_text[:30]}' into 9 prompts")
                    else:
                        logger.warning(f"Text AI only returned {len(parsed)} prompts, fallback")
            except Exception as e:
                logger.warning(f"Text AI prompt expansion failed: {e}")

        if not style_prompts:
            # 无文字 AI 或扩写失败 → 直接用用户文字（不加任何预设）
            # 全用同一段文字，让图片 API 自身的随机采样产生差异
            for i in range(num_images):
                label = f"{user_text[:12]}·{i+1}"
                prompt = user_text
                if custom_prompts and i < len(custom_prompts):
                    c = custom_prompts[i % len(custom_prompts)]
                    label = c.get("name", f"自定义 {i+1}")
                    prompt = f"{c['content']}。{user_text}"
                if global_style:
                    prompt = f"{global_style['content']}，{prompt}"
                style_prompts.append({"prompt": prompt, "label": label})

        logger.info(f"Text gen task {task_id}: {num_images} imgs, similar={similar}, text={user_text[:60]}")

        generated = []
        total_items = len(style_prompts)
        max_conc, interval, *_ = _load_concurrent_params()

        def _gen_one_text(i, item):
            prompt = item["prompt"]
            label = item["label"]
            if _is_cancelled(task_id):
                return None
            logger.info(f"Gen {i+1}/{total_items} [{label}]")
            t0 = time.time()
            img_bytes = _generate_one(api_key, base_url, model, prompt, None)
            if img_bytes:
                url = _save_generated_image(img_bytes, task_id, i)
                logger.info(f"  done [{label}] ({time.time()-t0:.0f}s)")
                return {"index": i, "url": url, "status": "done", "label": label}
            logger.warning(f"  failed [{label}] ({time.time()-t0:.0f}s)")
            return {"index": i, "url": None, "status": "failed", "label": label}

        # 低并发 + 请求间隔控制，避免触发 429 频率限制
        with ThreadPoolExecutor(max_workers=max_conc) as executor:
            # 控制提交间隔：每两个请求之间延迟 interval 秒
            pending = []
            for i in range(total_items):
                fut = executor.submit(_gen_one_text, i, style_prompts[i])
                pending.append(fut)
                if i < total_items - 1:
                    time.sleep(interval)
            for fut in as_completed(pending):
                if _is_cancelled(task_id):
                    executor.shutdown(wait=False, cancel_futures=True)
                    break
                r = fut.result()
                if r:
                    generated.append(r)
                with _lock:
                    _tasks[task_id]["progress"] = len(generated)
                    _tasks[task_id]["images"] = sorted(generated, key=lambda x: x["index"])

        generated.sort(key=lambda x: x["index"])
        with _lock:
            _tasks[task_id]["images"] = generated
            _tasks[task_id]["progress"] = len(generated)
            _tasks[task_id]["status"] = "done" if not _is_cancelled(task_id) else "cancelled"

        ok = sum(1 for g in generated if g["status"] == "done")
        logger.info(f"Text gen {task_id} done: {ok}/{total_items}")
    except Exception as e:
        logger.error(f"Text gen {task_id} failed: {e}")
        import traceback; traceback.print_exc()
        with _lock:
            _tasks[task_id]["status"] = "failed"
            _tasks[task_id]["error"] = str(e)
    finally:
        with _cancel_lock:
            _cancelled.discard(task_id)
