#!/usr/bin/env python3
"""
镜头演算室 · 全流程发布管控脚本

功能：
  1. 发布流前检查（版本一致性、代码完整性、预发布构建）
  2. 发布流执行（自动或手动触发）
  3. 发布流后验证（远程容器状态、digest同步、项目记录更新）

用法：
  # 仅做发布前检查（不实际发布）
  python scripts/full_release_flow.py --check-only

  # 执行完整发布流程
  python scripts/full_release_flow.py --publish --target 10.0.1.138

  # 仅做发布后验证
  python scripts/full_release_flow.py --verify --target 10.0.1.138

返回值：
  0 → 成功
  1 → 失败
"""

import sys
import os
import json
import argparse
import subprocess
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent

def run_cmd(cmd, capture=True, cwd=None):
    """执行 shell 命令"""
    try:
        res = subprocess.run(
            cmd, shell=True, check=False,
            capture_output=capture, text=True,
            cwd=cwd or BASE_DIR,
            env=os.environ.copy()
        )
        if capture:
            return res.stdout.strip(), res.stderr.strip(), res.returncode
        return "", "", res.returncode
    except Exception as e:
        return "", str(e), 1

# ==== Phase 1: 流前检查 ====

def check_version_consistency():
    """引入版本一致性检查脚本"""
    cmd = f'"{sys.executable}" scripts/check_version_consistency.py'
    stdout, stderr, rc = run_cmd(cmd, capture=True)
    print(stdout)
    if stderr:
        print(f"STDERR: {stderr}")
    print()
    return rc == 0

def check_git_status():
    """检查 git 工作区状态"""
    stdout, _, rc = run_cmd("git status --porcelain")
    if rc != 0:
        print("  ❌ 不在 git 仓库中")
        return False
    if stdout:
        print("  ❌ 有未提交的更改")
        print("     修改文件:")
        for line in stdout.splitlines():
            print(f"       {line}")
        return False
    print("  ✅ 工作区干净")
    return True

def build_docker_local():
    """本地构建 Docker 镜像（测试用）"""
    print("  📦 本地构建 Docker 镜像...")
    stdout, stderr, rc = run_cmd("docker build -t exposure-lab:dev .", cwd=BASE_DIR)
    if rc != 0:
        print(f"  ❌ 构建失败:\n{stderr}")
        return False
    print("  ✅ 构建成功")
    return True

def pre_release_check(verbose=False):
    """完整流前检查"""
    print("="*60)
    print("  发布前检查")
    print("="*60)
    print()

    checks = [
        ("版本号一致性", check_version_consistency),
        ("Git 工作区状态", check_git_status),
    ]

    # 可选：本地构建测试
    # checks.append(("本地 Docker 构建", build_docker_local))

    all_ok = True
    for name, func in checks:
        print(f"[{name}]")
        ok = func()
        all_ok = all_ok and ok
        print()

    if all_ok:
        print("✅ 所有流前检查通过")
    else:
        print("❌ 流前检查未通过，请修正后再发布")
    print("="*60)
    return all_ok

# ==== Phase 2: 发布执行 ====

def get_current_version():
    """从 __version__.py 获取版本号"""
    import re
    vfile = BASE_DIR / "backend" / "__version__.py"
    m = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', vfile.read_text())
    return m.group(1) if m else None

def build_and_push_acr(version: str):
    """
    执行标准发布流程（按 persistence/docker-publish-flow.md）
    """
    print(f"🚀 开始发布 v{version}")
    print()

    # Step 1: 前端编译
    print("【1】前端编译")
    stdout, stderr, rc = run_cmd("node frontend/compile.js", cwd=BASE_DIR)
    if rc != 0:
        print(f"❌ 编译失败: {stderr}")
        return False
    print("✅ 前端编译完成")

    # Step 2: Docker 构建并推送（多平台）
    print("\n【2】Docker 构建并推送 ACR")
    print(f"  目标镜像: registry.cn-hangzhou.aliyuncs.com/exposure-lab/exposure-lab:{version}")
    print("  注意：此步会执行多阶段构建并上传到阿里云 ACR，可能需要几分钟。")

    # 使用 docker buildx build --push
    tag = f"registry.cn-hangzhou.aliyuncs.com/exposure-lab/exposure-lab:{version}"
    cmd = f'docker buildx build --platform linux/amd64 --push -t {tag} -t registry.cn-hangzhou.aliyuncs.com/exposure-lab/exposure-lab:latest .'
    stdout, stderr, rc = run_cmd(cmd, cwd=BASE_DIR)

    if rc != 0:
        print(f"❌ 构建/推送失败:\n{stderr}")
        return False
    print("✅ 构建并推送完成")

    # Step 3: 生成 Release Notes 并提交
    print("\n【3】生成 GitHub Release 并打 Tag")
    changelog = BASE_DIR / "data" / "VERSIONS.json"
    if not changelog.exists():
        print("❌ 缺少 VERSIONS.json，无法提取 release notes")
        return False

    notes = extract_release_notes(changelog, version)
    print(f"   Release Notes 预览:\n{notes}")

    # 生成 VERSION 文件中的 changelog
    commit_msg_file = BASE_DIR / ".release-commit-msg.txt"
    commit_msg_file.write_text(f"release: v{version} — {notes.split(chr(10))[1].strip()}\n", encoding="utf-8")

    # git commit + tag
    cmds = [
        'git add -A',
        f'git commit -F "{commit_msg_file}"',
        f'git tag -a v{version} -m "Release v{version}"',
        f'git push origin main --tags',
    ]
    for cmd in cmds:
        stdout, stderr, rc = run_cmd(cmd, cwd=BASE_DIR)
        if rc != 0:
            print(f"❌ git 操作失败 [{cmd}]: {stderr}")
            return False
        print(f"  ✅ {cmd}")

    commit_msg_file.unlink(missing_ok=True)
    print("✅ GitHub Release 已准备（可在 GitHub 界面确认）")

    return True

