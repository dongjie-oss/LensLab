"""
v0 → v1 迁移（初始迁移）

1. history.json 从纯列表 → 带 data_version 的 dict 格式
2. config.json 从裸 dict → 带 data_version 的 dict 格式
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate_v0_to_v1(data: dict, path: Path) -> dict:
    """
    从旧格式迁移到 v1 格式。

    旧格式检测：
    - data_version=0 或缺失（由 load_data 设置的包装值）
    - history.json 原本是 [item1, item2]，被包装成 {data_version: 0, items: [...]}
    - config.json 原本是 {auth: ..., ai: ...}，被包装成 {data_version: 0, ...}
    """
    filename = path.name

    # 处理 history.json
    if filename == "history.json":
        items = data.get("items", [])
        if isinstance(items, list):
            # 给每个历史条目加 id（如果没有的话）
            for i, item in enumerate(items):
                if "item_id" not in item:
                    item["item_id"] = f"item_{i}"
            data["items"] = items
            logger.info(f"  history.json: 已迁移 {len(items)} 条记录")
        return data

    # 处理 config.json（没有结构变化，只是加了 version 字段）
    if filename == "config.json":
        logger.info(f"  config.json: 已添加版本号字段")
        return data

    # 处理 results/*.json
    if "file_id" in data:
        logger.info(f"  {filename}: 已添加版本号字段")
        return data

    logger.info(f"  {filename}: 已知类型，直接返回带版本号的数据")
    return data
