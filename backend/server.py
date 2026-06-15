"""
LensLab Backend API
FastAPI 后端服务 - 同时托管前端静态文件
数据统一通过 data_manager 存放在 DATA_DIR 目录下
"""

import os
import uuid
import json
import shutil
import secrets
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from .__version__ import __version__ as APP_VERSION
    from .analyzer import analyze_image, reanalyze_from_array, result_to_dict, GRID_MODES
    from .config_manager import (
        DATA_DIR, load_config, save_config, verify_password, change_password,
        change_username, get_ai_config, update_ai_config, is_ai_enabled,
        get_ai_image_config, update_ai_image_config,
    )
    from .data_manager import load_data, save_data
    from .versions import load_versions, get_current_version, get_changelog, check_for_update
except ImportError:
    from __version__ import __version__ as APP_VERSION
    from analyzer import analyze_image, reanalyze_from_array, result_to_dict, GRID_MODES
    from config_manager import (
        DATA_DIR, load_config, save_config, verify_password, change_password,
        change_username, get_ai_config, update_ai_config, is_ai_enabled,
        get_ai_image_config, update_ai_image_config,
    )
    from data_manager import load_data, save_data
    from versions import load_versions, get_current_version, get_changelog, check_for_update

logger = logging.getLogger(__name__)

# 图片灰度数组缓存，避免重复解码
_image_cache = {}  # {file_id: (np.array(gray), height, width)}
_ai_advice_cache = {}  # {file_id: ai_advice} — AI建议不随模式变化