def extract_release_notes(vj_path: Path, version: str) -> str:
    """从 VERSIONS.json 提取指定版本的 release notes"""
    data = json.loads(vj_path.read_text(encoding="utf-8"))
    entry = None
    for e in data.get("changelog", []):
        if e["version"] == version:
            entry = e
            break
    if not entry:
        return "自动生成 release notes 失败"

    notes = entry["notes"]
    lines = [f"## {version}", f"\n**日期**: {entry['date']}", f"\n### 概述\n{notes}\n"]
    for section in entry.get("detail", {}).get("sections", []):
        typ = section["type"]
        lines.append(f"\n### {typ}\n")
        for item in section["items"]:
            lines.append(f"- {item}")
    return "\n".join(lines)

def do_publish(target: str, skip_checks=False):
    """完整发布流程"""
    if not skip_checks:
        if not pre_release_check():
            return False

    version = get_current_version()
    if not version:
        print("❌ 无法读取版本号")
        return False

    print(f"\n📦 当前检测版本: v{version}")

    # 询问确认（模拟交互）
    print("\n即将执行：")
    print("  1. 前端编译")
    print("  2. Docker 构建并推送 ACR")
    print("  3. 提交并打 Tag")
    print("\n请确认以上步骤无误后继续。")

    # 实际发布 — 如果当前是真实发布，应该由用户明确触发
    # 这里只做演示，返回 True 让主流程继续
    print("\n⚠️  注意：这是真实发布流程。请先手动执行确认步骤。")
    print("    修改此脚本后，调用 `--publish` 才会执行实际推送。")
    return True

# ==== Phase 3: 流后验证 ====

def post_verify(target: str):
    """发布后远程验证"""
    print("="*60)
    print("  发布后验证")
    print("="*60)
    print(f"  目标: {target}")

    base = f"http://{target}:8765"
    try:
        import httpx
    except ImportError:
        print("❌ 需要 httpx，请 pip install httpx")
        return False

    ok = True
    try:
        with httpx.Client(base_url=base) as client:
            r = client.get("/api/versions", timeout=15)
            r.raise_for_status()
            data = r.json()
            ver = data["current"]["version"]
            dv = data["current"]["data_version"]
            digest = data["current"].get("digest", "")
            print(f"  ✅ /api/versions 可访问")
            print(f"     版本: {ver}")
            print(f"     data_version: {dv}")
            if digest:
                print(f"     digest: {digest[:16]}...")
            else:
                print("     digest: (空)")
    except Exception as e:
        print(f"  ❌ 无法访问 /api/versions: {e}")
        ok = False

    # 检查容器状态 via SSH
    if target != "localhost":
        stdout, _, rc = run_cmd(f"ssh root@{target} 'docker ps --format {{{{.Names}}}} --filter name=lenslab'")
        if "lenslab" in stdout:
            print(f"  ✅ 容器正在运行")
        else:
            print(f"  ⚠️  容器可能未运行")
    print()

    if ok:
        print("✅ 发布后验证通过")
    else:
        print("❌ 发布后验证失败")
    return ok

# ==== Main ====

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check-only", action="store_true", help="仅执行流前检查")
    p.add_argument("--publish", action="store_true", help="执行发布流程")
    p.add_argument("--verify", action="store_true", help="执行发布后验证")
    p.add_argument("--target", default="10.0.1.138", help="远程服务器地址（用于验证）")
    p.add_argument("--skip-checks", action="store_true", help="发布时跳过流前检查（不推荐）")
    args = p.parse_args()

    if not args.check_only and not args.publish and not args.verify:
        print("请指定 --check-only 或 --publish 或 --verify")
        return 1

    if args.check_only:
        ok = pre_release_check(verbose=True)
        sys.exit(0 if ok else 1)

    if args.publish:
        ok = do_publish(args.target, skip_checks=args.skip_checks)
        sys.exit(0 if ok else 1)

    if args.verify:
        ok = post_verify(args.target)
        sys.exit(0 if ok else 1)

    return 0

if __name__ == "__main__":
    sys.exit(main())