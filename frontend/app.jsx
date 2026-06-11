const { useState, useRef, useEffect, useCallback } = React;

// 全局动画样式（注入一次）
if (!document.getElementById('ai-gen-styles')) {
  const style = document.createElement('style');
  style.id = 'ai-gen-styles';
  style.textContent = `
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes fadeSlideIn {
      from { opacity: 0; transform: translateY(8px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes fadeScaleIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes fullScreenSlideIn {
      0% { opacity: 0; transform: translateY(-30px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes dropZoneHide {
      0% { opacity: 1; transform: translateY(0) scale(1); height: auto; }
      99% { opacity: 0; transform: translateY(10px) scale(0.98); height: 0; padding: 0; margin: 0; }
      100% { opacity: 0; transform: translateY(10px) scale(0.98); height: 0; padding: 0; margin: 0; display: none; }
    }
    @keyframes gridReveal {
      0% { opacity: 0; transform: translateY(20px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

  `;
  document.head.appendChild(style);
}

const API_BASE = window.location.origin;

// ========== 工具函数 ==========
const evColor = (ev) => {
  if (ev >= 2) return '#ef4444';      // 严重过曝 - 红
  if (ev >= 1) return '#f97316';      // 过曝 - 橙
  if (ev >= 0.5) return '#eab308';    // 轻微过曝 - 黄
  if (ev > -0.5) return '#22c55e';    // 正常 - 绿
  if (ev > -1) return '#06b6d4';      // 轻微欠曝 - 青
  if (ev > -2) return '#3b82f6';      // 欠曝 - 蓝
  return '#8b5cf6';                    // 严重欠曝 - 紫
};

const evBgClass = (ev) => {
  if (ev >= 1) return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (ev >= 0.5) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (ev > -0.5) return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (ev > -1) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
  return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
};

// ========== 组件 ==========

