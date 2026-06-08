// ========== 后台管理面板 ==========
function AdminPanel({ onClose }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loading, setLoading] = useState(false);
  
  // 账号
  const [curUsername, setCurUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accMsg, setAccMsg] = useState('');
  const [accErr, setAccErr] = useState('');
  
  // AI 文字模型
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiHasSaved, setAiHasSaved] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiSaveMsg, setAiSaveMsg] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState('');
  const [aiTested, setAiTested] = useState(false);
  
  // AI 图片模型
  const [imgEnabled, setImgEnabled] = useState(false);
  const [imgHasSaved, setImgHasSaved] = useState(false);
  const [imgApiKey, setImgApiKey] = useState('');
  const [imgBaseUrl, setImgBaseUrl] = useState('');
  const [imgModel, setImgModel] = useState('');
  const [imgSaveMsg, setImgSaveMsg] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [imgTestMsg, setImgTestMsg] = useState('');
  const [imgTested, setImgTested] = useState(false);
  
  // 版本
  const [currentVer, setCurrentVer] = useState('...');
  const [latestVer, setLatestVer] = useState(null);
  const [verStatus, setVerStatus] = useState('loading');
  const [changelog, setChangelog] = useState([]);
  const [verErr, setVerErr] = useState('');
  const [verPage, setVerPage] = useState(1);
  const [verDetail, setVerDetail] = useState(null);
  const VER_PER_PAGE = 5;
  
  const apiCall = async (path, opts = {}) => {
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      localStorage.removeItem('admin_token');
      setToken('');
      setLoggedIn(false);
      throw new Error('未授权');
    }
    return res;
  };
  
  const checkLogin = async () => {
    if (!token) { setLoggedIn(false); return; }
    try {
      const res = await apiCall('/api/auth/check');
      if (res.ok) {
        const data = await res.json();
        setLoggedIn(true);
        setCurUsername(data.username || '');
        setActiveTab('ai');
      } else {
        setLoggedIn(false);
      }
    } catch (e) {
      setLoggedIn(false);
    }
  };
  
  useEffect(() => { checkLogin(); }, []);

  // 阻止浏览器左滑/返回关闭面板
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPop = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state === null) {
        window.history.back();
      }
    };
  }, []);
  
  const doLogin = async () => {
    setLoginErr(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setLoginErr(data.detail || '登录失败'); return; }
      localStorage.setItem('admin_token', data.token);
      setToken(data.token);
      setLoggedIn(true);
      setActiveTab('ai');
      setCurUsername(data.username || '');
    } catch (e) {
      setLoginErr('网络错误: ' + e.message);
    } finally {
      setLoading(false);
    }
  };
  
  const doLogout = () => {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
    localStorage.removeItem('admin_token');
    setToken(''); setLoggedIn(false); setActiveTab('login');
  };

  // ---- 账号 ----
  const changeUsername = async () => {
    setAccErr(''); setAccMsg('');
    if (!newUsername) { setAccErr('请输入新用户名'); return; }
    if (!curPassword) { setAccErr('请输入当前密码验证身份'); return; }
    try {
      const res = await apiCall('/api/settings/change-username', {
        method: 'POST',
        body: JSON.stringify({ new_username: newUsername, password: curPassword }),
      });
      if (res.ok) {
        setAccMsg('用户名修改成功，刷新后生效');
        setCurUsername(newUsername);
        setNewUsername('');
      } else {
        const d = await res.json();
        setAccErr(d.detail || '修改失败');
      }
    } catch (e) {
      setAccErr('网络错误: ' + e.message);
    }
  };

  const changePassword = async () => {
    setAccErr(''); setAccMsg('');
    if (!curPassword) { setAccErr('请输入当前密码'); return; }
    if (!newPassword || newPassword.length < 4) { setAccErr('新密码至少4位'); return; }
    try {
      const res = await apiCall('/api/settings/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: curPassword, new_password: newPassword }),
      });
      if (res.ok) {
        setAccMsg('密码修改成功');
        setNewPassword('');
        setCurPassword('');
      } else {
        const d = await res.json();
        setAccErr(d.detail || '修改失败');
      }
    } catch (e) {
      setAccErr('网络错误: ' + e.message);
    }
  };
  
  // ---- 开关切换（独立于保存按钮） ----
  const toggleAiEnabled = async () => {
    const newEnabled = !aiEnabled;
    if (newEnabled && (!aiBaseUrl || !aiModel || !aiHasSaved)) {
      setAiTestMsg('❌ 无法开启：请先配置并保存 API Key、Base URL 和 Model');
      setTimeout(() => setAiTestMsg(''), 4000);
      return;
    }
    setAiEnabled(newEnabled);
    try {
      const res = await apiCall('/api/settings/ai', {
        method: 'POST',
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!res.ok) throw new Error('保存失败');
      setAiTestMsg(newEnabled ? '✓ AI 已启用' : '✓ AI 已禁用');
      setTimeout(() => setAiTestMsg(''), 3000);
    } catch (e) {
      setAiEnabled(!newEnabled);
      setAiTestMsg('✕ 操作失败: ' + e.message);
      setTimeout(() => setAiTestMsg(''), 4000);
    }
  };

  const toggleImgEnabled = async () => {
    const newEnabled = !imgEnabled;
    if (newEnabled && (!imgBaseUrl || !imgModel || !imgHasSaved)) {
      setImgTestMsg('❌ 无法开启：请先配置并保存 API Key、Base URL 和 Model');
      setTimeout(() => setImgTestMsg(''), 4000);
      return;
    }
    setImgEnabled(newEnabled);
    try {
      const res = await apiCall('/api/settings/ai/image', {
        method: 'POST',
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!res.ok) throw new Error('保存失败');
      setImgTestMsg(newEnabled ? '✓ 图片模型已启用' : '✓ 图片模型已禁用');
      setTimeout(() => setImgTestMsg(''), 3000);
    } catch (e) {
      setImgEnabled(!newEnabled);
      setImgTestMsg('✕ 操作失败: ' + e.message);
      setTimeout(() => setImgTestMsg(''), 4000);
    }
  };

  // ---- AI 文字模型 ----
  const loadAiConfig = async () => {
    try {
      const res = await apiCall('/api/settings/ai');
      if (res.ok) {
        const data = await res.json();
        setAiEnabled(data.enabled || false);
        setAiHasSaved(data.has_saved || !!data.api_key_masked);
        setAiApiKey('');
        setAiBaseUrl(data.base_url || '');
        setAiModel(data.model || '');
        setAiTested(false);
      }
    } catch (e) { console.error(e); }
  };
  
  const saveAiConfig = async () => {
    setAiSaveMsg(''); setAiLoading(true);
    try {
      const res = await apiCall('/api/settings/ai', {
        method: 'POST',
        body: JSON.stringify({
          enabled: aiEnabled,
          api_key: aiApiKey || undefined,
          base_url: aiBaseUrl,
          model: aiModel,
        }),
      });
      if (res.ok) {
        setAiHasSaved(true);
        setAiSaveMsg('已保存');
        setAiTested(false);
        setAiApiKey('');
        setTimeout(() => setAiSaveMsg(''), 2000);
      } else {
        const data = await res.json();
        setAiSaveMsg('保存失败: ' + (data.detail || '未知错误'));
      }
    } catch (e) {
      setAiSaveMsg('网络错误: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  };
  
  const testAiApi = async () => {
    setAiTestMsg('测试中...'); setAiTested(false);
    try {
      const res = await apiCall('/api/settings/ai/test', {
        method: 'POST',
        body: JSON.stringify({
          api_key: aiApiKey || undefined,
          base_url: aiBaseUrl,
          model: aiModel,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAiTestMsg('✓ ' + (data.message || '连接成功'));
        setAiTested(true);
      } else {
        setAiTestMsg('✗ ' + (data.message || '连接失败'));
        setAiTested(false);
      }
      setTimeout(() => setAiTestMsg(''), 4000);
    } catch (e) {
      setAiTestMsg('✗ 网络错误');
      setAiTested(false);
      setTimeout(() => setAiTestMsg(''), 3000);
    }
  };
  
  // ---- AI 图片模型 ----
  const loadImgConfig = async () => {
    try {
      const res = await apiCall('/api/settings/ai/image');
      if (res.ok) {
        const data = await res.json();
        setImgEnabled(data.enabled || false);
        setImgHasSaved(data.has_saved || !!data.api_key_masked);
        setImgApiKey('');
        setImgBaseUrl(data.base_url || '');
        setImgModel(data.model || '');
        setImgTested(false);
      }
    } catch (e) { console.error(e); }
  };
  
  const saveImgConfig = async () => {
    setImgSaveMsg(''); setImgLoading(true);
    try {
      const res = await apiCall('/api/settings/ai/image', {
        method: 'POST',
        body: JSON.stringify({
          enabled: imgEnabled,
          api_key: imgApiKey || undefined,
          base_url: imgBaseUrl,
          model: imgModel,
        }),
      });
      if (res.ok) {
        setImgHasSaved(true);
        setImgSaveMsg('已保存');
        setImgTested(false);
        setImgApiKey('');
        setTimeout(() => setImgSaveMsg(''), 2000);
      } else {
        const data = await res.json();
        setImgSaveMsg('保存失败: ' + (data.detail || '未知错误'));
      }
    } catch (e) {
      setImgSaveMsg('网络错误: ' + e.message);
    } finally {
      setImgLoading(false);
    }
  };
  
  const testImgApi = async () => {
    setImgTestMsg('测试中...'); setImgTested(false);
    try {
      const res = await apiCall('/api/settings/ai/image/test', {
        method: 'POST',
        body: JSON.stringify({
          api_key: imgApiKey || undefined,
          base_url: imgBaseUrl,
          model: imgModel,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setImgTestMsg('✓ ' + (data.message || '连接成功'));
        setImgTested(true);
      } else {
        setImgTestMsg('✗ ' + (data.message || '连接失败'));
        setImgTested(false);
      }
      setTimeout(() => setImgTestMsg(''), 4000);
    } catch (e) {
      setImgTestMsg('✗ 网络错误');
      setImgTested(false);
      setTimeout(() => setImgTestMsg(''), 3000);
    }
  };
  
  // ---- 版本 ----
  const loadVersions = async () => {
    setVerStatus('loading'); setVerErr(''); setVerPage(1); // Bug 修复：重置页码
    try {
      const res = await apiCall('/api/versions');
      if (res.ok) {
        const data = await res.json();
        // current 可能是对象或字符串
        const cv = data.current;
        setCurrentVer(typeof cv === 'object' ? (cv.version || '...') : (cv || '...'));
        setChangelog(data.changelog || []);
      }
      const checkRes = await apiCall('/api/versions/check');
      if (checkRes.ok) {
        const data = await checkRes.json();
        setLatestVer(data);
        // 如果没有 update_available 字段，根据 has_local_record 判断
        if (data.update_available) {
          setVerStatus('available');
        } else {
          setVerStatus('latest');
        }
      } else {
        setVerStatus('latest');
      }
    } catch (e) {
      setVerStatus('latest');
      setVerErr(e.message);
    }
  };
  
  useEffect(() => {
    if (loggedIn) {
      if (activeTab === 'ai') { loadAiConfig(); loadImgConfig(); }
      if (activeTab === 'version') loadVersions();
    }
  }, [activeTab, loggedIn]);
  
  if (!loggedIn) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-[#0d1117] border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl relative">
          <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-white">⚙️ 后台管理</h2>
            <p className="text-xs text-slate-500 mt-1">请输入管理员账号密码</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">用户名</label>
              <input value={username} onChange={e => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">密码</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none" />
            </div>
            {loginErr && <p className="text-xs text-red-400">{loginErr}</p>}
            <button onClick={doLogin} disabled={loading}
              className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all disabled:opacity-50">
              {loading ? '登录中...' : '登录'}
            </button>
            <button onClick={onClose}
              className="w-full py-2 bg-slate-800 text-slate-400 rounded-lg text-sm hover:bg-slate-700 transition-all">取消</button>
          </div>
        </div>
      </div>
    );
  }
  
  // 通用 AI 模型配置渲染
  const renderAiModelSection = (title, icon, config) => {
    const { hasSaved, apiKey, setApiKey, baseUrl, setBaseUrl, model, setModel, saveMsg, loadingSave, tested, testMsg, onTest, onSave, onToggle, enabled, saveLabel } = config;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">启用 {title}</span>
          <button onClick={onToggle}
            className={'relative w-11 h-6 rounded-full transition-all ' + (enabled ? 'bg-blue-500' : 'bg-slate-600')}>
            <span className={'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ' + (enabled ? 'left-5' : 'left-0.5')} />
          </button>
        </div>
        {/* 配置状态 */}
        <div className={'flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ' + (hasSaved ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-500')}>
          <span className={'w-2 h-2 rounded-full ' + (hasSaved ? 'bg-green-400' : 'bg-slate-500')}></span>
          {hasSaved ? 'API Key 已配置' : 'API Key 未配置'}
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">API Key</label>
          <input type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); setTested(false); }}
            placeholder={hasSaved ? '留空则保持已保存的 Key 不变' : 'sk-...'}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">接口地址 (Base URL)</label>
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">模型名称</label>
          <input value={model} onChange={e => setModel(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-blue-500 outline-none" />
        </div>
        <div className="flex gap-2">
          <button onClick={onTest}
            className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition-all">
            测试连接
          </button>
          <button onClick={onSave} disabled={loadingSave || !tested}
            className="flex-1 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            {loadingSave ? '保存中...' : saveLabel || '保存配置'}
          </button>
        </div>
        {testMsg && <p className={'text-xs ' + (testMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{testMsg}</p>}
        {saveMsg && <p className={'text-xs ' + (saveMsg.startsWith('已保存') ? 'text-green-400' : 'text-red-400')}>{saveMsg}</p>}
        {!tested && !testMsg && <p className="text-[10px] text-slate-600">请先测试连接，测试成功后才能保存</p>}
      </div>
    );
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-[#0d1117] border border-slate-700 rounded-2xl w-[520px] max-h-[85vh] overflow-hidden shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white">⚙️ 后台管理</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">已登录: {curUsername}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={doLogout} className="text-xs text-slate-500 hover:text-red-400 transition-colors">退出</button>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="flex border-b border-slate-800">
          {['ai', 'account', 'version'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={'flex-1 py-3 text-xs font-medium transition-colors ' +
                (activeTab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300')}>
              {t === 'ai' ? 'AI 模型' : t === 'account' ? '账号' : '版本'}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {activeTab === 'ai' && (
            <div>
              {/* 文字模型 */}
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
                <h3 className="text-sm text-slate-300 font-medium">文字模型（AI 分析）</h3>
              </div>
              {renderAiModelSection('文字分析', 'AI', {
                hasSaved: aiHasSaved, apiKey: aiApiKey, setApiKey: setAiApiKey,
                baseUrl: aiBaseUrl, setBaseUrl: setAiBaseUrl, model: aiModel, setModel: setAiModel,
                saveMsg: aiSaveMsg, loadingSave: aiLoading, tested: aiTested, testMsg: aiTestMsg,
                onTest: testAiApi, onSave: saveAiConfig, onToggle: toggleAiEnabled, enabled: aiEnabled,
                saveLabel: '保存文字模型配置',
              })}
              
              {/* 分隔线 + 图片模型 */}
              <div className="border-t border-slate-700/50 pt-4 mt-5 mb-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  <h3 className="text-sm text-slate-300 font-medium">图片模型（AI 生图）</h3>
                </div>
              </div>
              {renderAiModelSection('图片生成', 'AI', {
                hasSaved: imgHasSaved, apiKey: imgApiKey, setApiKey: setImgApiKey,
                baseUrl: imgBaseUrl, setBaseUrl: setImgBaseUrl, model: imgModel, setModel: setImgModel,
                saveMsg: imgSaveMsg, loadingSave: imgLoading, tested: imgTested, testMsg: imgTestMsg,
                onTest: testImgApi, onSave: saveImgConfig, onToggle: toggleImgEnabled, enabled: imgEnabled,
                saveLabel: '保存图片模型配置',
              })}
            </div>
          )}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm text-slate-300 font-medium mb-3">修改用户名</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">当前用户名</label>
                    <input value={curUsername} disabled
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">新用户名</label>
                    <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">密码验证</label>
                    <input type="password" value={curPassword} onChange={e => setCurPassword(e.target.value)}
                      placeholder="请输入当前密码以验证身份"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  {accErr && <p className="text-xs text-red-400">{accErr}</p>}
                  {accMsg && <p className="text-xs text-green-400">{accMsg}</p>}
                  <button onClick={changeUsername}
                    className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">更新用户名</button>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-6">
                <h3 className="text-sm text-slate-300 font-medium mb-3">修改密码</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">当前密码</label>
                    <input type="password" value={curPassword} onChange={e => setCurPassword(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">新密码</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <button onClick={changePassword}
                    className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-all">更新密码</button>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'version' && (
            <div className="space-y-4">
              <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/50">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">当前版本</div>
                <div className="text-xl font-bold mono text-white">v{currentVer}</div>
              </div>
              {verStatus === 'loading' && (
                <div className="rounded-xl p-3 text-xs text-slate-400 bg-slate-800/20">检查更新中...</div>
              )}
              {verStatus === 'latest' && (
                <div className="rounded-xl p-3 text-xs text-green-400 bg-green-500/10 border border-green-500/20">✓ 已是最新版本</div>
              )}
              {verStatus === 'available' && latestVer && (
                <div className="rounded-xl p-3 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20">
                  ⚠ 发现新版本 v{latestVer.latest_version || latestVer.version || '?'}，请执行升级命令
                </div>
              )}
              {changelog.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">更新日志</div>
                  <div className="space-y-2">
                    {changelog
                      .slice()
                      .sort((a, b) => {
                        const va = a.version.split('.').map(Number);
                        const vb = b.version.split('.').map(Number);
                        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
                          const d = (vb[i] || 0) - (va[i] || 0);
                          if (d !== 0) return d;
                        }
                        return 0;
                      })
                      .slice((verPage - 1) * VER_PER_PAGE, verPage * VER_PER_PAGE)
                      .map((entry) => (
                      <div key={entry.version} className="bg-slate-800/20 rounded-lg p-3 border border-slate-700/30">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-bold text-slate-300 mono cursor-pointer underline decoration-dotted underline-offset-2 hover:text-blue-400 transition-colors"
                            onClick={() => setVerDetail(entry)}
                          >v{entry.version}</span>
                          {entry.version === currentVer && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">当前</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{entry.date}</div>
                        <div className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{entry.notes || entry.changelog || ''}</div>
                      </div>
                    ))}
                  </div>
                  {changelog.length > VER_PER_PAGE && (
                    <div className="flex items-center justify-center gap-2 mt-3">
                      {verPage > 1 && (
                        <button
                          className="text-xs text-slate-400 bg-slate-800/30 hover:bg-slate-700/40 px-2.5 py-1 rounded"
                          onClick={() => setVerPage(verPage - 1)}
                        >上一页</button>
                      )}
                      <span className="text-xs text-slate-500">{verPage} / {Math.ceil(changelog.length / VER_PER_PAGE)}</span>
                      {verPage * VER_PER_PAGE < changelog.length && (
                        <button
                          className="text-xs text-slate-400 bg-slate-800/30 hover:bg-slate-700/40 px-2.5 py-1 rounded"
                          onClick={() => setVerPage(verPage + 1)}
                        >下一页</button>
                      )}
                    </div>
                  )}
                  {verDetail && (
                    <div
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                      onClick={() => setVerDetail(null)}
                    >
                      <div
                        className="bg-slate-800 rounded-xl p-5 max-w-md w-full mx-4 border border-slate-600/50 shadow-2xl max-h-[80vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <span className="text-base font-bold text-white mono">v{verDetail.version}</span>
                            <span className="text-xs text-slate-400 ml-2">{verDetail.date}</span>
                            {verDetail.version === currentVer && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded ml-2">当前</span>}
                          </div>
                          <button
                            className="text-slate-400 hover:text-white text-lg leading-none transition-colors"
                            onClick={() => setVerDetail(null)}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                        <div className="text-xs text-slate-300 mb-4 bg-slate-700/30 rounded-lg p-3">
                          {verDetail.notes || verDetail.changelog || ''}
                        </div>
                        {verDetail.detail && verDetail.detail.sections ? (
                          <div className="space-y-3">
                            {verDetail.detail.sections.map((sec, si) => (
                              <div key={si}>
                                <div className={
                                  sec.type === 'added' ? 'text-xs font-bold text-emerald-400 mb-1.5' :
                                  sec.type === 'changed' ? 'text-xs font-bold text-amber-400 mb-1.5' :
                                  sec.type === 'fixed' ? 'text-xs font-bold text-blue-400 mb-1.5' :
                                  sec.type === 'removed' ? 'text-xs font-bold text-red-400 mb-1.5' :
                                  'text-xs font-bold text-slate-400 mb-1.5'
                                }>
                                  {sec.type === 'added' ? '\ud83d\udfe2 新增' :
                                   sec.type === 'changed' ? '\ud83d\udfe1 优化' :
                                   sec.type === 'fixed' ? '\ud83d\udfe5 修复' :
                                   sec.type === 'removed' ? '\ud83d\udfe4 移除' :
                                   sec.type}
                                </div>
                                <ul className="space-y-1">
                                  {sec.items.map((item, ii) => (
                                    <li key={ii} className="text-xs text-slate-400 pl-3 flex items-start gap-1.5">
                                      <span className="text-slate-400 mr-1.5">{ii + 1}.</span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 italic">暂无详细更新内容</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="bg-slate-800/20 rounded-xl p-3 border border-slate-700/30">
                <div className="text-[10px] text-slate-500 mb-1">升级方式</div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  在服务器上执行以下命令更新：<br/>
                  <code className="text-blue-400 bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                    docker compose pull &amp;&amp; docker compose up -d
                  </code>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