app = FastAPI(title="LensLab API", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== 数据目录（全部从 DATA_DIR 管理） ====================
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR = DATA_DIR / "uploads"
RESULT_DIR = DATA_DIR / "results"
HISTORY_FILE = DATA_DIR / "history.json"
UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB

# Token 存储（简单内存存储，重启后需要重新登录）
_active_tokens: dict[str, float] = {}


# ==================== AI 分析 ====================

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

def _get_ai_client():
    if not is_ai_enabled():
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    ai_cfg = get_ai_config()
    return OpenAI(
        api_key=ai_cfg["api_key"],
        base_url=ai_cfg.get("base_url", "https://apihub.agnes-ai.com/v1"),
    )

def _analyze_with_ai(mode_name, avg_brightness, metering_points, scene="", histogram=None, img_width=0, img_height=0):
    client = _get_ai_client()
    if not client:
        return None
    ai_cfg = get_ai_config()

    # 直方图分析
    hist_section = "直方图未提供"
    if histogram and len(histogram) == 32:
        shadows = sum(histogram[:11])      # 0-85
        mids = sum(histogram[11:21])       # 86-165
        highlights = sum(histogram[21:])    # 166-255
        total = shadows + mids + highlights
        if total > 0:
            pct = lambda v: round(v / total * 100, 1)
            hist_section = f"亮度分布：暗部占{pct(shadows)}%，中间调占{pct(mids)}%，高光占{pct(highlights)}%"

    # 逐区域测光分析
    ev_list = [p.get("ev", 0) for p in metering_points]
    max_ev = max(ev_list) if ev_list else 0
    min_ev = min(ev_list) if ev_list else 0
    ev_range = max_ev - min_ev

    lines = [
        f"测光模式：{mode_name}（{len(metering_points)}个区域）",
        f"图片尺寸：{img_width}×{img_height}",
        f"整体平均亮度：{avg_brightness} / 255（参考：中性灰≈128）",
        f"EV范围：{min_ev:.2f} ~ {max_ev:.2f}（差值{ev_range:.2f}）",
        "",
        hist_section,
        "",
        f"=== 逐区域测光数据（{len(metering_points)}个区域）===",
    ]
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

    try:
        resp = client.chat.completions.create(
            model=ai_cfg.get("model", "agnes-2.0-flash"),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": "\n".join(lines)},
            ],
            max_tokens=600,
            temperature=0.7,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        return None


# ==================== 认证工具 ====================

def _generate_token() -> str:
    token = secrets.token_hex(32)
    import time
    _active_tokens[token] = time.time()
    return token

def _verify_token(token: Optional[str]) -> bool:
    if not token:
        return False
    import time
    if token not in _active_tokens:
        return False
    if time.time() - _active_tokens[token] > 86400:
        _active_tokens.pop(token, None)
        return False
    return True

def _require_auth(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "未登录")
    token = authorization.split(" ", 1)[1]
    if not _verify_token(token):
        raise HTTPException(401, "登录已过期，请重新登录")
    return token


# ==================== 历史记录管理（使用 data_manager） ====================

def _default_history():
    return {"data_version": 1, "items": []}


def load_history() -> list:
    data = load_data(HISTORY_FILE, _default_history)
    return data.get("items", [])

def save_history(items: list):
    data = {"data_version": 1, "items": items}
    save_data(HISTORY_FILE, data)

def cleanup_history(max_items: int = 50):
    items = load_history()
    if len(items) > max_items:
        for item in items[:len(items) - max_items]:
            src = UPLOAD_DIR / item.get("original", "").split("/", 1)[-1]
            res = RESULT_DIR / Path(item.get("result", "")).name
            if src.exists(): src.unlink()
            if res.exists(): res.unlink()
        items = items[-max_items:]
        save_history(items)


# ==================== Pydantic 模型 ====================

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class ChangeUsernameRequest(BaseModel):
    new_username: str
    password: str

class AIConfigRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None

class SystemCleanupConfig(BaseModel):
    enabled: bool = True
    threshold_mb: int = 300


# ==================== 自动生成/清理工具 ====================

import subprocess as _sp

def _get_generated_size() -> int:
    """获取 generated/ 目录大小（字节）"""
    generated_dir = DATA_DIR / "generated"
    if not generated_dir.exists():
        return 0
    try:
        result = _sp.run(["du", "-sb", str(generated_dir)], capture_output=True, text=True, timeout=5)
        return int(result.stdout.split()[0])
    except Exception:
        return sum(f.stat().st_size for f in generated_dir.iterdir() if f.is_file())

def _auto_cleanup_generated():
    """AI 生图完成后检查 generated/ 大小，超过阈值自动清理旧文件，删到阈值*80%"""
    config = load_config()
    sys_cfg = config.get("system", {})
    if not sys_cfg.get("enabled", True):
        return
    threshold_mb = sys_cfg.get("threshold_mb", 300)
    threshold_bytes = threshold_mb * 1024 * 1024
    total = _get_generated_size()
    if total <= threshold_bytes:
        return
    target = int(threshold_bytes * 0.8)
    generated_dir = DATA_DIR / "generated"
    files = sorted(
        [f for f in generated_dir.iterdir() if f.is_file()],
        key=lambda f: f.stat().st_mtime
    )
    removed = 0
    for f in files:
        if total <= target:
            break
        sz = f.stat().st_size
        try:
            f.unlink()
            total -= sz
            removed += 1
        except Exception:
            pass
    logger.info(f"[AutoCleanup] 已清理 {removed} 个文件，释放约 {removed} 个文件")

def _manual_cleanup_all() -> dict:
    """手动清空 generated/，返回清理前信息"""
    generated_dir = DATA_DIR / "generated"
    before = _get_generated_size()
    count = 0
    if generated_dir.exists():
        for f in generated_dir.iterdir():
            if f.is_file():
                try:
                    f.unlink()
                    count += 1
                except Exception:
                    pass
    return {"freed_bytes": before, "removed_files": count}


# ==================== 认证 API ====================

@app.post("/api/auth/login")
def login(req: LoginRequest):
    config = load_config()
    if req.username != config["auth"]["username"]:
        raise HTTPException(401, "用户名或密码错误")
    if not verify_password(req.password):
        raise HTTPException(401, "用户名或密码错误")
    token = _generate_token()
    return {"token": token, "username": req.username}

@app.get("/api/auth/check")
def check_auth(authorization: Optional[str] = Header(None)):
    token = authorization.replace("Bearer ", "") if authorization else None
    if _verify_token(token):
        config = load_config()
        return {"logged_in": True, "username": config["auth"]["username"]}
    return {"logged_in": False}

@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        _active_tokens.pop(token, None)
    return {"status": "ok"}


# ==================== 设置管理 API ====================

@app.get("/api/settings/account")
def get_account(authorization: Optional[str] = Header(None)):
    _require_auth(authorization)
    config = load_config()
    return {"username": config["auth"]["username"]}

@app.post("/api/settings/change-password")
def api_change_password(req: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    _require_auth(authorization)
    if len(req.new_password) < 4:
        raise HTTPException(400, "新密码至少4位")
    if not change_password(req.old_password, req.new_password):
        raise HTTPException(401, "旧密码错误")
    return {"status": "ok", "message": "密码修改成功"}

@app.post("/api/settings/change-username")
def api_change_username(req: ChangeUsernameRequest, authorization: Optional[str] = Header(None)):
    _require_auth(authorization)
    if len(req.new_username) < 2:
        raise HTTPException(400, "用户名至少2位")
    if not change_username(req.new_username, req.password):
        raise HTTPException(401, "密码错误")
    return {"status": "ok", "message": "用户名修改成功"}

@app.get("/api/settings/ai")
def get_ai_settings():
    """获取 AI 设置（公开）——不暴露完整 API Key，同时返回文字和图片模型状态"""
    ai = get_ai_config()
    key = ai.get("api_key", "")
    masked_key = key[:6] + "****" + key[-4:] if len(key) > 10 else "****" if key else ""
    ai_img = get_ai_image_config()
    img_key = ai_img.get("api_key", "")
    return {
        "enabled": ai.get("enabled", False),
        "has_saved": bool(key),
        "api_key_masked": masked_key,
        "base_url": ai.get("base_url", "https://apihub.agnes-ai.com/v1"),
        "model": ai.get("model", "agnes-2.0-flash"),
        "image_enabled": ai_img.get("enabled", False),
        "image_has_saved": bool(img_key),
        "image_api_key_masked": img_key[:6] + "****" + img_key[-4:] if len(img_key) > 10 else ("****" if img_key else ""),
        "image_base_url": ai_img.get("base_url", "https://apihub.agnes-ai.com/v1"),
        "image_model": ai_img.get("model", "agnes-image-2.1-flash"),
    }

@app.post("/api/settings/ai/test")
def test_ai_connection(req: AIConfigRequest, authorization: Optional[str] = Header(None)):
    """测试 AI 连接：发送最小请求验证 API Key + Base URL + Model 是否可用"""
    _require_auth(authorization)
    # 如果请求没传 api_key，从已保存的配置中获取
    api_key = req.api_key or get_ai_config().get("api_key", "")
    base_url = req.base_url or get_ai_config().get("base_url", "")
    model = req.model or get_ai_config().get("model", "")
    if not api_key or not base_url or not model:
        return {"ok": False, "message": "请填写 API Key、接口地址和模型名称"}
    try:
        import httpx
        # 规范化 base_url
        base = base_url.rstrip('/')
        if base.endswith('/v1') or base.endswith('/v1/'):
            url = base.rstrip('/') + '/chat/completions'
        else:
            url = base.rstrip('/') + '/v1/chat/completions'
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": False,
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if "choices" in data:
                    return {"ok": True, "message": "连接成功"}
                else:
                    detail = data.get("error", {}).get("message", str(data)[:200])
                    return {"ok": False, "message": f"返回格式异常: {detail}"}
            else:
                try:
                    err = resp.json()
                    detail = err.get("error", {}).get("message", resp.text[:200])
                except Exception:
                    detail = resp.text[:200]
                return {"ok": False, "message": f"HTTP {resp.status_code}: {detail}"}
    except httpx.TimeoutException:
        return {"ok": False, "message": "连接超时（15秒），请检查接口地址"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)[:200]}"}


@app.post("/api/settings/ai")
def update_ai_settings(req: AIConfigRequest, authorization: Optional[str] = Header(None)):
    _require_auth(authorization)
    update_ai_config(
        api_key=req.api_key,
        base_url=req.base_url,
        model=req.model,
        enabled=req.enabled,
    )
    return {"status": "ok", "message": "AI 配置已保存"}


# ==================== 图片生成 AI 设置 API ====================


@app.get("/api/settings/ai/image")
def get_img_ai_settings():
    """获取 AI 生图设置（公开）——不暴露完整 API Key"""
    ai = get_ai_image_config()
    key = ai.get("api_key", "")
    masked_key = key[:6] + "****" + key[-4:] if len(key) > 10 else "****" if key else ""
    return {
        "enabled": ai.get("enabled", False),
        "has_saved": bool(key),
        "api_key_masked": masked_key,
        "base_url": ai.get("base_url", "https://apihub.agnes-ai.com/v1"),
        "model": ai.get("model", "agnes-image-2.1-flash"),
    }


@app.post("/api/settings/ai/image")
def update_img_ai_settings(req: AIConfigRequest, authorization: Optional[str] = Header(None)):
    _require_auth(authorization)
    update_ai_image_config(
        api_key=req.api_key,
        base_url=req.base_url,
        model=req.model,
        enabled=req.enabled,
    )
    return {"ok": True, "message": "已保存"}


@app.post("/api/settings/ai/image/test")
def test_img_ai_connection(req: AIConfigRequest, authorization: Optional[str] = Header(None)):
    """测试图片生成 AI 连接"""
    _require_auth(authorization)
    api_key = req.api_key or get_ai_image_config().get("api_key", "")
    base_url = req.base_url or get_ai_image_config().get("base_url", "")
    model = req.model or get_ai_image_config().get("model", "")
    if not api_key or not base_url or not model:
        return {"ok": False, "message": "请填写 API Key、接口地址和模型名称"}
    try:
        import httpx
        base = base_url.rstrip('/')
        if base.endswith('/v1'):
            url = base + '/images/generations'
        else:
            url = base.rstrip('/') + '/v1/images/generations'
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "prompt": "test",
            "n": 1,
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                return {"ok": True, "message": "连接成功"}
            else:
                body = resp.json()
                msg = body.get("error", {}).get("message", "") or f"HTTP {resp.status_code}"
                return {"ok": False, "message": msg}
    except httpx.TimeoutException:
        return {"ok": False, "message": "连接超时（15秒），请检查接口地址"}
    except httpx.ConnectError:
        return {"ok": False, "message": "网络不可达，请检查接口地址"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)[:200]}"}