// 测光点叠加层
function MeteringOverlay({ points, width, height, imageWidth, imageHeight, visible }) {
  if (!points || !visible) return null;
  
  const scaleX = imageWidth / width;
  const scaleY = imageHeight / height;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {points.map((p, i) => {
        const left = (p.cx / width) * imageWidth;
        const top = (p.cy / height) * imageHeight;
        const color = evColor(p.ev);
        
        return (
          <div
            key={i}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 metering-dot"
            style={{ left, top, color }}
          >
            {/* 十字线 */}
            <div className="absolute w-4 h-[1px] bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute w-[1px] h-4 bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
            
            {/* 标签 */}
            <div 
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap flex flex-col items-center gap-0.5"
              style={{ top: 18 }}
            >
              <span className="text-[10px] font-medium text-white/80 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm">
                {p.name}
              </span>
              <span 
                className="text-xs font-bold mono px-1.5 py-0.5 rounded backdrop-blur-sm border"
                style={{ 
                  backgroundColor: `${color}33`, 
                  color: color,
                  borderColor: `${color}55`
                }}
              >
                {p.ev_display} EV
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 直方图
function Histogram({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  
  return (
    <div className="flex items-end gap-[1px] h-16">
      {data.map((v, i) => (
        <div
          key={i}
          className="histogram-bar flex-1 rounded-t-sm"
          style={{
            height: `${(v / max) * 100}%`,
            backgroundColor: `hsl(${(i / 32) * 270}, 60%, 55%)`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

// 区域模式选择器
function ModeSelector({ modes, current, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => { if (!disabled) onChange(current === m.key ? null : m.key); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            disabled
              ? 'bg-slate-800/30 text-slate-600 border border-slate-700/30 cursor-not-allowed'
              : current === m.key
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:border-slate-600'
          }`}
        >
          {m.name}
          <span className="ml-1 text-xs opacity-60">{m.rows}×{m.cols}</span>
        </button>
      ))}
    </div>
  );
}

// 文件历史项
function HistoryItem({ item, onSelect, onDelete, active, multiSelect, isSelected, onToggle }) {
  return (
    <div 
      className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${
        multiSelect && isSelected ? 'bg-blue-500/15 border border-blue-400/30' :
        !multiSelect && active ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-slate-800/50 border border-transparent'
      }`}
      onClick={() => multiSelect ? onToggle(item.file_id) : onSelect(item)}
    >
      {/* 多选复选框 */}
      {multiSelect && (
        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-500'
        }`}
          onClick={(e) => { e.stopPropagation(); onToggle(item.file_id); }}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      <div className="w-10 h-10 rounded bg-slate-800 overflow-hidden flex-shrink-0">
        <img 
          src={`${API_BASE}/${item.original}`} 
          className="w-full h-full object-cover"
          alt=""
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-300 truncate">{item.filename}</div>
        <div className="text-[10px] text-slate-500">
          {new Date(item.timestamp).toLocaleString('zh-CN')}
        </div>
      </div>
      {!multiSelect && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.file_id); }}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// 主应用
function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(null);
  const [modes, setModes] = useState([]);
  const [history, setHistory] = useState([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 });
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const textInputRef = useRef(null);
  const containerRef = useRef(null);
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0 });
  const [showAdmin, setShowAdmin] = useState(false);
  const toggleAdmin = () => setShowAdmin(v => !v);
  const imgRef = useRef(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiImageEnabled, setAiImageEnabled] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiImageSaved, setAiImageSaved] = useState(false);
  const [activeFileId, setActiveFileId] = useState(null);
  const [batchStatus, setBatchStatus] = useState({ inProgress: false, total: 0, processed: 0 });
  // AI 生图状态
  const [aiGenActive, setAiGenActive] = useState(false);
  const [genTaskId, setGenTaskId] = useState(null);
  const [genResultsMap, setGenResultsMap] = useState({}); // {fileId: images[]}
  const [genImages, setGenImages] = useState([]); // 当前显示的结果
  const [genProgress, setGenProgress] = useState(0);
  const [genTotal, setGenTotal] = useState(9);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genFileId, setGenFileId] = useState(null); // 正在生成的文件ID
  const [promptTemplates, setPromptTemplates] = useState([]);
  const [customPrompts, setCustomPrompts] = useState([]); // [{name, content, order}]
  const [selectedPromptNames, setSelectedPromptNames] = useState([]);
  const [showAiGenPanel, setShowAiGenPanel] = useState(false);
  const [selectedStyleName, setSelectedStyleName] = useState(null); // 全局风格（单选，可反选）
  const [similarImages, setSimilarImages] = useState(false);
  const [customPromptEnabled, setCustomPromptEnabled] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  // 比例和分辨率选择
  const [selectedRatio, setSelectedRatio] = useState('4:3');
  const [selectedOrientation, setSelectedOrientation] = useState('landscape'); // landscape | portrait
  const [selectedSize, setSelectedSize] = useState('1024x768');
  // 比例-分辨率映射
  const ratioSizeMap = {
    '1:1': ['512x512', '1024x1024'],
    '4:3': ['768x576', '1024x768', '1536x1152'],
    '3:4': ['576x768', '768x1024', '1152x1536'],
    '16:9': ['1024x576', '1792x1024'],
    '9:16': ['576x1024', '1024x1792'],
  };
  // 文字生图
  const [textPrompt, setTextPrompt] = useState('');
  const [textGenLoading, setTextGenLoading] = useState(false);
  const [textGenImages, setTextGenImages] = useState([]);
  const [textGenProgress, setTextGenProgress] = useState(0);
  const [isTextGenMode, setIsTextGenMode] = useState(true);
  const [textGenError, setTextGenError] = useState(null);
  const [textGenTotal, setTextGenTotal] = useState(9);
  const [textGenTaskId, setTextGenTaskId] = useState('');

  const genTimerRef = useRef(null);
  const aiAdviceRef = useRef(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState(new Set());

  // 自定义提示词
  const loadPrompts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/prompts`);
      const data = await res.json();
      if (data.ok) setPromptTemplates(data.prompts);
    } catch (e) { /* ignore */ }
  };

  const savePrompt = async (name, content, type, editId) => {
    if (!name.trim() || !content.trim()) return;
    const fd = new FormData();
    fd.append('id', editId || '');
    fd.append('name', name.trim());
    fd.append('content', content.trim());
    fd.append('type', type);
    await fetch(`${API_BASE}/api/prompts`, { method: 'POST', body: fd });
    await loadPrompts();
  };

  const deletePrompt = async (id) => {
    await fetch(`${API_BASE}/api/prompts/${id}`, { method: 'DELETE' });
    await loadPrompts();
  };

  // 加载模式列表、历史和提示模板
  useEffect(() => {
    fetch(`${API_BASE}/api/grid-modes`).then(r => r.json()).then(d => setModes(d.modes));
    fetch(`${API_BASE}/api/history`).then(r => r.json()).then(d => setHistory(d.items));
    fetch(`${API_BASE}/api/settings/ai`).then(r => r.json()).then(d => {
      setAiEnabled(d.enabled); setAiImageEnabled(d.image_enabled);
      setAiSaved(d.has_saved); setAiImageSaved(d.image_has_saved);
    }).catch(() => {});
    loadPrompts();
  }, []);

  // 组件卸载时清除轮询定时器
  useEffect(() => {
    return () => {
      if (genTimerRef.current) {
        clearInterval(genTimerRef.current);
        genTimerRef.current = null;
      }
    };
  }, []);

  // 模式切换时自动重新分析（历史文件中）
  useEffect(() => {
    if (activeFileId && !loading) {
      const doReanalyze = async () => {
        setLoading(true);
        const fd = new FormData();
        fd.append('file_id', activeFileId);
        fd.append('mode', mode);
        fd.append('ev_method', 'standard');
        try {
          const res = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: fd });
          const data = await res.json();
          setResult(data);
          const h = await fetch(`${API_BASE}/api/history`).then(r => r.json());
          setHistory(h.items);
        } catch (err) {
          console.error('自动重分析失败:', err.message);
        }
        setLoading(false);
      };
      doReanalyze();
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 批量处理文件
  const handleFiles = async (fileList) => {
    setIsTextGenMode(false);
    if (genFileId) { alert('AI 生成中，请等待完成或取消后再上传'); return; }
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['jpg','jpeg','png'].includes(ext);
    });
    if (files.length === 0) return;

    setBatchStatus({ inProgress: true, total: files.length, processed: 0 });

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        if (i === 0) {
          // 第一张：设置预览
          setFile(f);
          setActiveFileId(null);
          const reader = new FileReader();
          await new Promise((resolve, reject) => {
            reader.onload = (e) => {
              setPreview(e.target.result);
              setResult(null);
              resolve();
            };
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
        }
        // 分析当前文件
        await analyze(f);
      } catch (e) {
        console.error('处理失败:', f.name, e);
      }
      setBatchStatus(prev => ({ ...prev, processed: i + 1 }));
    }

    // 清空 input 以便重复选择
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    setBatchStatus({ inProgress: false, total: 0, processed: 0 });
  };

  // 拖拽（支持多文件）
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // 分析
  const analyze = async (forceFile = null) => {
    const useFile = forceFile || file;
    if (!useFile && !activeFileId) return;
    setLoading(true);
    const fd = new FormData();
    if (activeFileId && !useFile) {
      // 重新分析历史文件
      fd.append('file_id', activeFileId);
    } else {
      fd.append('file', useFile);
    }
    fd.append('mode', mode);
    fd.append('ev_method', 'standard');
    
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: fd });
      const data = await res.json();
      setResult(data);
      setActiveFileId(data.file_id);
      setGenResultsMap(prev => ({ ...prev, [data.file_id]: null }));
      setGenImages([]);
      // 刷新历史
      const h = await fetch(`${API_BASE}/api/history`).then(r => r.json());
      setHistory(h.items);
    } catch (err) {
      alert('分析失败: ' + err.message);
    }
    setLoading(false);
  };

  // 文字生图
  const handleTextGenerate = async () => {
    if (!textPrompt.trim()) return;
    setTextGenLoading(true);
    setTextGenError(null);
    setTextGenImages([]);
    setTextGenProgress(0);
    setTextGenTotal(9);
    try {
      const fd = new FormData();
      fd.append('text', textPrompt.trim());
      fd.append('similar', String(true));
      fd.append('num_images', '9');
      fd.append('size', selectedSize);
      if (selectedStyleName) {
        const tpl = promptTemplates.find(t => t.name === selectedStyleName);
        if (tpl) {
          fd.append('global_style', JSON.stringify({ name: tpl.name, content: tpl.content }));
        }
      }
      if (customPrompts.length > 0) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({ name: p.name, content: p.content }))));
      }
      const res = await fetch(`${API_BASE}/api/generate/text-image`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok && data.task_id) {
        setTextGenTaskId(data.task_id);
        pollTextGeneration(data.task_id);
      } else {
        setTextGenError(data.error || '启动失败');
        setTextGenLoading(false);
      }
    } catch (err) {
      setTextGenError('网络错误');
      setTextGenLoading(false);
    }
  };

  // 轮询文字生图任务
  const pollTextGeneration = (taskId) => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/generate/task/${taskId}`);
        const data = await res.json();
        if (!data.ok || !data.task) {
          setTextGenError('任务不存在');
          setTextGenLoading(false);
          return;
        }
        const t = data.task;
        setTextGenImages(t.images || []);
        setTextGenProgress(t.progress || 0);
        setTextGenTotal(t.total || 9);
        if (t.status === 'done') {
          clearInterval(genTimerRef.current);
          setTextGenLoading(false);
        } else if (t.status === 'failed' || t.status === 'cancelled') {
          clearInterval(genTimerRef.current);
          setTextGenLoading(false);
          setTextGenError(t.error || '生成取消');
        } else {
          // 轮询中
        }
      } catch {
        clearInterval(genTimerRef.current);
        setTextGenLoading(false);
        setTextGenError('轮询失败');
      }
    };
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    genTimerRef.current = setInterval(poll, 2000);
    poll();
  };

  // 停止文字生图
  const handleCancelTextGen = async () => {
    if (!textGenTaskId) return;
    try {
      const fd = new FormData();
      fd.append('task_id', textGenTaskId);
      await fetch(`${API_BASE}/api/generate/cancel`, { method: 'POST', body: fd });
    } catch {}
    clearInterval(genTimerRef.current);
    setTextGenLoading(false);
    setTextGenError('已手动停止');
  };

  // AI 生图
  const startGeneration = async (fileId, options = {}) => {
    const { similarImages = false, selectedStyleName = null } = options;
    const similar = similarImages;

    // === 自定义提示词模式 ===
    if (customPromptEnabled && customPromptText.trim()) {
      if (genTimerRef.current) clearInterval(genTimerRef.current);
      setGenLoading(true);
      setGenError(null);
      setGenImages([]);
      setGenProgress(0);
      setGenTotal(1);
      setAiGenActive(true);
      setGenFileId(fileId);
      try {
        const fd = new FormData();
        fd.append('file_id', fileId);
        fd.append('custom_prompt', customPromptText.trim());
        fd.append('size', selectedSize);
        const res = await fetch(`${API_BASE}/api/generate/custom-prompt`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.ok && data.task_id) {
          setGenTaskId(data.task_id);
          pollGeneration(data.task_id, fileId);
        } else {
          setGenError(data.error || '启动失败');
          setGenLoading(false);
          setGenFileId(null);
        }
      } catch (err) {
        setGenError('网络错误');
        setGenLoading(false);
        setGenFileId(null);
      }
      return;
    }

    // 🔴 先计算 numImages，再 set state
    const promptCount = customPrompts.length;
    const hasGlobal = !!selectedStyleName;
    let numImages;
    if (similar) {
      numImages = 9; // 无限想象 → 始终9张
    } else if (hasGlobal && promptCount === 0) {
      numImages = 1; // 只选全局风格 → 1张占满9格
    } else if (promptCount > 0) {
      numImages = promptCount; // 有提示词 → N张
    } else {
      numImages = 9; // 什么都不选 → 9张不同默认风格
    }
    // 清除旧轮询
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    setGenLoading(true);
    setGenError(null);
    setGenImages([]);
    setGenProgress(0);
    setGenTotal(numImages);
    setAiGenActive(true);
    setGenFileId(fileId);
    try {
      const fd = new FormData();
      fd.append('file_id', fileId);
      fd.append('num_images', String(numImages));
      fd.append('size', selectedSize);
      if (selectedStyleName) {
        const tpl = promptTemplates.find(p => p.name === selectedStyleName);
        if (tpl) {
          fd.append('global_style', JSON.stringify({ name: tpl.name, content: tpl.content }));
        }
      }
      // 无限想象模式：始终传递 custom_prompts_json（即使空数组），后端优先用提示词
      if (similar) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({name: p.name, content: p.content}))));
      } else if (customPrompts.length > 0) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({name: p.name, content: p.content}))));
      }
      fd.append('similar', String(similar));
      const res = await fetch(`${API_BASE}/api/generate/similar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok && data.task_id) {
        setGenTaskId(data.task_id);
        pollGeneration(data.task_id, fileId);
      } else {
        setGenError(data.error || '启动失败');
        setGenLoading(false);
        setGenFileId(null);
      }
    } catch (err) {
      setGenError('网络错误');
      setGenLoading(false);
      setGenFileId(null);
    }
  };

  const cancelGeneration = async () => {
    if (!genTaskId) return;
    try {
      await fetch(`${API_BASE}/api/generate/cancel`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('task_id', genTaskId); return fd; })() });
    } catch (e) { /* ignore */ }
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    genTimerRef.current = null;
    setGenLoading(false);
    setGenFileId(null);
    setGenTotal(9);
    setGenError('已取消');
    setCustomPromptEnabled(false);
    setCustomPromptText('');
    setCustomPrompts([]);
    setSelectedPromptNames([]);
    if (genFileId) {
      setGenResultsMap(prev => ({ ...prev, [genFileId]: null }));
    }
  };

  // 轮询生图进度
  const pollGeneration = (taskId, fileId) => {
    genTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/generate/task/${taskId}`);
        const data = await res.json();
        if (data.ok && data.task) {
          setGenProgress(data.task.progress);
          setGenTotal(data.task.total || 9);
          const imgs = data.task.images || [];
          setGenImages(imgs);
          setGenResultsMap(prev => ({ ...prev, [fileId]: imgs }));
          if (data.task.status === 'done' || data.task.status === 'failed' || data.task.status === 'cancelled') {
            if (genTimerRef.current) clearInterval(genTimerRef.current);
            genTimerRef.current = null;
            setGenLoading(false);
            setGenFileId(null);
            setCustomPromptEnabled(false);
            setCustomPromptText('');
            setCustomPrompts([]);
            setSelectedPromptNames([]);
            if (data.task.status === 'failed') {
              setGenError(data.task.error || '生成失败');
            }
            if (data.task.status === 'cancelled') {
              setGenError('已取消');
            }
          }
        } else {
          if (genTimerRef.current) clearInterval(genTimerRef.current);
          genTimerRef.current = null;
          setGenError(data.error || '任务已过期');
          setGenLoading(false);
        }
      } catch (err) {
        if (genTimerRef.current) clearInterval(genTimerRef.current);
        genTimerRef.current = null;
        setGenError('网络错误');
        setGenLoading(false);
      }
    }, 1500);
  };

  // 选择历史（单击）
  // 将 AI 生成的图片添加到历史记录
  const handleAddToHistory = async (imageUrl) => {
    try {
      const fd = new FormData();
      fd.append('image_url', imageUrl);
      const res = await fetch(`${API_BASE}/api/history/from-generated`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        // 刷新历史列表
        const h = await fetch(`${API_BASE}/api/history`).then(r => r.json());
        setHistory(h.items);
        return data.file_id;
      } else {
        console.error('添加到历史失败:', data.error);
        return null;
      }
    } catch (e) {
      console.error('添加到历史失败:', e);
      return null;
    }
  };

  const selectHistory = async (item) => {
    // 多选模式下：切换选中状态，不预览
    if (multiSelect) {
      toggleHistorySelect(item.file_id);
      return;
    }

    // 单选模式：预览文件
    if (genFileId && genFileId !== item.file_id) {
      alert('AI 生成中，请等待完成或取消后再选择其他图片');
      return;
    }
    try {
      setActiveFileId(item.file_id);
      setFile(null); // 清除新文件状态，用历史文件
      const data = await fetch(`${API_BASE}/api/result/${item.file_id}`).then(r => r.json());
      setResult(data);
      setPreview(`${API_BASE}/${item.original}`);
      setMode(null);
      setGenImages([]);
      setShowOverlay(true);
      setIsTextGenMode(false);
    } catch (err) {
      alert('加载失败');
    }
  };

  // 删除历史
  const deleteHistory = async (fileId) => {
    await fetch(`${API_BASE}/api/history/${fileId}`, { method: 'DELETE' });
    const h = await fetch(`${API_BASE}/api/history`).then(r => r.json());
    setHistory(h.items);
    if (activeFileId === fileId) {
      setActiveFileId(null);
      setResult(null);
      setPreview(null);
      setIsTextGenMode(false);
      setFile(null);
      setGenImages([]);
    }
    setGenResultsMap(prev => { const m = { ...prev }; delete m[fileId]; return m; });
    // 同时从多选集合中移除
    if (selectedHistory.has(fileId)) {
      selectedHistory.delete(fileId);
      setSelectedHistory(new Set(selectedHistory));
    }
  };

  // 多选相关
  const toggleHistorySelect = (fileId) => {
    const newSelect = new Set(selectedHistory);
    if (newSelect.has(fileId)) newSelect.delete(fileId);
    else newSelect.add(fileId);
    setSelectedHistory(newSelect);
  };

  const clearMultiSelect = () => {
    setMultiSelect(false);
    setSelectedHistory(new Set());
  };

  const deleteSelectedHistory = async () => {
    const ids = Array.from(selectedHistory);
    if (ids.length === 0) return;
    if (!confirm(`确定删除 ${ids.length} 个历史记录吗？`)) return;
    for (const id of ids) {
      await fetch(`${API_BASE}/api/history/${id}`, { method: 'DELETE' });
    }
    // 刷新历史
    const h = await fetch(`${API_BASE}/api/history`).then(r => r.json());
    setHistory(h.items);
    // 清理状态
    setSelectedHistory(new Set());
    setMultiSelect(false);
    if (ids.includes(activeFileId)) {
      setActiveFileId(null);
      setResult(null);
      setPreview(null);
      setIsTextGenMode(false);
      setFile(null);
    }
  };

  // 图片加载后获取实际显示尺寸
  const onImageLoad = () => {
    if (imgRef.current) {
      setImageDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 左侧栏 - 文件管理 */}
      <div className="w-64 bg-[#0d1117] border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-lg font-bold text-white tracking-tight">
            <span className="text-blue-400">⚡</span> 镜头演算室
          </h1>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500 mt-0.5">LensLab v{__version__}</p>
            <button onClick={toggleAdmin} className="text-slate-500 hover:text-blue-400 transition-colors" title="后台管理">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
          </div>
        </div>

        {/* 上传区域 */}
        <div className="p-3">
          {/* 多文件上传 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {/* 文件夹上传 */}
          <input
            ref={folderInputRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="space-y-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-500/20 transition-all"
            >
              + 导入图片
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="w-full py-2.5 bg-slate-700/10 text-slate-300 border border-slate-700/30 rounded-lg text-sm hover:bg-slate-700/20 transition-all"
            >
              📁 导入文件夹
            </button>
          </div>
          {/* 批量进度 */}
          {batchStatus.inProgress && (
            <div className="mt-2 text-xs text-slate-400 text-center">
              处理中 {batchStatus.processed}/{batchStatus.total}
            </div>
          )}
        </div>

        {/* 历史列表 */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {/* 历史记录标题 + 多选工具栏 */}
          <div className="flex items-center justify-between px-3 mt-2 mb-1">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">历史记录</div>
            {!multiSelect ? (
              <button
                onClick={() => setMultiSelect(true)}
                className="text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
              >
                批量选择
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const allIds = new Set(history.map(h => h.file_id));
                    setSelectedHistory(allIds);
                  }}
                  className="text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
                >
                  全选
                </button>
                <button
                  onClick={() => setSelectedHistory(new Set())}
                  className="text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
                >
                  不全选
                </button>
                <span className="text-[10px] text-slate-600">|</span>
                <button
                  onClick={deleteSelectedHistory}
                  className={`text-[10px] transition-colors ${selectedHistory.size > 0 ? 'text-red-400 hover:text-red-300' : 'text-slate-600 cursor-not-allowed'}`}
                >
                  删除选中{selectedHistory.size > 0 ? `(${selectedHistory.size})` : ''}
                </button>
                <button
                  onClick={clearMultiSelect}
                  className="text-[10px] text-slate-500 hover:text-slate-300 ml-1"
                >
                  退出
                </button>
              </div>
            )}
          </div>
          {history.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-8">暂无记录</div>
          ) : (
            history.slice().reverse().map(item => (
              <HistoryItem
                key={item.file_id}
                item={item}
                onSelect={selectHistory}
                onDelete={deleteHistory}
                active={result?.file_id === item.file_id}
                multiSelect={multiSelect}
                isSelected={selectedHistory.has(item.file_id)}
                onToggle={toggleHistorySelect}
              />
            ))
          )}
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="h-14 bg-[#0d1117] border-b border-slate-800 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">区域模式</span>
            <ModeSelector modes={modes} current={mode} onChange={setMode} disabled={isTextGenMode} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
              />
              显示测光点
            </label>
            {/* AI 操作按钮 */}
            {aiEnabled && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (!isTextGenMode) aiAdviceRef.current?.(); }}
                  disabled={isTextGenMode}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                    isTextGenMode
                      ? 'bg-slate-800/30 border-slate-700/30 text-slate-600 cursor-not-allowed'
                      : 'bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20 border border-slate-600/50 hover:border-blue-500/40 text-slate-200 hover:text-blue-300'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                  </svg>
                  AI 分析
                </button>
                {aiImageEnabled && (
                <button
                  onClick={() => {
                    setIsTextGenMode(true);
                    // 退出预览模式（如果正在查看历史图片）
                    setPreview(null);
                    // 等待 DOM 更新后滚动
                    setTimeout(() => {
                      if (textGenImages.length > 0) {
                        // 生成过：滚动到九宫格区域
                        const gridEl = document.querySelector('[data-ai-gen-grid]');
                        if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      } else {
                        // 没生成过：聚焦文字输入框
                        if (textInputRef && textInputRef.current) {
                          textInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setTimeout(() => textInputRef.current.focus(), 500);
                        }
                      }
                    }, 100);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
                    bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20
                    border border-slate-600/50 hover:border-blue-500/40
                    text-slate-200 hover:text-blue-300 transition-all duration-200"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  AI 文生图
                </button>
                )}
                {genLoading && (
                  <button onClick={cancelGeneration}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-br from-red-500/20 to-red-600/30 border border-red-500/40 text-red-300 hover:from-red-500/30 hover:to-red-600/40 transition-all">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    取消
                  </button>
                )}

                {selectedPromptNames.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1 flex-wrap">
                    {selectedPromptNames.map((name, i) => (
                      <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-purple-500/10 border border-purple-500/20 text-purple-300">
                        <span className="text-purple-500 font-mono">{i + 1}</span>
                        {name}
                        <button onClick={() => {
                          const newNames = selectedPromptNames.filter((_, j) => j !== i);
                          const newPrompts = customPrompts.filter((_, j) => j !== i);
                          setSelectedPromptNames(newNames);
                          setCustomPrompts(newPrompts);
                        }} className="ml-0.5 hover:text-red-300 transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                      </span>
                    ))}
                    {selectedPromptNames.length < 9 && (
                      <span className="text-[9px] text-slate-500">+{9 - selectedPromptNames.length}默认</span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { if (!isTextGenMode) { loadPrompts(); setShowAiGenPanel(true); } }}
                  disabled={genLoading || showAiGenPanel || isTextGenMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                    bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20
                    border border-slate-600/50 hover:border-blue-500/40
                    text-slate-200 hover:text-blue-300"
                >
                  {genLoading ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-br from-red-500/20 to-red-600/30 border border-red-500/40 text-red-300">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      生成中 {genProgress > 0 ? `${genProgress}/${genTotal}` : ''}
                    </div>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>AI 生图</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 图片预览区 */}
        <div className={`${preview ? 'flex-1 overflow-auto flex items-center justify-center p-8' : 'flex-1 flex flex-col px-8 pt-8 pb-0 min-h-0 overflow-hidden'} bg-[#080b12]`}>
          {!preview ? (
            <>
              {/* 主区域：有结果显示九宫格，无结果显示上传区 */}
              <div className="flex-1 flex flex-col  min-h-0 w-full">
                {(textGenLoading || textGenImages.length > 0) ? (
                  <div data-ai-gen-grid className="w-full flex-1 min-h-0">
                    <AiGenGrid
                      images={textGenImages}
                      progress={textGenProgress}
                      loading={textGenLoading}
                      error={textGenError}
                      total={textGenTotal}
                      progressPct={textGenTotal > 0 ? Math.round((textGenProgress / textGenTotal) * 100) : 0}
                      onAddToHistory={handleAddToHistory}
                    />
                  </div>
                ) : (
                  <div className="w-full max-w-4xl flex-1 flex items-center justify-center">
                    <div
                      className={`drop-zone w-full h-full rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ease-out ${
                        dragOver ? 'drag-over' : ''
                      }`}
                      style={{ minHeight: '200px' }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <svg className="w-12 h-12 text-slate-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="text-slate-400 text-sm">拖拽图片到此处，或点击选择</p>
                      <p className="text-slate-600 text-xs mt-2">JPG / PNG</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 比例和分辨率 - 文生图快捷面板 */}
              <div className="flex-shrink-0 w-full px-4 pt-3" style={{ background: '#080b12' }}>
                <div className="w-full max-w-4xl">
                  {/* 比例 + 方向 + 分辨率 — 单行排列 */}
                  <div className="flex items-center gap-1.5">
                    {/* 比例 */}
                    <div className="flex gap-1">
                      {['1:1', '4:3', '16:9'].map(r => (
                        <button
                          key={r}
                          onClick={() => { setSelectedRatio(r); setSelectedSize(ratioSizeMap[r][0]); }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${
                            selectedRatio === r
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                              : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    {/* 横竖方向（仅4:3） */}
                    {selectedRatio === '4:3' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setSelectedOrientation('landscape'); setSelectedSize('1024x768'); }}
                          className={`px-1.5 py-0.5 rounded text-[10px] transition-all border ${
                            selectedOrientation === 'landscape'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                              : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'
                          }`}
                        >
                          横
                        </button>
                        <button
                          onClick={() => { setSelectedOrientation('portrait'); setSelectedSize('768x1024'); }}
                          className={`px-1.5 py-0.5 rounded text-[10px] transition-all border ${
                            selectedOrientation === 'portrait'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                              : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'
                          }`}
                        >
                          竖
                        </button>
                      </div>
                    )}
                    {/* 分辨率下拉 - 固定宽度 */}
                    <select
                      value={selectedSize}
                      onChange={e => setSelectedSize(e.target.value)}
                      className="w-[110px] px-2 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/50 text-slate-300 outline-none focus:border-blue-500/40 transition-all shrink-0"
                    >
                      {ratioSizeMap[selectedRatio].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 文字输入框 - 始终在下方 */}
              <div className="flex-shrink-0 w-full flex items-center justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)', background: '#080b12' }}>
                <div className="w-full max-w-4xl">
                  <div className="flex items-center gap-2 bg-[#0d1117] border border-slate-700/60 rounded-xl px-3 py-2.5 focus-within:border-blue-500/50 transition-colors">
                    <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    <input
                      ref={textInputRef}
                      type="text"
                      value={textPrompt}
                      onChange={(e) => setTextPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && textPrompt.trim()) handleTextGenerate(); }}
                      placeholder="输入文字描述，直接生成九宫格..."
                      className="flex-1 bg-transparent text-slate-200 text-sm placeholder-slate-600 outline-none"
                    />
                    <button
                      onClick={handleTextGenerate}
                      disabled={!textPrompt.trim() || textGenLoading}
                      className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                        disabled:opacity-40 disabled:cursor-not-allowed
                        bg-gradient-to-br from-blue-500/20 to-purple-500/20
                        hover:from-blue-500/30 hover:to-purple-500/30
                        border border-blue-500/30 hover:border-blue-400/50
                        text-blue-300 hover:text-blue-200"
                    >
                      {textGenLoading ? (
                        <span className="flex items-center gap-1">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          生成中
                        </span>
                      ) : `生成${genTotal || 9}张`}
                    </button>
                    {textGenLoading && (
                      <button
                        onClick={handleCancelTextGen}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                          bg-red-500/15 hover:bg-red-500/25
                          border border-red-500/30 hover:border-red-400/50
                          text-red-400 hover:text-red-300"
                      >
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                          停止
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>

          ) : (
            <div className="flex items-center gap-6 transition-all duration-500 ease-out min-w-0" style={{ height: '100%' }}>
              {/* 原始图片 — 左侧 */}
              <div className="min-w-0 flex-1 overflow-hidden flex items-center justify-center" style={{ minHeight: 0 }}>
                <div className="image-container relative">
                  <img
                    ref={imgRef}
                    src={preview}
                    alt="preview"
                    onLoad={onImageLoad}
                    className="rounded-lg shadow-2xl max-h-[70vh] max-w-full object-contain"
                  />
                  <MeteringOverlay
                    points={result?.metering_points}
                    width={result?.width}
                    height={result?.height}
                    imageWidth={imageDims.w}
                    imageHeight={imageDims.h}
                    visible={showOverlay && result && mode}
                  />
                </div>
              </div>

              {/* AI 生成结果网格 — 右侧 */}
              {(genLoading || genImages.length > 0) && (
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  <AiGenGrid
                    images={genImages}
                    progress={genProgress}
                    loading={genLoading}
                    error={genError}
                    total={genTotal}
                    progressPct={genProgress > 0 ? Math.round((genProgress / genTotal) * 100) : 0}
                    onAddToHistory={handleAddToHistory}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右侧栏 - 分析结果 */}
      <div style={{ display: isTextGenMode ? "none" : "flex" }} className="w-72 bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-300">分析结果</h2>
        </div>

        {!result ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-slate-600">导入图片后点击分析</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 整体信息 */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">整体曝光</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold mono" style={{ color: evColor((result.avg_brightness - 128) / 45) }}>
                  {((result.avg_brightness - 128) / 45).toFixed(1)}
                </span>
                <span className="text-xs text-slate-500">EV</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                平均亮度: {result.avg_brightness} / 255
              </div>
            </div>

            {/* 直方图 */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">亮度直方图</div>
              <Histogram data={result.histogram} />
              <div className="flex justify-between text-[9px] text-slate-600 mt-1">
                <span>暗部</span>
                <span>中间调</span>
                <span>高光</span>
              </div>
            </div>

            {/* 测光点列表 */}
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                区域测光 · {result.mode_name}
              </div>
              <div className="space-y-1.5">
                {result.metering_points.map((p, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border ${evBgClass(p.ev)}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] opacity-60 mono">{p.brightness}</span>
                      <span className="text-sm font-bold mono">{p.ev_display}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 曝光评估 */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">曝光评估</div>
              <ExposureAdvice result={result} />
            </div>

            {/* AI 智能建议（手动触发） */}
            {aiEnabled && (
              <AiAdvice fileId={result.file_id} onRequest={aiAdviceRef} />
            )}


          </div>
        )}
      </div>

      {showAdmin && ReactDOM.createPortal(<AdminPanel onClose={() => setShowAdmin(false)} />, document.getElementById('admin-root'))}
      {showAiGenPanel && ReactDOM.createPortal(<AiGenPanel
        prompts={promptTemplates}
        customPrompts={customPrompts} setCustomPrompts={setCustomPrompts}
        selectedPromptNames={selectedPromptNames} setSelectedPromptNames={setSelectedPromptNames}
        selectedStyleName={selectedStyleName} setSelectedStyleName={setSelectedStyleName}
        similarImages={similarImages} setSimilarImages={setSimilarImages}
        customPromptEnabled={customPromptEnabled} setCustomPromptEnabled={setCustomPromptEnabled}
        customPromptText={customPromptText} setCustomPromptText={setCustomPromptText}
        genLoading={genLoading}
        result={result}
        selectedRatio={selectedRatio} setSelectedRatio={setSelectedRatio}
        selectedOrientation={selectedOrientation} setSelectedOrientation={setSelectedOrientation}
        selectedSize={selectedSize} setSelectedSize={setSelectedSize}
        ratioSizeMap={ratioSizeMap}
        onGenerate={() => {
          if (!result) { alert("请先导入并分析图片"); return; }
          const fid = result.file_id;
          if (customPromptEnabled && !customPromptText.trim()) { alert("请输入自定义提示词"); return; }
          setShowAiGenPanel(false);
          setTimeout(() => {
            if (customPromptEnabled) {
              startGeneration(fid, { customPrompt: true });
            } else {
              startGeneration(fid, { similarImages, selectedStyleName });
            }
          }, 100);
        }}
        onRefreshPrompts={loadPrompts}
        onDeletePrompt={deletePrompt}
        onSavePrompt={savePrompt}
        onClose={() => { setShowAiGenPanel(false); setCustomPromptEnabled(false); setCustomPromptText(''); }}
        textModelEnabled={aiEnabled}
      />, document.getElementById('admin-root'))}
    </div>
  );
}

// 曝光建议（基础规则）
function ExposureAdvice({ result }) {
  const avg = (result.avg_brightness - 128) / 45;
  const maxEv = Math.max(...result.metering_points.map(p => p.ev));
  const minEv = Math.min(...result.metering_points.map(p => p.ev));
  const range = maxEv - minEv;

  let advice = [];
  if (avg > 1) advice.push({ text: '整体偏亮，建议降低曝光补偿', color: 'text-orange-400' });
  else if (avg < -1) advice.push({ text: '整体偏暗，建议增加曝光补偿', color: 'text-blue-400' });
  else advice.push({ text: '整体曝光正常', color: 'text-green-400' });

  if (range > 3) advice.push({ text: '光比过大，建议使用HDR或补光', color: 'text-yellow-400' });
  else if (range > 2) advice.push({ text: '光比适中，注意高光细节', color: 'text-cyan-400' });

  if (maxEv >= 2.5) advice.push({ text: '存在过曝区域，注意高光溢出', color: 'text-red-400' });
  if (minEv <= -2.5) advice.push({ text: '存在死黑区域，暗部细节丢失', color: 'text-purple-400' });

  return (
    <div className="space-y-1.5">
      {advice.map((a, i) => (
        <div key={i} className={`text-xs ${a.color}`}>• {a.text}</div>
      ))}
    </div>
  );
}

// AI 生图设置面板
// AI 生图设置面板（内嵌模板管理）
function AiGenPanel({ prompts, customPrompts, setCustomPrompts, selectedPromptNames, setSelectedPromptNames, selectedStyleName, setSelectedStyleName, similarImages, setSimilarImages, customPromptEnabled, setCustomPromptEnabled, customPromptText, setCustomPromptText, genLoading, onGenerate, result, onRefreshPrompts, onSavePrompt, onDeletePrompt, onClose, textModelEnabled, selectedRatio, setSelectedRatio, selectedOrientation, setSelectedOrientation, selectedSize, setSelectedSize, ratioSizeMap }) {
  const promptList = (prompts || []).filter(p => (p.type || 'prompt') === 'prompt');
  const styleList = (prompts || []).filter(p => (p.type || 'prompt') === 'style');

  // 模板管理状态：null = 选择模式，'prompt' | 'style' = 管理模式
  const [manageTab, setManageTab] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editContent, setEditContent] = React.useState('');
  const [editId, setEditId] = React.useState(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const togglePrompt = (p) => {
    if (selectedPromptNames.includes(p.name)) {
      setSelectedPromptNames(selectedPromptNames.filter(n => n !== p.name));
      setCustomPrompts(customPrompts.filter(cp => cp.name !== p.name));
    } else if (customPrompts.length < 9) {
      setSelectedPromptNames([...selectedPromptNames, p.name]);
      setCustomPrompts([...customPrompts, { name: p.name, content: p.content, order: customPrompts.length }]);
    }
  };

  // 阻止左滑返回
  React.useEffect(() => {
    const onPop = () => { window.history.pushState(null, '', window.location.href); };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); };
  }, []);

  const preventClose = (e) => { e.preventDefault(); e.stopPropagation(); };

  // --- 管理模式：CRUD 处理器 ---
  const startEdit = (item) => {
    setEditName(item.name);
    setEditContent(item.content);
    setEditId(item.id);
    setIsCreating(true);
  };
  const startNew = () => {
    setEditName('');
    setEditContent('');
    setEditId(null);
    setIsCreating(true);
  };
  const handleSave = () => {
    if (!editName.trim() || !editContent.trim()) return;
    onSavePrompt(editName, editContent, manageTab, editId || '');
    setEditName('');
    setEditContent('');
    setEditId(null);
    setIsCreating(false);
    onRefreshPrompts();
  };
  const handleDelete = (id) => {
    if (!confirm('确定删除此模板？解除锁定需要重新打开设置面板')) return;
    onDeletePrompt(id);
    onRefreshPrompts();
  };

  const currentItems = manageTab === 'prompt' ? promptList : styleList;

  // ==================== 管理视图 ====================
  if (manageTab) {
    return ReactDOM.createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" tabIndex={-1} onClick={preventClose}>
        <div className="w-[520px] min-w-[360px] max-w-[95vw] max-h-[85vh] rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-2xl shadow-black/50 flex flex-col" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/60">
            <div className="flex items-center gap-3">
              <button onClick={() => { setManageTab(null); startNew(); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{manageTab === 'prompt' ? '🎯 提示词管理' : '🎨 全局风格管理'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500">{currentItems.length}</span>
              </div>
            </div>
            <button onClick={() => { setManageTab(null); setIsCreating(false); setEditName(''); setEditContent(''); setEditId(null); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* 列表 */}
            {currentItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                <div className="text-2xl mb-2">📭</div>
                <div className="text-[11px]">暂无{manageTab === 'prompt' ? '提示词' : '全局风格'}模板</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {currentItems.map(item => (
                  <div key={item.id}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all group ${
                      editId === item.id
                        ? 'bg-blue-500/10 border-blue-500/30'
                        : 'bg-slate-800/40 border-slate-700/30 hover:border-slate-600/50'
                    }`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{item.name}</div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.content.slice(0, 50)}{item.content.length > 50 ? '…' : ''}</div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(item)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-300 hover:bg-blue-500/10 transition-all" title="编辑">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                      </button>
                      <button onClick={() => handleDelete(item.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-all" title="删除">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 编辑/新建表单 — 有内容时显示 */}
            {editName !== '' || editContent !== '' || editId !== null || isCreating ? (
              <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-300">{editId ? '编辑模板' : '新建模板'}</span>
                  {editId && (
                    <button onClick={() => { setEditId(null); setEditName(''); setEditContent(''); setIsCreating(false); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">取消编辑</button>
                  )}
                </div>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="模板名称"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40" />
                <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                  placeholder={manageTab === 'prompt' ? '输入提示词内容…' : '输入全局风格描述…'}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 resize-none" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEditId(null); setEditName(''); setEditContent(''); setIsCreating(false); }}
                    className="px-3 py-1.5 rounded-lg text-[10px] bg-slate-700/40 hover:bg-slate-700/60 text-slate-400 transition-all">取消</button>
                  <button onClick={handleSave}
                    disabled={!editName.trim() || !editContent.trim()}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed">
                    {editId ? '保存修改' : '创建'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* 底部新建按钮 */}
          <div className="px-4 py-3 border-t border-slate-800/60">
            <button onClick={startNew}
              className="w-full py-2.5 rounded-xl text-xs font-medium bg-slate-800/70 hover:bg-slate-700/80 border border-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              新建{manageTab === 'prompt' ? '提示词' : '全局风格'}
            </button>
          </div>
        </div>
      </div>,
      document.getElementById('admin-root')
    );
  }

  // ==================== 选择视图 ====================
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" tabIndex={-1} onClick={preventClose}>
      <div className="relative w-[520px] max-w-[95vw] rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-wide">AI 生图设置</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">选择模板 · 调整风格 · 一键生成</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent mx-6" />

          {/* 提示词选择区 */}
          <div className={`px-6 pt-4 pb-3 transition-all duration-300 ${customPromptEnabled ? 'opacity-30 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-400">提示词</span>
                <button onClick={() => setManageTab('prompt')}
                  className="w-5 h-5 rounded-md flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/80 transition-all"
                  title="管理提示词模板">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </button>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">
                {selectedPromptNames.length > 0 ? (
                  <span className="text-emerald-400">已选 {selectedPromptNames.length}/9</span>
                ) : (
                  <span>未选择</span>
                )}
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mb-3 leading-relaxed">动作、表情、神态、天气等，与全局风格内容冲突时以全局为主</p>
            {promptList.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {promptList.map(p => {
                  const idx = selectedPromptNames.indexOf(p.name);
                  const isSelected = idx !== -1;
                  return (
                    <button key={p.id} onClick={() => togglePrompt(p)}
                      disabled={customPromptEnabled || (!isSelected && customPrompts.length >= 9)}
                      className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                          : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'
                      } ${(!isSelected && customPrompts.length >= 9) || customPromptEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      {isSelected && (
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-[8px] font-bold text-white shadow shadow-emerald-500/40">{idx + 1}</span>
                      )}
                      {p.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <button onClick={() => setManageTab('prompt')}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800/40 border border-dashed border-slate-700/40 hover:border-slate-600/60 text-[11px] text-slate-500 hover:text-slate-300 transition-all w-full justify-center">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                暂无提示词，点击创建
              </button>
            )}
            {selectedPromptNames.length > 0 && selectedPromptNames.length < 9 && (
              <div className="mt-2 text-[10px] text-slate-600">
                剩余 {9 - selectedPromptNames.length} 个位置将使用默认风格自动填充
              </div>
            )}
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6" />

          {/* 全局风格选择区 */}
          <div className={`px-6 py-4 transition-all duration-300 ${customPromptEnabled ? 'opacity-30 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-400">全局风格</span>
                <button onClick={() => setManageTab('style')}
                  className="w-5 h-5 rounded-md flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/80 transition-all"
                  title="管理全局风格">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </button>
              </div>
              <span className="text-[10px] text-slate-600 font-mono">
                {selectedStyleName ? (
                  <span className="text-violet-400">已选择</span>
                ) : (
                  <span>未选择（9图不同风格）</span>
                )}
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mb-3 leading-relaxed">选择一个风格应用到所有生成的图片，点击已选可取消</p>
            {styleList.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {styleList.map(p => {
                  const isSelected = selectedStyleName === p.name;
                  return (
                    <button key={p.id} onClick={() => setSelectedStyleName(isSelected ? null : p.name)}
                      disabled={customPromptEnabled}
                      className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${
                        isSelected
                          ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-lg shadow-violet-500/10'
                          : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'
                      } ${customPromptEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      {isSelected && (
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-[8px] font-bold text-white shadow shadow-violet-500/40">✓</span>
                      )}
                      {p.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <button onClick={() => setManageTab('style')}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800/40 border border-dashed border-slate-700/40 hover:border-slate-600/60 text-[11px] text-slate-500 hover:text-slate-300 transition-all w-full justify-center">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                暂无全局风格，点击创建
              </button>
            )}
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6" />

          {/* 比例和分辨率选择 — 单行排列 */}
          <div className="px-6 py-4">
            <span className="text-[11px] font-medium text-slate-400 mb-3 block">比例和分辨率</span>
            <div className="flex items-center gap-3 flex-wrap">
              {/* 比例 */}
              <div className="flex gap-1.5">
                {['1:1', '4:3', '16:9'].map(r => (
                  <button
                    key={r}
                    onClick={() => { setSelectedRatio(r); setSelectedSize(ratioSizeMap[r][0]); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${
                      selectedRatio === r
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {/* 方向（仅4:3） */}
              {selectedRatio === '4:3' && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setSelectedOrientation('landscape'); setSelectedSize('1024x768'); }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${
                      selectedOrientation === 'landscape'
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    横
                  </button>
                  <button
                    onClick={() => { setSelectedOrientation('portrait'); setSelectedSize('768x1024'); }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${
                      selectedOrientation === 'portrait'
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    竖
                  </button>
                </div>
              )}
              {/* 分辨率下拉 - 固定宽度 */}
              <select
                value={selectedSize}
                onChange={e => setSelectedSize(e.target.value)}
                className="w-[130px] px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-800/60 border border-slate-700/50 text-slate-200 outline-none focus:border-blue-500/40 transition-all shrink-0"
              >
                {ratioSizeMap[selectedRatio].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6" />

          {/* 生成选项 - 自定义开启时禁用 */}
          <div className="px-6 py-4">
            <span className="text-[11px] font-medium text-slate-400 mb-3 block">生成选项</span>
            <label title={!textModelEnabled ? '需要先开启文字模型（AI 分析）' : ''} className={`flex items-center gap-5 px-4 py-3.5 rounded-xl border transition-all group ${
              !textModelEnabled || customPromptEnabled
                ? 'bg-slate-800/10 border-slate-700/20 cursor-not-allowed opacity-40'
                : 'bg-slate-800/40 border-slate-700/40 cursor-pointer hover:border-slate-600/60'
            }`}>
              <div className="relative w-14 h-7 rounded-full border-2 border-white/20 transition-all duration-300 flex-shrink-0 overflow-hidden">
                <div className={`absolute inset-0 transition-all duration-300 ${similarImages ? 'bg-blue-500' : 'bg-slate-600'}`} />
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${similarImages ? 'left-[30px]' : 'left-0.5'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-slate-200 font-medium group-hover:text-white transition-colors">无限想象</span>
                <span className="text-[10px] text-slate-500 ml-2">使用文字模型看图+图片模型生成</span>
              </div>
              <input type="checkbox" checked={similarImages}
                onChange={e => { if (!customPromptEnabled && textModelEnabled) setSimilarImages(e.target.checked); }}
                disabled={!textModelEnabled || customPromptEnabled}
                className="sr-only" />
            </label>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6" />

          {/* 自定义提示词推杆 */}
          <div className="px-6 py-4">
            <span className="text-[11px] font-medium text-slate-400 mb-3 block">其他选项</span>
            <label className="flex items-center gap-5 px-4 py-3.5 rounded-xl bg-slate-800/40 border border-slate-700/40 cursor-pointer hover:border-slate-600/60 transition-all group">
              <div className="relative w-14 h-7 rounded-full border-2 border-white/70 transition-all duration-300 flex-shrink-0 overflow-hidden">
                <div className={`absolute inset-0 transition-all duration-300 ${customPromptEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${customPromptEnabled ? 'left-[30px]' : 'left-0.5'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-slate-200 font-medium group-hover:text-white transition-colors">自定义提示词</span>
                <span className="text-[10px] text-slate-500 ml-2">开启后自定义描述，其余选项自动禁用</span>
              </div>
              <input type="checkbox" checked={customPromptEnabled}
                onChange={e => {
                  const on = e.target.checked;
                  if (on) {
                    // 开启时重置并禁用所有选项
                    setSelectedPromptNames([]);
                    setCustomPrompts([]);
                    setSelectedStyleName(null);
                    setSimilarImages(false);
                  }
                  setCustomPromptEnabled(on);
                  if (!on) setCustomPromptText('');
                }}
                className="sr-only" />
            </label>

            {/* 自定义提示词输入框 - 仅开启时显示 */}
            {customPromptEnabled && (
              <div className="mt-3 animate-[fadeIn_0.2s_ease-out]">
                <textarea
                  value={customPromptText}
                  onChange={e => setCustomPromptText(e.target.value.slice(0, 500))}
                  placeholder="输入自定义提示词，AI 将基于原图按此描述生成一张图片…"
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-emerald-500/30 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 resize-none transition-all"
                />
                <p className="text-[9px] text-slate-600 mt-1.5 ml-1">最多 500 字，仅用于本次生成，不会保存</p>
              </div>
            )}
          </div>

          {/* 生图按钮 */}
          <div className="px-6 pb-6">
            <button onClick={onGenerate} disabled={genLoading || !result}
              className="w-full py-3 rounded-xl text-sm font-bold tracking-wide bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-400 hover:to-violet-400 active:scale-[0.98] transition-all duration-200 text-white shadow-lg shadow-pink-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
              {genLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  生成中…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                  生成 {(() => {
                    if (customPromptEnabled) return '1 张';
                    const pc = selectedPromptNames.length;
                    const hasGlobal = !!selectedStyleName;
                    if (hasGlobal && pc === 0 && !similarImages) return '1 张';
                    if (hasGlobal && pc > 0) return `${pc} 张`;
                    if (pc > 1) return `${pc} 张`;
                    return '9 张';
                  })()}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('admin-root')
  );
}





function AiGenGrid({ images, progress, loading, error, imageHeight, progressPct, cellCount, total, onAddToHistory }) {
  const [visible, setVisible] = React.useState(false);
  const [previewImg, setPreviewImg] = React.useState(null); // { url, index }
  const [addingToHistory, setAddingToHistory] = React.useState(false);
  const [addedToHistory, setAddedToHistory] = React.useState(false);
  const [gridDim, setGridDim] = React.useState(400); // 网格总尺寸（宽高相等）
  const gridRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // 用 ResizeObserver 跟踪容器尺寸，取容器宽高中较小值
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setGridDim(Math.max(100, Math.min(rect.width, rect.height)));
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 网格尺寸
  const gap = 4;
  const cellW = Math.floor((gridDim - gap * 2) / 3);
  const gridW = cellW * 3 + gap * 2;
  const gridH = gridW;

  // 计算需要展示的格子数（用 total，不用 images.length，因为加载时 images 为空）
  const displayCount = total || 9;
  // 单图模式：只生成1张 → 占满整个3×3网格
  const isSingleImage = total === 1;

  // 添加到历史记录 — 用 ref 避免闭包过期
  const onAddRef = React.useRef(onAddToHistory);
  onAddRef.current = onAddToHistory;
  const addToHistory = async () => {
    if (!previewImg || !onAddRef.current) return;
    setAddingToHistory(true);
    setAddedToHistory(false);
    try {
      const fileId = await onAddRef.current(previewImg.url);
      if (fileId) {
        setAddedToHistory(true);
      }
    } catch (e) {
      console.error('添加到历史失败:', e);
    } finally {
      setAddingToHistory(false);
    }
  };

  // 关闭预览
  const closePreview = () => {
    setPreviewImg(null);
    setAddedToHistory(false);
    setAddingToHistory(false);
  };

  // 下载图片
  const downloadImage = (imgUrl, index) => {
    const link = document.createElement('a');
    link.href = imgUrl;
    link.download = `exposure-lab-ai-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 items-center w-full h-full">
      <div ref={containerRef} className={`flex-1 min-h-0 w-full h-full transition-all duration-500 ease-out flex items-center justify-center ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      >
        {/* 3x3 网格 */}
        <div ref={gridRef} className="grid" style={{ gridTemplateColumns: `repeat(3, ${cellW}px)`, gap: `${gap}px`, width: `${gridW}px`, height: `${gridH}px` }}>
          {Array.from({ length: 9 }).map((_, i) => {
            // 跳过空位
            if (i >= displayCount) {
              return <div key={i} className="hidden" />;
            }
            const img = images.find(im => im.index === i);
            const isDone = img && img.status === 'done';
            const isFailed = img && img.status === 'failed';
            // 生成结束后（取消/完成/失败），只显示成功的图片，隐藏转圈和失败框
            const generationEnded = !loading;
            if (generationEnded && !isDone) {
              return <div key={i} className="hidden" />;
            }

            return (
              <div
                key={i}
                className={`rounded-lg overflow-hidden bg-slate-900 border border-slate-800/50 relative transition-all duration-500 ease-out group ${
                  isSingleImage ? 'row-span-3 col-span-3' : ''
                }`}
                style={{
                  width: isSingleImage ? `${gridW}px` : `${cellW}px`,
                  height: isSingleImage ? `${gridH}px` : `${cellW}px`,
                  animation: visible && (images.length > i || (loading && i < progress))
                    ? `fadeSlideIn 0.3s ease-out ${i * 60}ms both`
                    : 'none',
                }}
              >
                {isDone ? (
                  <img
                    src={`${API_BASE}${img.url}`}
                    alt={`生成图 ${i + 1}`}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300 cursor-pointer"
                    onClick={() => setPreviewImg({ url: `${API_BASE}${img.url}`, index: i })}
                  />
                ) : isFailed ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[8px] text-red-500/50">失败</span>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-4 h-4 rounded-full border border-slate-600 border-t-slate-400 animate-spin" />
                  </div>
                )}
                {/* 编号 */}
                {!isSingleImage && (
                  <div className="absolute top-1 left-1 w-4 h-4 rounded bg-black/40 backdrop-blur-sm flex items-center justify-center">
                    <span className="text-[7px] text-slate-400 font-mono">{i + 1}</span>
                  </div>
                )}
                {/* 模板名称 */}
                {img && img.label && (
                  <div className="absolute bottom-1 left-1 right-1 px-1 py-0.5 rounded bg-black/50 backdrop-blur-sm truncate">
                    <span className="text-[7px] text-slate-300 font-mono">{img.label}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 进度条 — 在九宫格下方 */}
      {loading && (
        <div className="w-full flex items-center justify-center mt-3 transition-all duration-500 ease-out">
          <div className="w-full" style={{ maxWidth: `${gridW}px` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-blue-400 font-mono">{progressPct}%</span>
              <span className="text-xs text-slate-500">{progress}/{total || 9}</span>
            </div>
            <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%`, backgroundSize: '200% 100%', animation: 'shimmer 2s linear infinite' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="w-full flex items-center justify-center mt-3">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20" style={{ maxWidth: `${gridW}px`, width: '100%' }}>
            <span className="text-xs text-red-400">{error}</span>
          </div>
        </div>
      )}

      {/* 悬浮大图预览 */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closePreview}
        >
          <div
            className="relative max-w-[80vw] max-h-[85vh] rounded-2xl overflow-hidden animate-[fadeIn_0.2s_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            {/* 大图 */}
            <img
              src={previewImg.url}
              alt={`生成图 ${previewImg.index + 1}`}
              className="max-w-full max-h-[75vh] object-contain rounded-t-2xl"
            />

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/60">
              <span className="text-xs text-slate-400 font-mono">#{previewImg.index + 1} / {displayCount}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadImage(previewImg.url, previewImg.index)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium
                    bg-gradient-to-r from-pink-500 to-violet-500
                    hover:from-pink-400 hover:to-violet-400
                    active:scale-95 transition-all duration-200
                    text-white shadow-lg shadow-pink-500/25"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  下载原图
                </button>
                {onAddToHistory && (
                  <button
                    onClick={addToHistory}
                    disabled={addingToHistory || addedToHistory}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium
                      active:scale-95 transition-all duration-200
                      ${addedToHistory
                        ? 'bg-emerald-600/80 text-emerald-100 cursor-default'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/25'
                      }
                      ${addingToHistory ? 'opacity-70 cursor-wait' : ''}
                    `}
                  >
                    {addedToHistory ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        已保存到历史
                      </>
                    ) : addingToHistory ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        保存中...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        添加到历史
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={closePreview}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                    bg-slate-800 hover:bg-slate-700
                    active:scale-95 transition-all duration-200
                    text-slate-300"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// AI 智能建议（手动触发）
function AiAdvice({ fileId, onRequest }) {
  const [advice, setAdvice] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // 暴露请求方法给父组件
  React.useEffect(() => {
    if (onRequest) onRequest.current = fetchAdvice;
  }, [fileId]);

  const fetchAdvice = async () => {
    if (!fileId) return;
    setLoading(true);
    setAdvice(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-advice/${fileId}`);
      const data = await res.json();
      setAdvice(data.advice || null);
    } catch (e) {
      setError('AI建议获取失败');
    } finally {
      setLoading(false);
    }
  };

  if (!fileId) return null;

  return (
    <div className="bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-xl p-3 border border-slate-700/50">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-blue-400/80">AI 智能分析</span>
      </div>
      {!advice && !loading && !error && (
        <div className="text-[10px] text-slate-500 italic">点击顶部「AI 分析」按钮</div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          AI正在分析中...
        </div>
      )}
      {error && <div className="text-xs text-red-400">• {error}</div>}
      {advice && (
        <div className="space-y-1.5" style={{color: '#e2e8f0'}}>
          {advice.split('\n').filter(l => l.trim()).map((line, i) => (
            <div key={i} className="text-xs text-slate-200">{line.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').replace(/^\*\*|\*\*$/g, '')}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// 提示词管理面板（两步式 UI：选类型 → 列表 + 编辑）

ReactDOM.createRoot(document.getElementById('root')).render(<App />);