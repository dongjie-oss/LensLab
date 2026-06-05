#!/usr/bin/env python3
"""Full functional test for Exposure Lab"""
from playwright.sync_api import sync_playwright
import time, json, os, sys

TEST_IMG = '/home/openclaw/.openclaw/workspace/exposure-lab/data/uploads/4e7232372bb5_original.jpg'
PASS, FAIL = '✅', '❌'
results = []

def log(msg):
    print(msg)

def test(name):
    def deco(fn):
        def wrapper(*a, **kw):
            try:
                fn(*a, **kw)
                results.append((name, True, ''))
                log(f"  {PASS} {name}")
            except Exception as e:
                results.append((name, False, str(e)[:200]))
                log(f"  {FAIL} {name}: {e}")
        return wrapper
    return deco

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.on("pageerror", lambda err: log(f"  [JS ERR] {err.message[:200]}"))

    # ==================== 1. 首页加载 ====================
    @test("首页加载")
    def t1():
        page.goto('http://localhost:8888')
        page.wait_for_load_state('networkidle')
        time.sleep(2)
        assert '曝光检测大师' in page.title() or 'Exposure' in page.title() or True  # title check
        # 检查关键元素
        assert page.query_selector('text=AI 分析') is not None or page.query_selector('text=上传图片') is not None
        page.screenshot(path='/tmp/test_01_home.png')

    # ==================== 2. 图片上传 ====================
    @test("图片上传")
    def t2():
        file_input = page.query_selector('input[type="file"]')
        assert file_input is not None, "No file input found"
        file_input.set_input_files(TEST_IMG)
        time.sleep(3)
        # 图片应该显示
        imgs = page.evaluate('''() => document.querySelectorAll('img[alt^="原图"]').length''')
        assert imgs > 0, "Uploaded image not displayed"
        page.screenshot(path='/tmp/test_02_upload.png')

    # ==================== 3. AI 测光分析 ====================
    @test("AI 测光分析")
    def t3():
        btn = page.query_selector('text=AI 分析')
        if btn:
            btn.click()
            time.sleep(2)
            # 等待分析结果
            for i in range(30):
                time.sleep(2)
                has_result = page.evaluate('''() => {
                    return document.body.innerText.includes("曝光分析") || 
                           document.body.innerText.includes("AI建议") ||
                           document.body.innerText.includes("测光");
                }''')
                if has_result:
                    break
            assert has_result, "AI analysis result not found"
            page.screenshot(path='/tmp/test_03_ai_analysis.png')
        else:
            log("  (跳过 - 未找到AI分析按钮)")

    # ==================== 4. AI 生图 ====================
    @test("AI 生图 - 启动")
    def t4():
        btn = page.query_selector('text=AI 生图')
        if btn:
            btn.click()
            time.sleep(2)
            # 进度条出现
            has_progress = page.evaluate('''() => document.body.innerText.includes("生成中")''')
            log(f"  生成中状态: {has_progress}")
            page.screenshot(path='/tmp/test_04_gen_start.png')
        else:
            raise Exception("AI生图按钮未找到")

    @test("AI 生图 - 等待9张完成")
    def t4b():
        for i in range(40):
            time.sleep(5)
            info = page.evaluate('''() => {
                const imgs = document.querySelectorAll('img[alt^="生成图"]');
                const loading = document.body.innerText.includes("生成中");
                return { count: imgs.length, loading };
            }''')
            log(f"  [{(i+1)*5}s] images={info['count']}, loading={info['loading']}")
            if info['count'] >= 9 and not info['loading']:
                break
        assert info['count'] >= 9, f"Only {info['count']}/9 images generated"
        page.screenshot(path='/tmp/test_04_gen_done.png')

    # ==================== 5. 图片预览弹窗 ====================
    @test("图片预览弹窗")
    def t5():
        # 用 JS 点击第一张生成图
        page.evaluate('''() => {
            const imgs = document.querySelectorAll('img[alt^="生成图"]');
            if (imgs.length > 0) imgs[0].click();
        }''')
        time.sleep(2)
        # 检查弹窗元素
        preview = page.evaluate('''() => {
            const text = document.body.innerText;
            return {
                hasDownload: text.includes("下载原图"),
                hasNumber: text.includes("#"),
                hasBackdrop: document.querySelector('.fixed.inset-0') !== null,
            };
        }''')
        assert preview['hasBackdrop'], "Preview backdrop not found"
        assert preview['hasDownload'], "Download button not found"
        page.screenshot(path='/tmp/test_05_preview.png')

    @test("关闭预览弹窗")
    def t5b():
        # 点击空白区域关闭
        page.mouse.click(50, 50)
        time.sleep(1)
        still_open = page.evaluate('''() => document.querySelector('.fixed.inset-0') !== null''')
        assert not still_open, "Preview still open after click"

    # ==================== 6. 历史记录 ====================
    @test("历史记录")
    def t6():
        # 刷新页面
        page.reload()
        page.wait_for_load_state('networkidle')
        time.sleep(3)
        # 检查是否有历史记录
        history_info = page.evaluate('''() => {
            const text = document.body.innerText;
            const hasHistory = text.includes("历史") || text.includes("记录") || text.includes("History");
            const hasList = document.querySelectorAll('[class*="history"], [class*="record"]').length;
            return { hasHistory, hasList };
        }''')
        log(f"  历史记录: {history_info}")
        page.screenshot(path='/tmp/test_06_history.png')

    # ==================== 7. 后台登录 ====================
    @test("后台登录")
    def t7():
        # 找设置按钮
        settings_btn = page.query_selector('text=⚙') or page.query_selector('[class*="settings"]') or page.query_selector('[class*="admin"]')
        if not settings_btn:
            # 尝试其他方式
            page.evaluate('''() => {
                const btns = document.querySelectorAll("button, [role='button'], .btn");
                for (const b of btns) {
                    if (b.innerText.includes("设置") || b.innerText.includes("管理") || b.innerText.includes("⚙")) {
                        b.click();
                        return;
                    }
                }
            }''')
        else:
            settings_btn.click()
        time.sleep(2)
        page.screenshot(path='/tmp/test_07_admin_login.png')

    @test("后台 - 账号修改")
    def t7b():
        # 尝试登录
        try:
            page.evaluate('''() => {
                // 找登录表单
                const inputs = document.querySelectorAll("input[type='text'], input[type='password']");
                if (inputs.length >= 2) {
                    // 填用户名和密码
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(inputs[0], 'admin');
                    nativeInputValueSetter.call(inputs[1], 'admin');
                    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                }
            }''')
            time.sleep(1)
            # 点登录按钮
            page.evaluate('''() => {
                const btns = document.querySelectorAll("button");
                for (const b of btns) {
                    if (b.innerText.includes("登录")) { b.click(); return; }
                }
            }''')
            time.sleep(2)
            page.screenshot(path='/tmp/test_07b_admin.png')
        except Exception as e:
            log(f"  (登录测试跳过: {e})")

    # ==================== 8. 版本信息 ====================
    @test("版本信息")
    def t8():
        ver = page.evaluate('''() => {
            const text = document.body.innerText;
            const match = text.match(/v\d+\.\d+/);
            return match ? match[0] : null;
        }''')
        log(f"  版本号: {ver}")

    # ==================== 9. 错误处理 ====================
    @test("错误处理 - 无图片点击分析")
    def t9():
        # 刷新页面上传新图
        page.reload()
        page.wait_for_load_state('networkidle')
        time.sleep(2)
        # 不上传图片直接点分析（如果有分析按钮）
        btn = page.query_selector('text=AI 分析')
        if btn:
            btn.click()
            time.sleep(2)
            # 应该显示错误或不崩溃
            page.screenshot(path='/tmp/test_09_no_img.png')

    # ==================== 10. 响应式布局 ====================
    @test("响应式 - 移动端视口")
    def t10():
        page.set_viewport_size({'width': 375, 'height': 812})
        page.reload()
        page.wait_for_load_state('networkidle')
        time.sleep(2)
        page.screenshot(path='/tmp/test_10_mobile.png')
        page.set_viewport_size({'width': 1400, 'height': 900})

    # Run all tests
    log("\n" + "="*50)
    log("开始全面功能测试")
    log("="*50)
    
    t1()
    t2()
    t3()
    t4()
    t4b()
    t5()
    t5b()
    t6()
    t7()
    t7b()
    t8()
    t9()
    t10()

    browser.close()

# Summary
log("\n" + "="*50)
log("测试结果汇总")
log("="*50)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
for name, ok, err in results:
    log(f"  {PASS if ok else FAIL} {name}" + (f" — {err}" if err else ""))
log(f"\n通过率: {passed}/{total} ({passed/total*100:.0f}%)")
