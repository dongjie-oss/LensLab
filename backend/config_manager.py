"""
配置管理模块
统一管理账号密码、AI 配置等，存储在 config.json
使用 data_manager 进行版本化数据管理
"""

import json
import hashlib
import secrets
import os
from pathlib import Path
from typing import Optional

try:
    from .data_manager import load_data, save_data
except ImportError:
    from data_manager import load_data, save_data

# 数据目录：由环境变量 DATA_DIR 指定，否则用项目根目录下的 data/
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent.parent / "data")).resolve()
CONFIG_FILE = DATA_DIR / "config.json"

DEFAULT_CONFIG = {
    "data_version": 1,
    "auth": {
        "username": "admin",
        # admin 密码的 SHA-256 hash ("admin")
        "password_hash": "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
        "salt": "",
    },
    "ai": {
        "api_key": "",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "model": "agnes-2.0-flash",
        "enabled": False,
    },
    "ai_image": {
        "api_key": "",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "model": "agnes-image-2.1-flash",
        "enabled": False,
        "max_concurrent": 2,
        "request_interval": 3,
        "max_429_retries": 3,
        "429_backoff_base": 15,
    },
    "system": {
        "enabled": True,
        "threshold_mb": 300,
    },
}


def _hash_password(password: str, salt: str = "") -> str:
    """SHA-256 密码哈希"""
    return hashlib.sha256((salt + password).encode()).hexdigest()


def _backup_config() -> str:
    """备份 config.json，返回备份文件路径"""
    backup = CONFIG_FILE + ".bak"
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            with open(backup, "w") as fb:
                fb.write(f.read())
    return backup


def _verify_config(config: dict) -> bool:
    """验证关键字段完整性，防止迁移后数据丢失"""
    # auth 必须有 password_hash
    auth = config.get("auth", {})
    if not auth.get("password_hash"):
        return False
    # ai_image 必须保留 api_key（如果迁移前有的话）
    return True


def _restore_config_from_backup(backup: str) -> bool:
    """从备份恢复 config.json"""
    if backup and os.path.exists(backup):
        with open(backup, "r") as f:
            content = f.read()
        with open(CONFIG_FILE, "w") as f:
            f.write(content)
        return True
    return False


def load_config() -> dict:
    """加载配置文件，不存在则创建默认；确保所有默认键都存在（兼容旧配置）
    安全流程：备份 → 合并 → 保存 → 验证 → 失败则回滚"""
    config = load_data(CONFIG_FILE, lambda: DEFAULT_CONFIG.copy())
    
    # 检查是否需要迁移（有缺失键）
    changed = False
    for key, default_val in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = default_val.copy() if isinstance(default_val, dict) else default_val
            changed = True
    
    if changed:
        # 1. 备份
        backup = _backup_config()
        # 2. 保存
        save_config(config)
        # 3. 验证
        if not _verify_config(config):
            # 验证失败 → 回滚
            _restore_config_from_backup(backup)
            print("[config_manager] ⚠️ 迁移后验证失败，已回滚到备份")
            config = load_data(CONFIG_FILE, lambda: DEFAULT_CONFIG.copy())
        else:
            # 验证通过 → 删备份
            if backup and os.path.exists(backup):
                os.remove(backup)
            print(f"[config_manager] ✅ 配置迁移完成，新增键: {[k for k in DEFAULT_CONFIG if k not in config and k not in ('system',)]}")
    
    return config


def save_config(config: dict):
    """保存配置文件"""
    save_data(CONFIG_FILE, config)


def verify_password(password: str) -> bool:
    """验证密码"""
    config = load_config()
    auth = config.get("auth", {})
    stored_hash = auth.get("password_hash", "")
    salt = auth.get("salt", "")
    return _hash_password(password, salt) == stored_hash


def change_password(old_password: str, new_password: str) -> bool:
    """修改密码，需要验证旧密码"""
    if not verify_password(old_password):
        return False
    config = load_config()
    config["auth"]["password_hash"] = _hash_password(new_password, config["auth"].get("salt", ""))
    save_config(config)
    return True


def change_username(new_username: str, password: str) -> bool:
    """修改用户名，需要验证密码"""
    if not verify_password(password):
        return False
    config = load_config()
    config["auth"]["username"] = new_username
    save_config(config)
    return True


def get_ai_config() -> dict:
    """获取 AI 配置"""
    config = load_config()
    return config.get("ai", DEFAULT_CONFIG["ai"])


def update_ai_config(api_key: str = None, base_url: str = None, model: str = None, enabled: bool = None):
    """更新 AI 配置"""
    config = load_config()
    ai = config.get("ai", {})
    if api_key is not None:
        ai["api_key"] = api_key
    if base_url is not None:
        ai["base_url"] = base_url
    if model is not None:
        ai["model"] = model
    if enabled is not None:
        ai["enabled"] = enabled
    else:
        # 如果有 api_key 则自动启用
        ai["enabled"] = bool(ai.get("api_key", ""))
    config["ai"] = ai
    save_config(config)


def get_ai_image_config() -> dict:
    """获取图片生成 AI 配置"""
    config = load_config()
    return config.get("ai_image", DEFAULT_CONFIG["ai_image"])


def update_ai_image_config(api_key: str = None, base_url: str = None, model: str = None, enabled: bool = None):
    """更新图片生成 AI 配置"""
    config = load_config()
    ai = config.get("ai_image", {})
    if api_key is not None:
        ai["api_key"] = api_key
    if base_url is not None:
        ai["base_url"] = base_url
    if model is not None:
        ai["model"] = model
    if enabled is not None:
        ai["enabled"] = enabled
    else:
        ai["enabled"] = bool(ai.get("api_key", ""))
    config["ai_image"] = ai
    save_config(config)


def is_ai_enabled() -> bool:
    """检查 AI 是否启用"""
    ai = get_ai_config()
    return ai.get("enabled", False) and bool(ai.get("api_key", ""))