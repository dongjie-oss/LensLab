"""
版本管理模块
- 本地版本信息读写
- 远端 ACR 仓库最新版本查询（方案 A：查标签列表）
- 版本对比
"""

import os
import json
import logging
import urllib.request
import urllib.error
import re
from pathlib import Path
from typing import Optional

from __version__ import __version__

try:
    from .data_manager import load_data, save_data, CURRENT_DATA_VERSION
    from .config_manager import DATA_DIR
except ImportError:
    from data_manager import load_data, save_data, CURRENT_DATA_VERSION
    from config_manager import DATA_DIR

logger = logging.getLogger(__name__)

VERSIONS_FILE = DATA_DIR / "VERSIONS.json"

DEFAULT_VERSIONS = {
    "current": {
        "version": __version__,
        "digest": "",
        "data_version": CURRENT_DATA_VERSION,
        "date": "2026-06-06",
        "notes": "v" + __version__ + " — AI生图速度优化、无限想象优先级系统、elif分支重构",
    },
    "changelog": [
        {
            "version": "1.0.0",
            "date": "2026-06-05",
            "notes": "AI生图策略重构 + 模板类型分类",
            "digest": "",
        },
        {
            "version": __version__,
            "date": "2026-06-06",
            "notes": "AI生图速度优化、无限想象优先级系统、elif分支重构",
            "digest": "",
        }
    ],
}

# ACR 仓库配置
ACR_REGISTRY = os.getenv("ACR_REGISTRY", "registry.cn-hangzhou.aliyuncs.com")
ACR_NAMESPACE = os.getenv("ACR_NAMESPACE", "exposure-lab")
ACR_REPO = os.getenv("ACR_REPO", "exposure-lab")
ACR_USERNAME = os.getenv("ACR_USERNAME", "")
ACR_PASSWORD = os.getenv("ACR_PASSWORD", "")


def load_versions() -> dict:
    return load_data(VERSIONS_FILE, lambda: DEFAULT_VERSIONS.copy())


def save_versions(data: dict):
    save_data(VERSIONS_FILE, data)


def get_current_version() -> dict:
    return load_versions()["current"]


def get_changelog() -> list:
    return load_versions().get("changelog", [])


# ===================== ACR 远端查询 =====================

def _parse_semver(tag: str) -> tuple:
    """解析语义化版本号，返回 (major, minor, patch) 元组，解析失败返回 (0,0,0)"""
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (0, 0, 0)


def _fetch_acr_tags() -> list[str]:
    """
    查询 ACR 公开仓库的标签列表。
    公开仓库无需认证。
    """
    url = f"https://{ACR_REGISTRY}/v2/{ACR_NAMESPACE}/{ACR_REPO}/tags/list"
    logger.info(f"查询 ACR 标签: {url}")

    req = urllib.request.Request(url, headers={
        "User-Agent": "exposure-lab/1.0",
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tags = data.get("tags", []) or []
            logger.info(f"ACR 返回 {len(tags)} 个标签: {tags}")
            return tags
    except urllib.error.HTTPError as e:
        if e.code == 401 and (ACR_USERNAME and ACR_PASSWORD):
            # 需要认证，重试带 token 的请求
            logger.info("ACR 需要认证，尝试使用 Token 登录")
            return _fetch_acr_tags_with_auth()
        if e.code == 404:
            logger.warning(f"ACR 仓库不存在: {ACR_NAMESPACE}/{ACR_REPO}")
        else:
            logger.warning(f"ACR API HTTP 错误: {e.code}")
        return []
    except Exception as e:
        logger.warning(f"ACR API 请求失败: {e}")
        return []


def _fetch_acr_tags_with_auth() -> list[str]:
    """带 Token 登录的 ACR 查询"""
    url = f"https://{ACR_REGISTRY}/v2/{ACR_NAMESPACE}/{ACR_REPO}/tags/list"
    logger.info(f"带认证查询 ACR 标签: {url}")
    
    import base64
    credentials = f"{ACR_USERNAME}:{ACR_PASSWORD}"
    encoded = base64.b64encode(credentials.encode()).decode()
    
    req = urllib.request.Request(url, headers={
        "User-Agent": "exposure-lab/1.0",
        "Authorization": f"Basic {encoded}",
    })
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tags = data.get("tags", []) or []
            logger.info(f"ACR 返回 {len(tags)} 个标签: {tags}")
            return tags
    except urllib.error.HTTPError as e:
        logger.warning(f"ACR 认证查询失败: {e.code}")
        return []


def _find_latest_version(tags: list[str]) -> Optional[str]:
    """从标签列表中找出最新的语义化版本"""
    semver_tags = []
    for t in tags:
        v = _parse_semver(t)
        if v != (0, 0, 0):
            semver_tags.append((v, t))

    if not semver_tags:
        return None

    semver_tags.sort(key=lambda x: x[0], reverse=True)
    return semver_tags[0][1]


def check_for_update() -> dict:
    """
    检查是否有可用更新。
    1. 查 ACR 标签列表
    2. 找最新语义化版本
    3. 和当前版本对比
    """
    current = get_current_version()
    current_ver = current.get("version", __version__)

    # 查远端
    tags = _fetch_acr_tags()
    latest = _find_latest_version(tags)

    if not latest:
        return {
            "current_version": current_ver,
            "latest_version": None,
            "update_available": False,
            "message": "无法获取远端版本信息（ACR 查询失败）",
        }

    # 对比
    cur_tuple = _parse_semver(current_ver)
    lat_tuple = _parse_semver(latest)

    if lat_tuple > cur_tuple:
        return {
            "current_version": current_ver,
            "latest_version": latest,
            "update_available": True,
            "message": f"有新版本可用: {latest}（当前: {current_ver}）",
            "upgrade_hint": f"docker pull {ACR_REGISTRY}/{ACR_NAMESPACE}/{ACR_REPO}:{latest}",
        }
    else:
        return {
            "current_version": current_ver,
            "latest_version": latest,
            "update_available": False,
            "message": "已是最新版本",
        }


def update_version_meta(
    version: str,
    digest: str,
    notes: str = "",
    data_version: Optional[int] = None,
) -> dict:
    """更新版本元数据（升级成功后调用）"""
    versions = load_versions()
    versions["current"]["version"] = version
    versions["current"]["digest"] = digest
    versions["current"]["notes"] = notes
    versions["current"]["data_version"] = data_version or CURRENT_DATA_VERSION

    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    versions["changelog"].insert(0, {
        "version": version,
        "date": today,
        "notes": notes,
        "digest": digest,
    })

    save_versions(versions)
    return versions["current"]