# ==================== 系统设置 API ====================

@app.get("/api/settings/cleanup")
def get_cleanup_settings(authorization: Optional[str] = Header(None)):
    """获取自动清理配置，同时返回当前 generated/ 大小"""
    _require_auth(authorization)
    config = load_config()
    sys_cfg = config.get("system", {})
    return {
        "enabled": sys_cfg.get("enabled", True),
        "threshold_mb": sys_cfg.get("threshold_mb", 300),
        "current_mb": _get_generated_size() // (1024 * 1024),
    }

@app.post("/api/settings/cleanup")
def update_cleanup_settings(req: SystemCleanupConfig, authorization: Optional[str] = Header(None)):
    """更新自动清理配置"""
    _require_auth(authorization)
    config = load_config()
    config["system"] = {
        "enabled": req.enabled,
        "threshold_mb": max(50, min(10000, req.threshold_mb)),
    }
    save_config(config)
    return {"ok": True}

@app.post("/api/cleanup/manual")
def manual_cleanup(authorization: Optional[str] = Header(None)):
    """手动清空 generated/"""
    _require_auth(authorization)
    result = _manual_cleanup_all()
    return {"ok": True, **result}


# ==================== 原有 API ====================

@app.get("/api/grid-modes")
def get_grid_modes():
    return {
        "modes": [
            {"key": k, "name": v["name"], "rows": v["rows"], "cols": v["cols"]}
            for k, v in GRID_MODES.items()
        ]
    }

