/**
 * LensLab Mobile Enhancer v3.9
 * 干净方案：shell 不创建层叠上下文，抽屉直接 fixed 在 body 级别
 * 修改：抽屉 200px，批量选择+删除，提示词卡片
 */
(function () {
  if (location.search.includes('desktop=1')) return;
  if (!location.search.includes('mobile=1') && innerWidth >= 1024) return;

  var css = document.createElement('style');
  css.textContent = [
    /* 全局归零 */
    'html.force-mobile, body.force-mobile { margin:0!important; padding:0!important; overflow:hidden!important; height:100%!important; }',

    /* ===== 抽屉：fixed 定位，z-index 2000/1500 ===== */
    'body.force-mobile #mob-left, body.force-mobile #mob-right {',
    '  display:none!important; position:fixed!important; z-index:2000!important;',
    '  overflow-y:auto; -webkit-overflow-scrolling:touch; background:#0d1117;',
    '}',
    'body.force-mobile #mob-left { left:0!important; top:56px!important; bottom:0!important; width:250px!important; transform:translateX(-100%)!important; transition:transform .25s ease; }',
    'body.force-mobile #mob-right { right:0!important; top:56px!important; bottom:0!important; width:220px!important; transform:translateX(100%)!important; transition:transform .25s ease; }',
    'body.force-mobile.mob-open-left #mob-left { display:flex!important; flex-direction:column!important; transform:translateX(0)!important; width:250px!important; }',
    'body.force-mobile.mob-open-right #mob-right { display:flex!important; flex-direction:column!important; transform:translateX(0)!important; width:220px!important; }',

    /* ===== 遮罩 ===== */
    '#mob-overlay { display:none; position:fixed; inset:0; z-index:1500; background:rgba(0,0,0,0.8); }',

    /* ===== 主区域（#root > div）：正常流，不创建层叠上下文 ===== */
    'body.force-mobile #root > div {',
    '  margin:0!important; padding:0!important;',
    '  display:flex!important; flex-direction:column!important;',
    '  height:calc(100vh - 56px)!important;',
    '  margin-top:56px!important;',
    '  overflow:hidden!important;',
    '  background:#0a0e17!important;',
    '  border:none!important;',
    '  max-height:calc(100vh - 56px)!important;',
    '  min-height:0!important;',
    '}',

    /* ===== main 内容区 ===== */
    'body.force-mobile #mob-main { flex:1 0 0!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch!important; }',

    /* ===== toolbar ===== */
    'body.force-mobile #mob-main > div:first-child {',
    '  display:flex!important; flex-direction:column!important;',
    '  height:auto!important; min-height:auto!important; max-height:none!important;',
    '  overflow:visible!important; padding:8px 12px!important;',
    '  background:#0d1117!important; border-bottom:1px solid #1e293b!important;',
    '  position:sticky!important; top:0!important; z-index:50!important;',
    '}',
    'body.force-mobile #mob-main > div:first-child > div {',
    '  display:flex!important; flex-wrap:wrap!important; gap:4px!important;',
    '  padding:2px 0!important; max-width:100%!important; justify-content:flex-start!important;',
    '}',
    'body.force-mobile #mob-main > div:first-child button {',
    '  font-size:11px!important; padding:5px 8px!important; border-radius:6px!important;',
    '  white-space:nowrap!important; min-height:30px!important; flex-shrink:0!important;',
    '}',
    'body.force-mobile #mob-main > div:first-child span { font-size:11px!important; white-space:nowrap!important; }',

    /* 上传区域 */
    'body.force-mobile .drop-zone { min-height:180px!important; margin:10px!important; border-radius:12px!important; }',

    /* 比例按钮 */
    'body.force-mobile #mob-main > div:nth-child(2) > div { display:flex!important; flex-wrap:wrap!important; gap:6px!important; padding:6px 10px!important; }',
    'body.force-mobile #mob-main > div:nth-child(2) button { font-size:12px!important; padding:6px 10px!important; min-height:34px!important; flex-shrink:0!important; }',

    /* 文字输入 */
    'body.force-mobile #mob-main textarea { font-size:16px!important; min-height:44px!important; max-height:120px!important; }',

    /* 关闭按钮 */
    '.mob-close-btn { display:flex; align-items:center; justify-content:center; width:100%; padding:12px; background:#161b22; border-bottom:1px solid #1e293b; color:#e2e8f0; font-size:14px; cursor:pointer; flex-shrink:0; }',

    /* 左侧抽屉：隐藏标题栏、齿轮、上传按钮区，保留顶部历史记录标签和批量选择内容 */
    '#mob-left > .p-4 { display:none!important; }',
    '#mob-left > .p-3 { display:none!important; }',
    /* 隐藏flex-1区域内的“历史记录”小标签（保留批量选择按钮） */
    '#mob-left .flex-1 > div:first-child > div:first-child { display:none!important; }',
    '#mob-left .flex-1 .truncate { display:inline!important; }',
    '#mob-left .flex-1 .text-xs.text-slate-300 { font-size:10px!important; display:block!important; color:#cbd5e1!important; }',
    '#mob-left .flex-1 .text-xs.text-slate-500 { font-size:9px!important; display:block!important; color:#64748b!important; }',
    '#mob-left .flex-1 .text-xs.text-slate-600 { font-size:9px!important; display:inline!important; }',
    '#mob-left .flex-1 .text-xs.text-red-400 { font-size:10px!important; display:inline!important; }',

    /* 保留顶部历史记录标签样式 */
    '#mob-hist-label { display:block!important; padding:12px 16px 6px; color:#94a3b8; font-size:13px; font-weight:600; letter-spacing:0.05em; }',

    /* 历史缩略图放大：40×40 → 160×160（抽屉 200px 的 80%） */
    '#mob-left .flex-1 .w-10.h-10 { width:220px!important; height:220px!important; border-radius:8px!important; flex-shrink:0!important; }',
    '#mob-left .flex-1 .w-10.h-10 img { width:100%!important; height:100%!important; object-fit:cover!important; border-radius:8px!important; }',
    '#mob-left .flex-1 .group { padding:0!important; margin:0 0 12px!important; flex-direction:column!important; align-items:stretch!important; }',
    '/* 批量选择按钮行：白色文字，禁止截断 */',
    '#mob-left .flex.items-center.justify-between { padding:6px 8px!important; }',
    '#mob-left .flex.items-center.justify-between button { color:#94a3b8!important; font-size:11px!important; }',
    '/* HistoryItem 内文字（文件名+时间） */',
    '#mob-left .text-xs.text-slate-300.truncate { font-size:10px!important; display:block!important; color:#cbd5e1!important; }',
    '#mob-left .text-\[10px\].text-slate-500 { font-size:9px!important; display:block!important; }',
    '/* AI 生图预览弹窗移动端全屏 — 紧凑布局，确保所有元素可见 */',
    'body.force-mobile .ai-gen-preview-overlay { position:fixed!important; inset:0!important; z-index:5000!important; }',
    'body.force-mobile .ai-gen-preview-overlay > div:first-child {',
    '  display:flex!important; flex-direction:column!important;',
    '  width:100%!important; max-width:100%!important;',
    '  height:auto!important; max-height:100vh!important;',
    '  padding:0!important; margin:0!important;',
    '  border-radius:0!important; background:#0f172a!important;',
    '  gap:0!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch!important;',
    '}',
    '/* 图片区 — 自然高度，内容驱动 */',
    'body.force-mobile .ai-gen-preview-img-area {',
    '  flex:0 0 auto!important; position:relative!important;',
    '  height:auto!important; max-height:none!important;',
    '  display:flex!important; align-items:center!important;',
    '  justify-content:center!important; background:#000!important; width:100%!important;',
    '  overflow:hidden!important;',
    '}',
    'body.force-mobile .ai-gen-preview-img-area img {',
    '  max-width:100%!important; width:100%!important; height:auto!important;',
    '  border-radius:0!important; object-fit:contain!important;',
    '}',
    '/* 提示词卡片 — 高度自适应，文字多时滚动 */',
    'body.force-mobile .ai-gen-preview-prompt-card {',
    '  flex:0 0 auto!important; min-width:0!important; width:100%!important;',
    '  max-height:30vh!important;',
    '  border-radius:0!important; border:none!important; border-top:1px solid rgba(100,116,139,0.2)!important;',
    '  padding:10px 14px!important; overflow-y:auto!important;',
    '  -webkit-overflow-scrolling:touch!important;',
    '}',
    '/* 底部操作栏 — 固定 50px，粘性定位 */',
    'body.force-mobile .ai-gen-preview-overlay > div:first-child > div:last-child {',
    '  flex:0 0 auto!important;',
    '  height:50px!important;',
    '  position:sticky!important; bottom:0!important; left:0!important; right:0!important;',
    '  width:100%!important; border-radius:0!important;',
    '  backdrop-filter:blur(12px)!important;',
    '  z-index:10!important; background:rgba(15,23,42,0.98)!important;',
    '  padding:0 12px!important;',
    '}',

    /* 提示词管理弹窗移动端适配 */
    'body.force-mobile #admin-root > div[class*="fixed"] { align-items:flex-start!important; overflow-y:auto!important; padding:20px 0!important; -webkit-overflow-scrolling:touch!important; }',
    'body.force-mobile #admin-root > div[class*="fixed"] > div[class*="relative"] { margin:0!important; max-height:calc(100vh - 40px)!important; overflow:visible!important; }',
    'body.force-mobile #admin-root > div[class*="fixed"] [class*="rounded-2xl"] { overflow:visible!important; }',
  ].join('\n');
  document.head.appendChild(css);
  document.body.classList.add('force-mobile');
  document.documentElement.classList.add('force-mobile');

  var BAR_H = 56;
  var overlay;

  /* ===== DOM 就绪 ===== */
  var wait = setInterval(function () {
    var root = document.querySelector('#root > div');
    if (!root || root.children.length < 2) return;
    clearInterval(wait);
    setTimeout(init, 300);
  }, 200);

  function init() {
    var shell = document.querySelector('#root > div');
    var mobLeft = shell.children[0];
    var mobMain = shell.children[1];
    var mobRight = shell.children[2];

    if (!mobLeft.id) mobLeft.id = 'mob-left';
    if (!mobMain.id) mobMain.id = 'mob-main';
    if (!mobRight.id) mobRight.id = 'mob-right';

    hideOnReact(mobLeft);
    hideOnReact(mobRight);

    createTopbar();
    createOverlay();
    addCloseButtons(mobRight);
    cleanLeftDrawer(mobLeft);
    listenHistoryClick(mobLeft);
  }

  /* ===== 防止 React 重新渲染显示抽屉 ===== */
  var activeDrawer = null;
  function hideOnReact(el) {
    new MutationObserver(function () {
      if (!activeDrawer || activeDrawer !== el.id) {
        el.style.display = 'none';
        el.classList.remove('mob-open');
      }
    }).observe(el, { attributes: true, attributeFilter: ['style'] });
  }

  /* ===== 顶部栏 ===== */
  function createTopbar() {
    if (document.getElementById('mobile-topbar')) return;
    var bar = document.createElement('div');
    bar.id = 'mobile-topbar';
    bar.style.cssText = 'display:flex!important;position:fixed!important;top:0!important;left:0!important;right:0!important;height:'+BAR_H+'px!important;align-items:center!important;z-index:3000!important;background:#0d1117!important;border-bottom:1px solid #1e293b!important;padding:0 12px!important;box-sizing:border-box!important;flex-shrink:0!important;min-height:'+BAR_H+'px!important;max-height:'+BAR_H+'px!important;';
    bar.innerHTML = '<div style="display:flex;align-items:center;gap:4px;flex:1;flex-shrink:0"><button id="mob-btn-l" style="background:none;border:none;color:#e2e8f0;font-size:22px;padding:8px;cursor:pointer;line-height:1">☰</button></div><div style="flex:0 0 auto;text-align:center;font-weight:600;font-size:15px;color:#e2e8f0;line-height:1;white-space:nowrap">⚡ 镜头演算室 <span id="mob-ver" style="font-size:11px;font-weight:400;color:#64748b;margin-left:4px">v' + (window.__version__ || "1.0.4") + '</span></div><div style="display:flex;align-items:center;gap:4px;flex:1;flex-shrink:0;justify-content:flex-end"><button id="mob-btn-upload" style="display:flex;background:none;border:none;color:#94a3b8;font-size:18px;padding:8px;cursor:pointer;line-height:1;align-items:center" title="导入图片">📤</button><button id="mob-btn-admin" style="display:flex;background:none;border:none;color:#94a3b8;font-size:18px;padding:8px;cursor:pointer;line-height:1;align-items:center" title="后台管理">⚙️</button><button id="mob-btn-r" style="display:none;background:none;border:none;color:#e2e8f0;font-size:18px;padding:8px;cursor:pointer;line-height:1">📊</button></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('mob-btn-l').onclick = function () { toggleDrawer('left'); };
    document.getElementById('mob-btn-r').onclick = function () { toggleDrawer('right'); };
    document.getElementById('mob-btn-admin').onclick = function () {
      var adminBtn = document.querySelector('#mob-left [title="后台管理"]');
      if (adminBtn) { adminBtn.click(); return; }
      var allBtns = document.querySelectorAll('[title="后台管理"]');
      for (var i = 0; i < allBtns.length; i++) {
        if (allBtns[i].id !== 'mob-btn-admin') {
          allBtns[i].click(); break;
        }
      }
    };
    document.getElementById('mob-btn-upload').onclick = function () {
      var fileInput = document.querySelector('#mob-left input[type="file"]');
      if (fileInput) fileInput.click();
    };
  }

  /* ===== 遮罩 ===== */
  function createOverlay() {
    if (document.getElementById('mob-overlay')) return;
    overlay = document.createElement('div');
    overlay.id = 'mob-overlay';
    overlay.onclick = closeAll;
    document.body.appendChild(overlay);
  }

  /* ===== 关闭按钮（仅右侧抽屉） ===== */
  function addCloseButtons(right) {
    var el = document.createElement('div');
    el.className = 'mob-close-btn';
    el.textContent = '✕ 关闭';
    el.onclick = closeAll;
    right.insertBefore(el, right.firstChild);
  }

  /* ===== 清理左侧抽屉内容 ===== */
  function cleanLeftDrawer(leftPanel) {
    var histLabel = document.createElement('div');
    histLabel.id = 'mob-hist-label';
    histLabel.textContent = '历史记录';
    leftPanel.insertBefore(histLabel, leftPanel.firstChild);
  }

  /* ===== 历史记录点击 ===== */
  function listenHistoryClick(leftPanel) {
    leftPanel.addEventListener('click', function (e) {
      if (e.target.closest('.mob-close-btn')) return;
      /* 只拦截侧边栏级别的按钮，不拦截历史记录项内的按钮 */
      if (e.target.closest('button') && !e.target.closest('.group')) return;
      /* 多选模式下不关闭抽屉（检测"退出"按钮是否存在） */
      var btns = leftPanel.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === '退出') return;
      }
      setTimeout(closeAll, 150);
    });
  }

  /* ===== 抽屉切换 ===== */
  function toggleDrawer(side) {
    closeAll();
    var el = document.getElementById('mob-' + side);
    if (!el) return;
    activeDrawer = el.id;
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    requestAnimationFrame(function () {
      el.classList.add('mob-open');
      document.body.classList.add('mob-open-' + side);
    });
    var ov = document.getElementById('mob-overlay');
    if (ov) ov.style.display = 'block';
  }

  function closeAll() {
    activeDrawer = null;
    ['left', 'right'].forEach(function (s) {
      var el = document.getElementById('mob-' + s);
      if (!el) return;
      el.classList.remove('mob-open');
      el.style.display = 'none';
    });
    document.body.classList.remove('mob-open-left', 'mob-open-right');
    if (overlay) overlay.style.display = 'none';
  }

  /* ===== 📊 按钮显隐 ===== */
  /* ===== 提示词面板（右侧抽屉隐藏时的卡片展示） ===== */
  var promptCardStyle = document.createElement('style');
  promptCardStyle.id = 'mobile-prompt-card';
  promptCardStyle.textContent = [
    '/* 移动端右侧抽屉提示词卡片 */',
    'body.force-mobile .mob-prompt-card {',
    '  background:rgba(30,41,59,0.9); border-radius:12px; padding:12px;',
    '  border:1px solid rgba(100,116,139,0.2); margin:8px;',
    '}',
    'body.force-mobile .mob-prompt-card-title {',
    '  font-size:11px; color:#64748b; margin-bottom:6px; text-transform:uppercase;',
    '  letter-spacing:0.05em; font-weight:600;',
    '}',
    'body.force-mobile .mob-prompt-card-content {',
    '  color:#94a3b8; font-size:12px; line-height:1.6; word-break:break-word;',
    '}',
  ].join('\n');
  document.head.appendChild(promptCardStyle);
  var checkRight = setInterval(function () {
    var right = document.getElementById('mob-right');
    if (!right) return;
    clearInterval(checkRight);
    new MutationObserver(function () {
      var btn = document.getElementById('mob-btn-r');
      if (!btn) return;
      btn.style.display = getComputedStyle(right).display === 'none' ? 'none' : 'flex';
    }).observe(right, { attributes: true, attributeFilter: ['style'] });
  }, 200);
})();