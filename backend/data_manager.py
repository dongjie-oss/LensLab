"""
Data Manager - 统一数据加载/保存/迁移框架

所有持久数据通过此模块读写。
数据文件格式：带 data_version 的 JSON 对象
升级时检测版本不一致 → 自动运行迁移函数
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 当前数据版本号（每次需要迁移时 +1）
# 版本号说明：
#   1 - 初始版本，只有原始字段
CURRENT_DATA_VERSION = 1


class DataVersionError(Exception):
    """数据版本异常"""
    pass


def load_data(path: Path, default_factory: callable) -> dict:
    """
    加载数据文件，自动检测版本并迁移，自动补缺失字段。

    Args:
        path: 数据文件路径
        default_factory: 文件不存在时调用的默认工厂函数，返回默认 dict

    Returns:
        迁移到最新版本、已补全缺失字段的数据 dict
    """
    if not path.exists():
        data = default_factory()
        data["data_version"] = CURRENT_DATA_VERSION
        _save_data(path, data)
        return data

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"数据文件 {path} 损坏，重置默认: {e}")
        data = default_factory()
        data["data_version"] = CURRENT_DATA_VERSION
        _save_data(path, data)
        return data

    # 旧版本格式的整合
    if not isinstance(raw, dict) or "data_version" not in raw:
        logger.info(f"{path.name}: 检测到旧版本格式，准备迁移")
        if isinstance(raw, list):
            raw = {"data_version": 0, "items": raw}
        else:
            raw["data_version"] = 0

    version = raw.get("data_version", 0)
    if version < CURRENT_DATA_VERSION:
        raw = _migrate_data(path, raw, version, CURRENT_DATA_VERSION)
        _save_data(path, raw)

    # 自动补缺失字段：对比默认值，把缺的字段填上
    defaults = default_factory()
    data = _merge_defaults(raw, defaults)

    # 如果有字段被补充，写回文件
    if data is not raw:
        _save_data(path, data)

    return data


def _merge_defaults(data: dict, defaults: dict) -> dict:
    """
    递归对比默认值，把缺失的字段补上。
    已有字段保留原值（用户配置不被覆盖），只补新增字段。
    """
    changed = False
    result = data.copy()
    
    for key, default_val in defaults.items():
        if key == "data_version":
            continue
        if key not in result:
            result[key] = default_val.copy() if isinstance(default_val, dict) else default_val
            changed = True
            logger.info(f"  补字段: {key}")
        elif isinstance(default_val, dict) and isinstance(result[key], dict):
            # 递归补嵌套 dict 的缺失字段
            sub = _merge_defaults(result[key], default_val)
            if sub is not result[key]:
                result[key] = sub
                changed = True
    
    return result if changed else data


def _migrate_data(path: Path, data: dict, from_version: int, to_version: int) -> dict:
    """执行从 from_version 到 to_version 的逐级迁移"""
    logger.info(f"迁移 {path.name}: v{from_version} → v{to_version}")

    for v in range(from_version, to_version):
        next_v = v + 1
        migrator_name = f"migrate_v{v}_to_v{next_v}"
        migrator = _get_migrator(migrator_name)

        if migrator:
            logger.info(f"  执行迁移函数 {migrator_name}")
            data = migrator(data, path)
        else:
            logger.info(f"  无迁移函数 v{v}→v{next_v}，仅更新版本号")

        data["data_version"] = next_v

    return data


def _get_migrator(migrator_name: str):
    """动态查找迁移函数"""
    try:
        from importlib import import_module

        # 先尝试从 migrations 模块加载
        try:
            mod = import_module(f"migrations.{migrator_name}")
            return getattr(mod, migrator_name)
        except (ImportError, AttributeError):
            pass

        # 再尝试直接 from backend.migrations
        try:
            mod = import_module(f"backend.migrations.{migrator_name}")
            return getattr(mod, migrator_name)
        except (ImportError, AttributeError):
            pass

        return None
    except Exception:
        return None


def save_data(path: Path, data: dict):
    """保存数据，自动确保 data_version 是最新的"""
    data["data_version"] = CURRENT_DATA_VERSION
    _save_data(path, data)


def _save_data(path: Path, data: dict):
    """实际写入文件"""
    path.parent.mkdir(parents=True, exist_ok=True)
    # 先写临时文件再 rename，避免写一半崩溃
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.rename(path)


def load_results_dir(results_dir: Path) -> list[dict]:
    """
    扫描并加载全部结果文件，同时升级

    Returns:
        list[dict] 所有迁移后的结果数据
    """
    items = []
    for p in sorted(results_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                # 版本检查
                version = data.get("data_version", 0)
                if version < CURRENT_DATA_VERSION:
                    data = _migrate_data(p, data, version, CURRENT_DATA_VERSION)
                    save_data(p, data)
                items.append(data)
        except Exception as e:
            logger.warning(f"读取结果文件 {p.name} 失败: {e}")
    return items