@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(None),
    mode: str = Form("9"),
    ev_method: str = Form("standard"),
    file_id: Optional[str] = Form(None),
):
    # Determine file and file_id
    original_name = None
    if file_id:
        # Re-analyze existing history entry
        history = load_history()
        entry = next((h for h in history if h["file_id"] == file_id), None)
        if not entry:
            raise HTTPException(404, "History entry not found")
        # Use existing original file
        original_path = UPLOAD_DIR / Path(entry["original"]).name
        if not original_path.exists():
            raise HTTPException(404, "Original file missing")
        original_name = Path(entry["original"]).name
        # Keep same file_id
    else:
        if not file.filename:
            raise HTTPException(400, "No file provided")
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if ext not in ("jpg", "jpeg", "png"):
            raise HTTPException(400, "Only JPG and PNG files are supported")
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"文件过大，最大支持 {MAX_UPLOAD_SIZE // 1024 // 1024}MB")
        file_id = uuid.uuid4().hex[:12]
        original_name = f"{file_id}_original.{ext}"
        original_path = UPLOAD_DIR / original_name
        with open(original_path, "wb") as f:
            f.write(content)

    try:
        # 尝试从缓存中获取灰度数组
        cached = _image_cache.get(file_id)
        if cached is not None:
            arr, h, w = cached
            result = reanalyze_from_array(arr, h, w, mode=mode, ev_method=ev_method)
        else:
            result = analyze_image(str(original_path), mode=mode, ev_method=ev_method)
            # 缓存灰度数组供后续模式切换加速
            from PIL import Image
            import numpy as np
            img = Image.open(original_path).convert("L")
            arr = np.array(img)
            _image_cache[file_id] = (arr, result.height, result.width)
            # 限制缓存大小
            if len(_image_cache) > 5:
                oldest = next(iter(_image_cache))
                del _image_cache[oldest]
    except Exception as e:
        original_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Analysis failed: {str(e)}")

    analysis_data = result_to_dict(result)
    analysis_data["file_id"] = file_id
    analysis_data["original_name"] = original_name
    analysis_data["timestamp"] = datetime.now().isoformat()

    # AI分析改为手动触发，不再自动调用
    analysis_data["ai_enabled"] = is_ai_enabled()

    # 保存结果（保留 prompt 等字段，避免被覆盖）
    analysis_path = RESULT_DIR / f"{file_id}.json"
    if analysis_path.exists():
        existing = load_data(analysis_path, lambda: {})
        if existing.get("prompt"):
            analysis_data["prompt"] = existing["prompt"]
    save_data(analysis_path, analysis_data)

    history = load_history()
    # Check if this file_id already exists (re-analysis)
    existing_idx = next((i for i, h in enumerate(history) if h["file_id"] == file_id), None)
    if existing_idx is not None:
        # Update in place — same file, new result
        history[existing_idx]["timestamp"] = analysis_data["timestamp"]
    else:
        history.append({
            "file_id": file_id,
            "original": f"uploads/{original_name}",
            "result": f"results/{file_id}.json",
            "filename": file.filename,
            "timestamp": analysis_data["timestamp"],
        })
    save_history(history)
    cleanup_history()

    return analysis_data

