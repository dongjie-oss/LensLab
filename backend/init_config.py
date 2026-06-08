"""
容器初始化脚本
在容器启动时执行：
  1. 检测 config.json 是否存在
  2. 存在 → 备份 → 字段级迁移到新版 → 校验完整性 → 删除备份
  3. 不存在 → 创建默认配置
  4. 检测并创建持久化目录
"""

import json
import shutil
import os
import sys
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="[INIT] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("init")

DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data")).resolve()
CONFIG_FILE = DATA_DIR / "config.json"
BACKUP_FILE = DATA_DIR / "config.json.bak"

CURRENT_DATA_VERSION = 1

DEFAULT_CONFIG = {
    "data_version": CURRENT_DATA_VERSION,
    "auth": {
        "username": "admin",
        # SHA-256("admin")
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
    },
}

# ===================== 持久化目录清单（版本化） =====================
# 使用 str(DATA_DIR) 而非硬编码路径，支持环境变量自定义
_REQUIRED_DIRS_RAW = {
    1: [
        "[[DATA_DIR]]",
        "[[DATA_DIR]]/uploads",
        "[[DATA_DIR]]/results",
    ],
}

REQUIRED_DIRS = {}
for v, dirs in _REQUIRED_DIRS_RAW.items():
    REQUIRED_DIRS[v] = [(d.replace("[[DATA_DIR]]", str(DATA_DIR)), "") for d in dirs]


def _get_all_required_dirs():
    """获取当前版本所有必需目录"""
    dirs = []
    for v in range(1, CURRENT_DATA_VERSION + 1):
        for d in REQUIRED_DIRS.get(v, []):
            if d[0] not in [x[0] for x in dirs]:
                dirs.append(d)
    return dirs


def _save_config(data: dict):
    """原子写入配置文件"""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.rename(CONFIG_FILE)
    logger.info(f"配置已写入: {CONFIG_FILE}")


def _load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"配置文件损坏: {e}，将重建")
    return None


def _migrate_fields(new: dict, old: dict) -> dict:
    """
    递归字段级迁移：
    把 old 中存在于 new 的字段迁移过去，
    新增字段保留 new 的默认值，
    旧字段不再存在则忽略。
    """
    for key, value in old.items():
        if key == "data_version":
            continue
        if key in new:
            if isinstance(value, dict) and isinstance(new[key], dict):
                _migrate_fields(new[key], value)
            else:
                new[key] = value
    return new


def _validate_config(data: dict) -> bool:
    """校验配置文件完整性"""
    errors = []

    if "auth" not in data:
        errors.append("缺少 auth 字段")
    else:
        auth = data["auth"]
        if not auth.get("username"):
            errors.append("auth.username 为空")
        if not auth.get("password_hash"):
            errors.append("auth.password_hash 为空")

    if "ai" not in data:
        errors.append("缺少 ai 字段")

    if "ai_image" not in data:
        errors.append("缺少 ai_image 字段")

    if errors:
        logger.error(f"配置文件校验失败: {'; '.join(errors)}")
        return False

    logger.info("配置文件校验通过")
    return True


def _ensure_dirs():
    """确保所有持久化目录存在"""
    for d, _desc in _get_all_required_dirs():
        Path(d).mkdir(parents=True, exist_ok=True)
        logger.info(f"目录就绪: {d}")


def init():
    """入口"""
    logger.info("=" * 50)
    logger.info("镜头演算室 初始化开始")
    logger.info(f"数据目录: {DATA_DIR}")
    logger.info(f"数据版本: v{CURRENT_DATA_VERSION}")
    logger.info("=" * 50)

    # === 1. 确保目录存在 ===
    _ensure_dirs()

    # === 2. 检测配置文件 ===
    if CONFIG_FILE.exists():
        logger.info("检测到已有配置文件，开始迁移...")

        # 备份
        shutil.copy2(CONFIG_FILE, BACKUP_FILE)
        logger.info(f"已备份: {BACKUP_FILE}")

        # 读旧配置
        old_config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))

        # 创建新配置模板（默认值）
        new_config = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
        new_config["data_version"] = CURRENT_DATA_VERSION

        # 字段级迁移
        migrated = _migrate_fields(new_config, old_config)
        logger.info("字段迁移完成")

        # 写入
        _save_config(migrated)

        # 校验
        if not _validate_config(migrated):
            logger.error("配置迁移后校验失败，保留备份供手动恢复")
            logger.error(f"备份文件: {BACKUP_FILE}")
            sys.exit(1)

        # 删除备份
        BACKUP_FILE.unlink()
        logger.info("备份已删除")
        logger.info("迁移完成 ✅")

    else:
        logger.info("全新安装，创建默认配置...")
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))
        cfg["data_version"] = CURRENT_DATA_VERSION
        _save_config(cfg)
        logger.info(f"默认账号: admin / admin")
        logger.info("请在首次登录后修改密码")
        logger.info("初始化完成 ✅")

    logger.info("=" * 50)
    logger.info("镜头演算室 就绪")
    logger.info("=" * 50)


if __name__ == "__main__":
    init()
