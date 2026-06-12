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

# 代码内嵌的权威 changelog（每次发版必须同步更新此列表）
# 启动时自动与持久化的 VERSIONS.json 合并，确保 bind mount 下旧版本升级不丢条目
BUNDLED_CHANGELOG = [
    {
        "version": "1.0.0",
        "date": "2026-06-03",
        "notes": "初始版本 — 区域曝光分析、AI智能分析、AI生图、模板管理",
        "digest": "",
        "detail": {
            "sections": [
                {"type": "added", "items": [
                    "照片上传、缩略图浏览与区域曝光分析功能",
                    "AI图表分析（直方图/分区亮度）",
                    "AI智能生图（9种预设风格模板）",
                    "用户管理后台（认证、模型配置、版本查看）",
                    "Docker Compose 一键部署",
                    "GitHub Actions CI/CD 自动构建推送到阿里云 ACR",
                ]}
            ]
        },
    },
    {
        "version": "1.0.1",
        "date": "2026-06-07",
        "notes": "新增自定义提示词功能，优化AI生图策略与UI交互",
        "digest": "",
        "detail": {
            "sections": [
                {"type": "changed", "items": [
                    "AI生图速度优化：LLM describe + generate_prompts 并行执行",
                    "并发参数提升：MAX_CONCURRENT 2→3，REQUEST_INTERVAL 3s→1s",
                    "前端按钮文案动态化：根据实际生成数量显示",
                ]},
                {"type": "added", "items": [
                    "无限想象优先级系统：全局风格 > 用户提示词 > 无限想象",
                    "AiGenPanel 生成按钮回调支持自定义提示词模式",
                ]},
                {"type": "refactor", "items": [
                    "elif 分支从 6 个精简为 4 个，逻辑更清晰",
                    "check_startup.py api_key 空值不再阻塞容器启动",
                ]},
            ]
        },
    },
    {
        "version": "1.0.2",
        "date": "2026-06-12",
        "notes": "v1.0.2 — 新增系统清理功能 + UI 优化 + 配置迁移安全",
        "digest": "",
        "detail": {
            "sections": [
                {"type": "新增", "items": [
                    "后台管理系统 tab：自动/手动清理 AI 生成临时图片",
                    "AI 生图后自动检查 generated/ 大小，超过阈值自动清理旧文件",
                    "手动清理按钮一键清空临时图片",
                    "config_manager.py 配置迁移：备份→合并→验证→回滚机制",
                ]},
                {"type": "优化", "items": [
                    "AI 生图设置面板：比例 → 方向 → 分辨率改为单行排列",
                    "首页文生图快捷面板：比例 → 方向 → 分辨率单行排列",
                    "load_config() 仅新增键时才写入",
                ]},
                {"type": "修复", "items": [
                    "AI 生图弹窗白屏问题（selectedRatio 未传入子组件）",
                    "自定义提示词模式下比例/分辨率不传递给后端",
                    "后台管理 API 配置丢失问题",
                ]},
            ]
        },
    },
    {
        "version": "1.0.3",
        "date": "2026-06-13",
        "notes": "v1.0.3 — AI内容智能识别 + 人像专属风格 + 提示词预览",
        "digest": "",
        "detail": {
            "sections": [
                {"type": "added", "items": [
                    "versions.py 内嵌权威 BUNDLED_CHANGELOG，启动时自动同步版本号与 changelog",
                    "AI 图片内容智能识别：describe 返回 JSON 格式，自动分类 portrait（人像）/ scene（风景）/ object（静物）",
                    "人像专属风格模板：新增 9 种人像风格（复古街拍/日系清新/时尚杂志/黑白质感/暖调写真/冷艳大片/电影感人像/自然纪实/创意光影）",
                    "大图预览提示词面板：预览图右侧完整展示当前图片的提示词和标签",
                ]},
                {"type": "changed", "items": [
                    "无限想象生成策略根据内容类型自适应：人像场景使用专属风格，风景/静物使用通用风格",
                    "生成提示词根据 content_type 使用不同的 LLM 指令模板，提升内容匹配度",
                    "analyze 后自动切换区域模式时清除旧分析结果，防止残留",
                ]},
                {"type": "fixed", "items": [
                    "文生图模式下分析结果栏误显示问题（增加 mode 判断条件）",
                    "describe 返回格式统一为 dict，降级处理更健壮",
                ]},
            ]
        },
    },
]