@app.get("/api/history")
def get_history():
    return {"items": load_history()}

@app.delete("/api/history/{file_id}")
def delete_history(file_id: str):
    history = load_history()
    history = [h for h in history if h["file_id"] != file_id]
    save_history(history)
    for p in UPLOAD_DIR.glob(f"{file_id}_*"):
        p.unlink(missing_ok=True)
    for p in RESULT_DIR.glob(f"{file_id}*"):
        p.unlink(missing_ok=True)
    return {"status": "deleted"}


@app.post("/api/history/from-generated")
async def add_generated_to_history(image_url: str = Form(...), prompt: str = Form(default="")):
    """将 AI 生成的图片添加到历史记录"""
    try:
        # 解析图片路径 — 处理各种 URL 格式
        tmp = None
        if image_url.startswith("/generated/"):
            src_path = DATA_DIR / image_url.lstrip("/")
        elif image_url.startswith("http"):
            # 检查是否指向本机，避免自己请求自己导致死锁
            from urllib.parse import urlparse
            parsed = urlparse(image_url)
            host = parsed.hostname or ""
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            is_local = host in ("localhost", "127.0.0.1", "0.0.0.0", "") or host.startswith("10.") or host.startswith("192.168.")
            if is_local:
                # 本机 URL → 直接转本地路径
                path_part = parsed.path
                if path_part.startswith("/generated/"):
                    src_path = DATA_DIR / path_part.lstrip("/")
                else:
                    src_path = DATA_DIR / path_part.lstrip("/")
            else:
                # 远程 URL → 下载
                tmp = DATA_DIR / 'generated' / f"tmp_{uuid.uuid4().hex[:12]}.png"
                import urllib.request as _urllib
                _urllib.urlretrieve(image_url, str(tmp))
                src_path = tmp
        else:
            src_path = Path(image_url)

        if not src_path or not src_path.exists():
            raise HTTPException(400, f"图片文件不存在: {src_path}")

        file_id = uuid.uuid4().hex
        dest = UPLOAD_DIR / f"{file_id}.png"
        shutil.copy2(str(src_path), str(dest))

        # 清理临时文件
        if tmp and tmp.exists():
            tmp.unlink(missing_ok=True)

        # 兜底：如果前端没传 prompt，尝试从已有 result.json 读取
        if not prompt:
            src_file_id = None
            if image_url.startswith("/generated/"):
                src_file_id = image_url.split("/")[-1].replace(".png", "")
            if src_file_id and src_file_id != file_id:
                alt_result = RESULT_DIR / f"{src_file_id}.json"
                if alt_result.exists():
                    alt_data = load_data(alt_result)
                    if alt_data and alt_data.get("prompt"):
                        prompt = alt_data["prompt"]
            # 再试：从 URL 文件名推断
            if not prompt:
                import re as _re
                match = _re.search(r"ai-generated-(\w+)", image_url)
                if match:
                    alt_data = load_data(RESULT_DIR / f"{match.group(1)}.json")
                    if alt_data and alt_data.get("prompt"):
                        prompt = alt_data["prompt"]

        result_data = {
            "file_id": file_id,
            "original_name": f"ai-generated-{file_id[:8]}.png",
            "timestamp": datetime.now().isoformat(),
            "mode_name": "ai-generated",
            "width": 0,
            "height": 0,
            "avg_brightness": 0,
            "metering_points": [],
            "histogram": [],
            "ai_enabled": False,
            "source": "text-to-image",
            "prompt": prompt,
        }
        result_path = RESULT_DIR / f"{file_id}.json"
        save_data(result_path, result_data)

        history = load_history()
        history.append({
            "file_id": file_id,
            "original": f"uploads/{file_id}.png",
            "result": f"results/{file_id}.json",
            "filename": f"ai-generated-{file_id[:8]}.png",
            "timestamp": datetime.now().isoformat(),
            "prompt": prompt,
        })
        save_history(history)
        cleanup_history()

        return {"ok": True, "file_id": file_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"添加生成图到历史失败: {e}")
        return {"ok": False, "error": str(e)}



@app.get("/api/ai-advice/{file_id}")
def get_ai_advice(file_id: str):
    path = RESULT_DIR / f"{file_id}.json"
    if not path.exists():
        raise HTTPException(404, "Result not found")
    data = json.loads(path.read_text())
    ai_advice = _analyze_with_ai(
        mode_name=data.get("mode_name", ""),
        avg_brightness=data.get("avg_brightness", 0),
        metering_points=data.get("metering_points", []),
        histogram=data.get("histogram"),
        img_width=data.get("width", 0),
        img_height=data.get("height", 0),
    )
    data["ai_advice"] = ai_advice
    save_data(path, data)
    return {"advice": ai_advice}

