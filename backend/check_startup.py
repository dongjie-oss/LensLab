"""
容器启动自检脚本
检查：配置完整性、API Key、并发参数、目录就绪
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config_manager import load_config, get_ai_image_config
from ai_generator import GENERATED_DIR, _load_concurrent_params

def check_config():
    """检查配置完整性"""
    cfg = load_config()
    has_ai_key = cfg.get("ai_image", {}).get("api_key", "")
    if not has_ai_key:
        print("⚠️  提示: AI 图片生成 API Key 未配置（登录后在设置中填写即可）")
    else:
        print("✅ 配置检查通过")
    # API Key 为空不阻断启动，用户登录后填写即可
    return True

def check_concurrency_params():
    """检查并发控制参数"""
    params = _load_concurrent_params()
    max_conc, interval, max_retries, backoff = params
    if max_conc < 1 or max_conc > 10:
        print(f"❌ 严重: max_concurrent={max_conc} 超出范围 [1,10]")
        return False
    if interval < 1 or interval > 30:
        print(f"❌ 严重: request_interval={interval} 超出范围 [1,30]")
        return False
    if max_retries < 0 or max_retries > 10:
        print(f"❌ 严重: max_429_retries={max_retries} 超出范围")
        return False
    if backoff < 5 or backoff > 60:
        print(f"❌ 严重: 429_backoff_base={backoff} 超出范围 [5,60]")
        return False
    print(f"✅ 并发参数检查通过: workers={max_conc}, interval={interval}s, retries={max_retries}, backoff={backoff}s")
    return True

def check_directories():
    """检查持久化目录"""
    required = [GENERATED_DIR, GENERATED_DIR.parent / "uploads", GENERATED_DIR.parent / "results"]
    for d in required:
        d.mkdir(parents=True, exist_ok=True)
        if not d.exists():
            print(f"❌ 严重: 目录创建失败 {d}")
            return False
    print("✅ 目录检查通过")
    return True

def check_version_match():
    """检查版本一致性"""
    version_file = Path("/app/version.json")
    if version_file.exists():
        try:
            ver = json.loads(version_file.read_text())
            print(f"✅ 版本信息: {ver.get('version', 'unknown')} ({ver.get('build_time', 'unknown')[:10]})")
        except Exception as e:
            print(f"⚠️ 警告: 版本信息读取失败 - {e}")
    else:
        print("⚠️ 警告: 未找到版本信息文件")
    return True

if __name__ == "__main__":
    print("🔍 启动自检开始...")
    checks = [
        check_version_match(),
        check_config(),
        check_concurrency_params(),
        check_directories(),
    ]
    if all(checks):
        print("\n✅ 自检通过，服务就绪！")
        sys.exit(0)
    else:
        print("\n❌ 自检失败，请检查配置")
        sys.exit(1)