def _parse_semver_str(ver: str) -> tuple:
    """从版本字符串解析 (major, minor, patch)"""
    import re as _re
    m = _re.match(r"(\d+)\.(\d+)\.(\d+)", ver)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (0, 0, 0)


DEFAULT_VERSIONS = {
    "current": {
        "version": __version__,
        "digest": "",
        "data_version": CURRENT_DATA_VERSION,
        "date": "2026-06-13",
        "notes": "v" + __version__ + " — AI内容智能识别 + 人像专属风格",
    },
    "changelog": [item.copy() for item in BUNDLED_CHANGELOG],
}

# ACR 仓库配置
ACR_REGISTRY = os.getenv("ACR_REGISTRY", "registry.cn-hangzhou.aliyuncs.com")
ACR_NAMESPACE = os.getenv("ACR_NAMESPACE", "exposure-lab")
ACR_REPO = os.getenv("ACR_REPO", "exposure-lab")
ACR_USERNAME = os.getenv("ACR_USERNAME", "")
ACR_PASSWORD = os.getenv("ACR_PASSWORD", "")


def load_versions() -> dict:
    """加载版本信息，启动时自动同步代码版本与持久化数据"""
    # 先用 DEFAULT_VERSIONS 的 current 作为后备，changelog 先读持久化的
    versions = load_data(VERSIONS_FILE, lambda: DEFAULT_VERSIONS.copy())
    
    code_ver = _parse_semver_str(__version__)
    persist_ver = _parse_semver_str(versions.get("current", {}).get("version", "0.0.0"))
    
    changed = False
    
    # 规则1：代码版本 > 持久化版本 → 同步 current + 合并 changelog
    if code_ver > persist_ver:
        versions["current"]["version"] = __version__
        versions["current"]["notes"] = DEFAULT_VERSIONS["current"]["notes"]
        versions["current"]["date"] = DEFAULT_VERSIONS["current"]["date"]
        # digest 保留（可能已有远程拉取写入的值）
        changed = True
        logger.info(f"版本自动升级: {persist_ver} → {__version__}")
    
    # 规则2：合并代码内嵌的 changelog 条目（去重，保留 detail）
    persist_list = versions.get("changelog", [])
    persist_versions = {e["version"]: e for e in persist_list}
    merged = False
    for entry in BUNDLED_CHANGELOG:
        ver = entry["version"]
        if ver not in persist_versions:
            # 新增条目
            persist_list.append(entry.copy())
            merged = True
        elif not persist_versions[ver].get("detail") and entry.get("detail"):
            # 旧条目缺少 detail，补充
            persist_versions[ver]["detail"] = entry["detail"]
            merged = True
    if merged:
        # 按版本号降序排列
        persist_list.sort(key=lambda e: _parse_semver_str(e["version"]), reverse=True)
        versions["changelog"] = persist_list
        changed = True
        logger.info("changelog 条目已合并同步")
    
    if changed:
        save_versions(versions)
    
    return versions


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


# ===================== 版本检测 =====================

# GitHub 仓库配置（用于版本检测）
GITHUB_REPO = os.getenv("GITHUB_REPO", "dongjie-oss/exposure-lab")


def _fetch_github_tags() -> list[str]:
    """
    通过 git ls-remote 查询 GitHub 远端 tag。
    无需网络认证，Docker 容器内自带 git。
    注意：容器内需能访问 GitHub（git clone 或 fetch 能通）。
    如果不行，fallback 到 ACR 查询。
    """
    import subprocess
    
    tags = []
    try:
        result = subprocess.run(
            ["git", "ls-remote", "--tags", "https://github.com", GITHUB_REPO],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line:
                    parts = line.split("\t")
                    ref = parts[1] if len(parts) > 1 else ""
                    if ref.startswith("refs/tags/v"):
                        tag = ref.replace("refs/tags/", "")
                        tags.append(tag)
            logger.info(f"GitHub 返回 {len(tags)} 个 tag: {tags}")
    except Exception as e:
        logger.warning(f"GitHub tag 查询失败: {e}")
    
    return tags


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
    优先查 ACR 远端 tag（带认证 fallback），失败后提示手动升级。
    """
    current = get_current_version()
    current_ver = current.get("version", __version__)

    # 查远端
    tags = _fetch_acr_tags()
    latest = _find_latest_version(tags)

    # 如果 ACR 也查不到
    if not latest:
        return {
            "current_version": current_ver,
            "latest_version": None,
            "update_available": False,
            "message": "无法获取远端版本信息，请手动检查",
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