@app.get("/api/result/{file_id}")
def get_result(file_id: str):
    path = RESULT_DIR / f"{file_id}.json"
    if not path.exists():
        raise HTTPException(404, "Result not found")
    data = load_data(path, lambda: {})
    return data

@app.post("/api/analyze/ai")
async def analyze_ai(file_id: str = Form(...)):
    """手动触发AI分析"""
    path = RESULT_DIR / f"{file_id}.json"
    if not path.exists():
        raise HTTPException(404, "分析结果不存在，请先分析图片")
    data = json.loads(path.read_text())
    ai_advice = _analyze_with_ai(
        mode_name=data.get("mode_name", ""),
        avg_brightness=data.get("avg_brightness", 0),
        metering_points=data.get("metering_points", []),
        histogram=data.get("histogram"),
        img_width=data.get("width", 0),
        img_height=data.get("height", 0),
    )
    data["ai_advice"] = ai_advice
    _ai_advice_cache[file_id] = ai_advice
    save_data(path, data)
    return {"ai_advice": ai_advice}

@app.post("/api/generate/ai")
async def generate_ai_image(
    file_id: str = Form(...),
    ai_advice: str = Form(...),
):
    """根据AI文字分析，自动调整曝光生成成品图"""
    import glob
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    import numpy as np

    # 找到原始图片
    matches = glob.glob(str(UPLOAD_DIR / f"{file_id}_original.*"))
    if not matches:
        return {"ok": False, "error": "找不到原始图片"}
    original_path = matches[0]

    # 加载分析结果
    result_path = RESULT_DIR / f"{file_id}.json"
    result_data = {}
    if result_path.exists():
        result_data = json.loads(result_path.read_text())
    metering_points = result_data.get("metering_points", [])

    # 加载原图
    img = Image.open(original_path).convert("RGB")
    w, h = img.size

    # ========== 从AI文字中解析曝光建议 ==========
    advice_lower = (ai_advice or "").lower()

    # 亮度修正（EV补偿 → 像素亮度调整）
    ev_adjust = 0.0
    if "增加曝光" in advice_lower or "提亮" in advice_lower:
        if "+0.3" in advice_lower or "+0.5" in advice_lower:
            ev_adjust = 0.4
        elif "+1.0" in advice_lower or "+1" in advice_lower:
            ev_adjust = 0.8
        else:
            ev_adjust = 0.3
    if "降低曝光" in advice_lower or "减光" in advice_lower or "减少曝光" in advice_lower:
        if "-0.3" in advice_lower or "-0.5" in advice_lower:
            ev_adjust = -0.4
        elif "-1.0" in advice_lower or "-1" in advice_lower:
            ev_adjust = -0.8
        else:
            ev_adjust = -0.3
    if "无需" in advice_lower and "调整" in advice_lower:
        ev_adjust = 0.0

    # 阴影提亮
    shadow_boost = False
    if "提亮阴影" in advice_lower or "阴影" in advice_lower:
        shadow_boost = True

    # 高光压暗
    highlight_reduce = False
    if "高光" in advice_lower and ("压暗" in advice_lower or "降低" in advice_lower or "减" in advice_lower):
        highlight_reduce = True

    # 对比度增强
    contrast_boost = 1.0
    if "增强对比" in advice_lower or "增加对比" in advice_lower:
        contrast_boost = 1.15
    if "減对比" in advice_lower or "降低对比" in advice_lower:
        contrast_boost = 0.9

    # ========== 像素级曝光调整 ==========
    arr = np.array(img).astype(np.float32)

    if abs(ev_adjust) > 0.01:
        ratio = 2 ** ev_adjust  # EV 转亮度倍率
        arr = arr * ratio
        arr = np.clip(arr, 0, 255)

    if shadow_boost:
        gray = np.mean(arr, axis=2)
        mask = gray < 70  # 阴影区域
        boost = np.clip((70 - gray) * 0.3, 0, 30)
        for c in range(3):
            arr[:, :, c] += boost * mask
        arr = np.clip(arr, 0, 255)

    if highlight_reduce:
        gray = np.mean(arr, axis=2)
        mask = gray > 200  # 高光区域
        reduce = np.clip((gray - 200) * 0.25, 0, 30)
        for c in range(3):
            arr[:, :, c] -= reduce * mask
        arr = np.clip(arr, 0, 255)

    corrected_img = Image.fromarray(arr.astype(np.uint8))

    if abs(contrast_boost - 1.0) > 0.01:
        enhancer = ImageEnhance.Contrast(corrected_img)
        corrected_img = enhancer.enhance(contrast_boost)

    # ========== 制作对比图（左原图 + 右成品） ==========
    canvas_w = w * 2 + 20
    bottom_h = 140
    canvas = Image.new("RGB", (canvas_w, h + bottom_h), (18, 18, 28))
    canvas.paste(img, (0, 40))
    canvas.paste(corrected_img, (w + 20, 40))

    draw = ImageDraw.Draw(canvas)

    # 标题
    try:
        draw.text((10, 14), "Original", fill=(180, 180, 190))
        draw.text((w + 30, 14), "AI Corrected", fill=(100, 200, 255))
    except Exception:
        pass

    # 调整参数说明
    y_text = h + 55
    changes = []
    if abs(ev_adjust) > 0.01:
        changes.append(f"EV: {'+' if ev_adjust > 0 else ''}{ev_adjust:.1f}")
    if shadow_boost:
        changes.append("Shadows: +30%")
    if highlight_reduce:
        changes.append("Highlights: -25%")
    if abs(contrast_boost - 1.0) > 0.01:
        changes.append(f"Contrast: {'+' if contrast_boost > 1 else ''}{((contrast_boost-1)*100):.0f}%")

    if changes:
        param_line = "Applied: " + " | ".join(changes)
        try:
            draw.text((10, y_text), param_line, fill=(140, 200, 255))
        except Exception:
            pass

    # AI 建议摘要（黄色）
    advice_short = (ai_advice or "")[:150].replace("**", "").replace("\n", " ")
    try:
        draw.text((10, y_text + 25), "> " + advice_short, fill=(255, 220, 80))
    except Exception:
        pass

    # 图例
    try:
        lx = canvas_w - 250
        draw.rectangle([lx, y_text, lx + 12, y_text + 12], fill=(255, 220, 80))
        draw.text((lx + 16, y_text), "AI Advice", fill=(200, 200, 200))
        draw.rectangle([lx + 90, y_text, lx + 102, y_text + 12], fill=(100, 200, 255))
        draw.text((lx + 106, y_text), "Adjust", fill=(200, 200, 200))
    except Exception:
        pass

    # ========== 输出 ==========
    import io, base64
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", quality=90)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {"ok": True, "image_url": f"data:image/png;base64,{b64}"}


# ==================== AI 生图（新版） ====================

try:
    from .ai_generator import start_generation, start_text_generation, get_task, cancel_generation
except ImportError:
    from ai_generator import start_generation, start_text_generation, get_task, cancel_generation


@app.post("/api/generate/similar")
async def generate_similar(file_id: str = Form(...), global_style: str = Form(None), custom_prompts_json: str = Form(None), similar: str = Form("false"), num_images: str = Form("9"), size: str = Form("1024x1024")):
    """AI 生成类似风格图片，支持全局风格 + 自定义提示词"""
    try:
        prompts_list = []
        if custom_prompts_json:
            try:
                prompts_list = json.loads(custom_prompts_json)
            except Exception:
                prompts_list = []
        global_style_data = None
        if global_style:
            try:
                global_style_data = json.loads(global_style)
            except Exception:
                global_style_data = None
        sim = similar.lower() in ('true', '1', 'yes')
        n = int(num_images) if num_images else 9
        n = max(1, min(n, 9))
        print(f"[DEBUG] generate/similar called: similar={sim}, num_images={n}, global_style={global_style_data}, prompts={len(prompts_list)}, size={size}")
        _auto_cleanup_generated()
        task_id = start_generation(file_id, mode="style", custom_prompts=prompts_list, similar=sim, global_style=global_style_data, num_images=n, size=size)
        return {"ok": True, "task_id": task_id}
    except Exception as e:
        logger.error(f"Failed to start generation: {e}")
        return {"ok": False, "error": str(e)}


@app.post("/api/generate/custom-prompt")
async def generate_custom_prompt(file_id: str = Form(...), custom_prompt: str = Form(...), size: str = Form("1024x1024")):
    """AI 生成：基于原图 + 用户自定义提示词，只生成1张占满3×3九宫格"""
    try:
        if not custom_prompt or not custom_prompt.strip():
            return {"ok": False, "error": "自定义提示词不能为空"}
        custom_prompts_list = [{"name": "自定义提示词", "content": custom_prompt.strip()}]
        task_id = start_generation(file_id, mode="style", custom_prompts=custom_prompts_list, similar=False, global_style=None, num_images=1, size=size)
        return {"ok": True, "task_id": task_id}
    except Exception as e:
        logger.error(f"Failed to start custom-prompt generation: {e}")
        return {"ok": False, "error": str(e)}


@app.post("/api/generate/text-image")
async def generate_text_image(
    text: str = Form(...),
    global_style: str = Form(None),
    custom_prompts_json: str = Form(None),
    similar: str = Form("false"),
    num_images: str = Form("9"),
    size: str = Form("1024x1024"),
):
    """纯文字生图：无需上传，输入文字描述直接生成九宫格"""
    try:
        if not text or not text.strip():
            return {"ok": False, "error": "文字描述不能为空"}
        sim = similar.lower() in ("true", "1", "yes")
        n = int(num_images) if num_images else 9
        n = max(1, min(n, 9))
        gs = None
        if global_style:
            try:
                gs = json.loads(global_style)
            except Exception:
                pass
        prompts_list = None
        if custom_prompts_json:
            try:
                prompts_list = json.loads(custom_prompts_json)
            except Exception:
                pass
        task_id = start_text_generation(
            text=text.strip(), mode="text",
            custom_prompts=prompts_list, similar=sim,
            global_style=gs, num_images=n, size=size,
        )
        return {"ok": True, "task_id": task_id}
    except Exception as e:
        logger.error(f"Failed to start text-image generation: {e}")
        return {"ok": False, "error": str(e)}


@app.get("/api/generate/task/{task_id}")
def get_generation_task(task_id: str):
    """获取生图任务状态"""
    task = get_task(task_id)
    if not task:
        return {"ok": False, "error": "任务不存在或已过期"}
    return {"ok": True, "task": task}


@app.post("/api/generate/cancel")
def cancel_generation_task(task_id: str = Form(...)):
    """取消生图任务"""
    ok = cancel_generation(task_id)
    if ok:
        return {"ok": True, "message": "已取消"}
    return {"ok": False, "error": "任务不存在"}


# 允许静态访问 generated 目录
generated_dir = str(DATA_DIR / "generated")
if os.path.isdir(generated_dir) and generated_dir not in [m.path for m in app.routes if hasattr(m, 'path')]:
    app.mount("/generated", StaticFiles(directory=generated_dir), name="generated")


@app.get("/api/version")
def get_version():
    return {"version": APP_VERSION, "data_version": 1}

# ==================== 提示词模板 API ====================
PROMPTS_FILE = DATA_DIR / "prompts.json"

def _load_prompts():
    if PROMPTS_FILE.exists():
        try:
            return json.loads(PROMPTS_FILE.read_text())
        except Exception:
            pass
    return []

def _save_prompts(prompts):
    PROMPTS_FILE.write_text(json.dumps(prompts, ensure_ascii=False, indent=2))


@app.get("/api/prompts")
def list_prompts():
    return {"ok": True, "prompts": _load_prompts()}


@app.post("/api/prompts")
def save_prompt(name: str = Form(...), content: str = Form(...), type: str = Form("prompt")):
    prompts = _load_prompts()
    # 按 id 查找更新（支持编辑已有模板）
    prompt_id = None
    for p in prompts:
        if p["name"] == name and p.get("type", "prompt") == type:
            prompt_id = p["id"]
            break
    if prompt_id:
        existing = next((p for p in prompts if p["id"] == prompt_id), None)
        if existing:
            existing["name"] = name
            existing["content"] = content
            existing["type"] = type
            existing["updated_at"] = datetime.now().isoformat()
    else:
        prompts.append({
            "id": str(uuid.uuid4())[:8],
            "name": name,
            "content": content,
            "type": type,
            "created_at": datetime.now().isoformat(),
        })
    _save_prompts(prompts)
    return {"ok": True}


@app.delete("/api/prompts/{prompt_id}")
def delete_prompt(prompt_id: str):
    prompts = _load_prompts()
    before = len(prompts)
    prompts = [p for p in prompts if p["id"] != prompt_id]
    if len(prompts) < before:
        _save_prompts(prompts)
        return {"ok": True}
    return {"ok": False, "error": "模板不存在"}


# ==================== 版本管理 API ====================

@app.get("/api/versions")
def get_versions():
    """获取版本信息（当前版本 + 更新日志）"""
    versions = load_versions()
    current = get_current_version()
    return {
        "current": current,
        "changelog": get_changelog()
    }

@app.get("/api/versions/check")
def check_versions():
    """检查是否有可用更新（基于本地 digest）"""
    info = check_for_update()
    return info


# ==================== 静态文件服务 ====================

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/results", StaticFiles(directory=str(RESULT_DIR)), name="results")

# 前端静态文件服务
FRONTEND_FILE = Path(__file__).parent.parent / "frontend" / "index.html"
if not FRONTEND_FILE.exists():
    FRONTEND_FILE = Path(__file__).parent / "frontend" / "index.html"

FRONTEND_DIR = FRONTEND_FILE.parent
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

@app.get("/")
def serve_frontend():
    if FRONTEND_FILE.exists():
        return FileResponse(str(FRONTEND_FILE))
    raise HTTPException(404, "Frontend not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)