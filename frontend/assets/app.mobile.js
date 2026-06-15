const {
  useState,
  useRef,
  useEffect,
  useCallback
} = React;

// --- 移动端检测 Hook ---
function useIsMobile(breakpoint = 768) {
  // 动态设置 --vh（解决移动端浏览器栏遮挡问题）
if (typeof window !== 'undefined') {
  const updateVH = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  updateVH();
  window.addEventListener('resize', updateVH);
  window.addEventListener('orientationchange', updateVH);
}

// ?mobile=1 参数强制标记为移动端
  const forceMobile = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mobile') === '1';
  const [isMobile, setIsMobile] = useState(() => forceMobile || typeof window !== 'undefined' && window.innerWidth <= breakpoint);
  useEffect(() => {
    if (forceMobile) return; // 强制移动端时不监听窗口变化
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint, forceMobile]);
  return isMobile;
}

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
const evColor = ev => {
  if (ev >= 2) return '#ef4444'; // 严重过曝 - 红
  if (ev >= 1) return '#f97316'; // 过曝 - 橙
  if (ev >= 0.5) return '#eab308'; // 轻微过曝 - 黄
  if (ev > -0.5) return '#22c55e'; // 正常 - 绿
  if (ev > -1) return '#06b6d4'; // 轻微欠曝 - 青
  if (ev > -2) return '#3b82f6'; // 欠曝 - 蓝
  return '#8b5cf6'; // 严重欠曝 - 紫
};
const evBgClass = ev => {
  if (ev >= 1) return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (ev >= 0.5) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (ev > -0.5) return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (ev > -1) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
  return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
};

// ========== 组件 ==========

// 测光点叠加层
function MeteringOverlay({
  points,
  width,
  height,
  imageWidth,
  imageHeight,
  visible
}) {
  if (!points || !visible || !imageWidth || !imageHeight) return null;
  const imgAspect = width / height;
  const containerAspect = imageWidth / imageHeight;
  let renderedW, renderedH, offsetX, offsetY;
  if (imgAspect > containerAspect) {
    renderedW = imageWidth;
    renderedH = imageWidth / imgAspect;
  } else {
    renderedH = imageHeight;
    renderedW = imageHeight * imgAspect;
  }
  offsetX = (imageWidth - renderedW) / 2;
  offsetY = (imageHeight - renderedH) / 2;

  // 根据格子数量自适应文字大小
  const count = points.length;
  const fontSize = count > 16 ? 8 : 9;
  const lineHeight = count > 16 ? 10 : 12;
  const dotSize = count > 16 ? 2 : 3;
  const labelGap = count > 16 ? 4 : 5;
  return /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 pointer-events-none"
  }, points.map((p, i) => {
    const pxX = offsetX + p.cx / width * renderedW;
    const pxY = offsetY + p.cy / height * renderedH;
    const color = evColor(p.ev);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "absolute metering-dot",
      style: {
        left: pxX,
        top: pxY,
        color,
        transform: 'translate(-50%, -50%)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      style: {
        width: count > 16 ? 10 : 14,
        height: 1
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      style: {
        width: 1,
        height: count > 16 ? 10 : 14
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute whitespace-nowrap flex items-center",
      style: {
        top: labelGap,
        left: '50%',
        transform: 'translateX(-50%)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize,
        lineHeight: `${lineHeight}px`,
        color: 'rgba(255,255,255,0.7)',
        background: 'rgba(0,0,0,0.5)',
        padding: '1px 4px',
        borderRadius: 3,
        backdropFilter: 'blur(4px)'
      }
    }, p.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize,
        fontWeight: 700,
        lineHeight: `${lineHeight}px`,
        color,
        background: `${color}33`,
        padding: '1px 4px',
        borderRadius: 3,
        border: `1px solid ${color}44`,
        backdropFilter: 'blur(4px)'
      }
    }, p.ev_display, " EV")));
  }));
}

// 直方图
function Histogram({
  data
}) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  return /*#__PURE__*/React.createElement("div", {
    className: "flex items-end gap-[1px] h-16"
  }, data.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "histogram-bar flex-1 rounded-t-sm",
    style: {
      height: `${v / max * 100}%`,
      backgroundColor: `hsl(${i / 32 * 270}, 60%, 55%)`,
      opacity: 0.7
    }
  })));
}

// 区域模式选择器
function ModeSelector({
  modes,
  current,
  onChange,
  disabled
}) {
  const isMobile = useIsMobile();
  return /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2",
    style: isMobile ? {
      gap: 4,
      flexWrap: 'nowrap'
    } : {}
  }, modes.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.key,
    onClick: () => {
      if (!disabled) onChange(current === m.key ? null : m.key);
    },
    style: isMobile ? {
      padding: '4px 8px',
      fontSize: 10
    } : {},
    className: `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${disabled ? 'bg-slate-800/30 text-slate-600 border border-slate-700/30 cursor-not-allowed' : current === m.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-slate-800/50 text-slate-200 border border-slate-700/50 hover:border-slate-600'}`
  }, m.name, isMobile ? null : /*#__PURE__*/React.createElement("span", {
    className: "ml-1 text-xs opacity-60"
  }, m.rows, "\xD7", m.cols))));
}

// 文件历史项
function HistoryItem({
  item,
  onSelect,
  onDelete,
  active,
  multiSelect,
  isSelected,
  onToggle
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${multiSelect && isSelected ? 'bg-blue-500/15 border border-blue-400/30' : !multiSelect && active ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-slate-800/50 border border-transparent'}`,
    onClick: () => multiSelect ? onToggle(item.file_id) : onSelect(item)
  }, multiSelect && /*#__PURE__*/React.createElement("div", {
    className: `w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-500'}`,
    onClick: e => {
      e.stopPropagation();
      onToggle(item.file_id);
    }
  }, isSelected && /*#__PURE__*/React.createElement("svg", {
    className: "w-3 h-3 text-white",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 3,
    d: "M5 13l4 4L19 7"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "w-10 h-10 rounded bg-slate-800 overflow-hidden flex-shrink-0"
  }, /*#__PURE__*/React.createElement("img", {
    src: `${API_BASE}/${item.original}`,
    className: "w-full h-full object-cover",
    alt: ""
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-300 truncate"
  }, item.filename), item.prompt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 truncate mt-0.5"
  }, item.prompt), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500"
  }, new Date(item.timestamp).toLocaleString('zh-CN'))), !multiSelect && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onDelete(item.file_id);
    },
    className: "opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  }))));
}

// 主应用
function App() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(null);
  const [modes, setModes] = useState([]);
  const [history, setHistory] = useState([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [imageDims, setImageDims] = useState({
    w: 0,
    h: 0
  });
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const textInputRef = useRef(null);
  const containerRef = useRef(null);
  const [containerDims, setContainerDims] = useState({
    w: 0,
    h: 0
  });
  const [showAdmin, setShowAdmin] = useState(false);
  const toggleAdmin = () => setShowAdmin(v => !v);
  const imgRef = useRef(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiImageEnabled, setAiImageEnabled] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiImageSaved, setAiImageSaved] = useState(false);
  const [activeFileId, setActiveFileId] = useState(null);
  const [batchStatus, setBatchStatus] = useState({
    inProgress: false,
    total: 0,
    processed: 0
  });
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
    '9:16': ['576x1024', '1024x1792']
  };
  // 文字生图
  const [textPrompt, setTextPrompt] = useState('');
  const [textGenLoading, setTextGenLoading] = useState(false);
  const [textGenImages, setTextGenImages] = useState([]);
  const [textGenProgress, setTextGenProgress] = useState(0);
  const [isTextGenMode, setIsTextGenMode] = useState(false);
  const [textGenError, setTextGenError] = useState(null);
  const [textGenTotal, setTextGenTotal] = useState(9);
  const [textGenTaskId, setTextGenTaskId] = useState('');

  // AI 分析弹窗（移动端）
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const analysisCacheRef = useRef(null); // { fileId, mode, data }
  React.useEffect(() => { analysisCacheRef.current = null; }, [activeFileId]);

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
    } catch (e) {/* ignore */}
  };
  const savePrompt = async (name, content, type, editId) => {
    if (!name.trim() || !content.trim()) return;
    const fd = new FormData();
    fd.append('id', editId || '');
    fd.append('name', name.trim());
    fd.append('content', content.trim());
    fd.append('type', type);
    await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      body: fd
    });
    await loadPrompts();
  };
  const deletePrompt = async id => {
    await fetch(`${API_BASE}/api/prompts/${id}`, {
      method: 'DELETE'
    });
    await loadPrompts();
  };

  // 加载模式列表、历史和提示模板
  useEffect(() => {
    fetch(`${API_BASE}/api/grid-modes`).then(r => r.json()).then(d => setModes(d.modes));
    fetch(`${API_BASE}/api/history`).then(r => r.json()).then(d => setHistory(d.items));
    fetch(`${API_BASE}/api/settings/ai`).then(r => r.json()).then(d => {
      setAiEnabled(d.enabled);
      setAiImageEnabled(d.image_enabled);
      setAiSaved(d.has_saved);
      setAiImageSaved(d.image_has_saved);
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
          const res = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            body: fd
          });
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
  const handleFiles = async fileList => {
    setIsTextGenMode(false);
    if (genFileId) {
      alert('AI 生成中，请等待完成或取消后再上传');
      return;
    }
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['jpg', 'jpeg', 'png'].includes(ext);
    });
    if (files.length === 0) return;
    setBatchStatus({
      inProgress: true,
      total: files.length,
      processed: 0
    });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        if (i === 0) {
          // 第一张：设置预览
          setFile(f);
          setActiveFileId(null);
          const reader = new FileReader();
          await new Promise((resolve, reject) => {
            reader.onload = e => {
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
      setBatchStatus(prev => ({
        ...prev,
        processed: i + 1
      }));
    }

    // 清空 input 以便重复选择
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    setBatchStatus({
      inProgress: false,
      total: 0,
      processed: 0
    });
  };

  // 拖拽（支持多文件）
  const onDrop = e => {
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
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      setResult(data);
      setActiveFileId(data.file_id);
      setGenResultsMap(prev => ({
        ...prev,
        [data.file_id]: null
      }));
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
          fd.append('global_style', JSON.stringify({
            name: tpl.name,
            content: tpl.content
          }));
        }
      }
      if (customPrompts.length > 0) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({
          name: p.name,
          content: p.content
        }))));
      }
      const res = await fetch(`${API_BASE}/api/generate/text-image`, {
        method: 'POST',
        body: fd
      });
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
  const pollTextGeneration = taskId => {
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
      await fetch(`${API_BASE}/api/generate/cancel`, {
        method: 'POST',
        body: fd
      });
    } catch {}
    clearInterval(genTimerRef.current);
    setTextGenLoading(false);
    setTextGenError('已手动停止');
  };

  // AI 生图
  const startGeneration = async (fileId, options = {}) => {
    const {
      similarImages = false,
      selectedStyleName = null
    } = options;
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
        const res = await fetch(`${API_BASE}/api/generate/custom-prompt`, {
          method: 'POST',
          body: fd
        });
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
          fd.append('global_style', JSON.stringify({
            name: tpl.name,
            content: tpl.content
          }));
        }
      }
      // 无限想象模式：始终传递 custom_prompts_json（即使空数组），后端优先用提示词
      if (similar) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({
          name: p.name,
          content: p.content
        }))));
      } else if (customPrompts.length > 0) {
        fd.append('custom_prompts_json', JSON.stringify(customPrompts.map(p => ({
          name: p.name,
          content: p.content
        }))));
      }
      fd.append('similar', String(similar));
      const res = await fetch(`${API_BASE}/api/generate/similar`, {
        method: 'POST',
        body: fd
      });
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
      await fetch(`${API_BASE}/api/generate/cancel`, {
        method: 'POST',
        body: (() => {
          const fd = new FormData();
          fd.append('task_id', genTaskId);
          return fd;
        })()
      });
    } catch (e) {/* ignore */}
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
      setGenResultsMap(prev => ({
        ...prev,
        [genFileId]: null
      }));
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
          setGenResultsMap(prev => ({
            ...prev,
            [fileId]: imgs
          }));
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
  const handleAddToHistory = async (imageUrl, prompt) => {
    try {
      const fd = new FormData();
      fd.append('image_url', imageUrl);
      if (prompt) fd.append('prompt', prompt);
      const res = await fetch(`${API_BASE}/api/history/from-generated`, {
        method: 'POST',
        body: fd
      });
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
  const selectHistory = async item => {
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
      // 保留当前模式，不重置，避免触发重新分析
      setGenImages([]);
      setShowOverlay(true);
      setIsTextGenMode(false);
    } catch (err) {
      alert('加载失败');
    }
  };

  // 删除历史
  const deleteHistory = async fileId => {
    await fetch(`${API_BASE}/api/history/${fileId}`, {
      method: 'DELETE'
    });
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
    setGenResultsMap(prev => {
      const m = {
        ...prev
      };
      delete m[fileId];
      return m;
    });
    // 同时从多选集合中移除
    if (selectedHistory.has(fileId)) {
      selectedHistory.delete(fileId);
      setSelectedHistory(new Set(selectedHistory));
    }
  };

  // 多选相关
  const toggleHistorySelect = fileId => {
    const newSelect = new Set(selectedHistory);
    if (newSelect.has(fileId)) newSelect.delete(fileId);else newSelect.add(fileId);
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
      await fetch(`${API_BASE}/api/history/${id}`, {
        method: 'DELETE'
      });
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

  // 用 ResizeObserver 实时追踪图片渲染尺寸（替代 onImageLoad）
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const updateDims = () => {
      setImageDims({
        w: img.clientWidth,
        h: img.clientHeight
      });
    };

    // 初始获取
    updateDims();

    // 监听尺寸变化
    const ro = new ResizeObserver(updateDims);
    ro.observe(img);
    return () => ro.disconnect();
  }, [preview]);
  return /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'min-h-dvh' : 'h-screen overflow-hidden'}`,
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-64 bg-[#0d1117] border-r border-slate-800 flex flex-col",
    style: isMobile ? {
      position: 'fixed',
      top: 56,
      left: 0,
      height: '100%',
      zIndex: 40,
      transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
      transition: 'transform 0.3s ease',
      boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
      width: 280
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b border-slate-800"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "text-lg font-bold text-white tracking-tight"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-blue-400"
  }, "\u26A1"), " \u955C\u5934\u6F14\u7B97\u5BA4"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, "LensLab v", __version__), /*#__PURE__*/React.createElement("button", {
    onClick: toggleAdmin,
    className: "text-slate-500 hover:text-blue-400 transition-colors",
    title: "\u540E\u53F0\u7BA1\u7406"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  }), /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "p-3"
  }, /*#__PURE__*/React.createElement("input", {
    ref: fileInputRef,
    type: "file",
    accept: ".jpg,.jpeg,.png",
    multiple: true,
    className: "hidden",
    onChange: e => handleFiles(e.target.files)
  }), /*#__PURE__*/React.createElement("input", {
    ref: folderInputRef,
    type: "file",
    accept: ".jpg,.jpeg,.png",
    webkitdirectory: "",
    directory: "",
    className: "hidden",
    onChange: e => handleFiles(e.target.files)
  }), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => fileInputRef.current?.click(),
    className: "w-full py-2.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-500/20 transition-all"
  }, "+ \u5BFC\u5165\u56FE\u7247"), /*#__PURE__*/React.createElement("button", {
    onClick: () => folderInputRef.current?.click(),
    className: "w-full py-2.5 bg-slate-700/10 text-slate-300 border border-slate-700/30 rounded-lg text-sm hover:bg-slate-700/20 transition-all"
  }, "\uD83D\uDCC1 \u5BFC\u5165\u6587\u4EF6\u5939")), batchStatus.inProgress && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-xs text-slate-400 text-center"
  }, "\u5904\u7406\u4E2D ", batchStatus.processed, "/", batchStatus.total)), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto px-3 pb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-3 mt-2 mb-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider"
  }, "\u5386\u53F2\u8BB0\u5F55"), !multiSelect ? /*#__PURE__*/React.createElement("button", {
    onClick: () => setMultiSelect(true),
    className: "text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
  }, "\u6279\u91CF\u9009\u62E9") : /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const allIds = new Set(history.map(h => h.file_id));
      setSelectedHistory(allIds);
    },
    className: "text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
  }, "\u5168\u9009"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelectedHistory(new Set()),
    className: "text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
  }, "\u4E0D\u5168\u9009"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-600"
  }, "|"), /*#__PURE__*/React.createElement("button", {
    onClick: deleteSelectedHistory,
    className: `text-[10px] transition-colors ${selectedHistory.size > 0 ? 'text-red-400 hover:text-red-300' : 'text-slate-600 cursor-not-allowed'}`
  }, "\u5220\u9664\u9009\u4E2D", selectedHistory.size > 0 ? `(${selectedHistory.size})` : ''), /*#__PURE__*/React.createElement("button", {
    onClick: clearMultiSelect,
    className: "text-[10px] text-slate-500 hover:text-slate-300 ml-1"
  }, "\u9000\u51FA"))), history.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-600 text-center py-8"
  }, "\u6682\u65E0\u8BB0\u5F55") : history.slice().reverse().map(item => /*#__PURE__*/React.createElement(HistoryItem, {
    key: item.file_id,
    item: item,
    onSelect: selectHistory,
    onDelete: deleteHistory,
    active: result?.file_id === item.file_id,
    multiSelect: multiSelect,
    isSelected: selectedHistory.has(item.file_id),
    onToggle: toggleHistorySelect
  })))), isMobile && sidebarOpen && /*#__PURE__*/React.createElement("div", {
    onClick: () => setSidebarOpen(false),
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 35
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'flex-1 flex flex-col overflow-y-auto' : 'flex-1 flex flex-col overflow-hidden'}`,
    style: isMobile ? {
      width: '100%',
      minWidth: 0
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-12 bg-[#0d1117] border-b border-slate-800 flex items-center justify-between ${isMobile ? 'px-4' : 'px-6'}`,
    style: isMobile ? {
      padding: '0 12px'
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-4",
    style: isMobile ? {
      gap: 8
    } : {}
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, "\u533A\u57DF\u6A21\u5F0F"), /*#__PURE__*/React.createElement(ModeSelector, {
    modes: modes,
    current: mode,
    onChange: m => {
      setMode(m);
      analysisCacheRef.current = null;
    },
    disabled: isTextGenMode || !preview
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3",
    style: isMobile ? {
      gap: 6,
      flexWrap: 'nowrap',
      overflow: 'auto'
    } : {}
  }, true && /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-2 text-xs text-slate-400 cursor-pointer"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: showOverlay,
    onChange: e => setShowOverlay(e.target.checked),
    className: "rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
  }), "\u663E\u793A\u6D4B\u5149\u70B9"), aiEnabled && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (isTextGenMode || !mode) return;
      if (isMobile) {
        var fid = activeFileId || (result ? result.file_id : null);
        // 缓存命中检查：同一图片 + 同一模式
        if (analysisCacheRef.current && analysisCacheRef.current.fileId === fid && analysisCacheRef.current.mode === mode) {
          setShowAnalysisModal(true);
          setAnalysisData(analysisCacheRef.current.data);
          setAnalysisLoading(false);
          return;
        }
        setShowAnalysisModal(true);
        setAnalysisLoading(true);
        setAnalysisData(null);
        if (fid) {
          fetch(API_BASE + '/api/ai-advice/' + fid).then(function(r) { return r.json(); }).then(function(d) {
            var advice = d.advice || null;
            analysisCacheRef.current = { fileId: fid, mode: mode, data: advice };
            setAnalysisData(advice);
            setAnalysisLoading(false);
          }).catch(function() { setAnalysisData('获取失败，请重试'); setAnalysisLoading(false); });
        } else {
          setAnalysisData('请先选择图片'); setAnalysisLoading(false);
        }
      } else {
        aiAdviceRef.current && aiAdviceRef.current();
      }
    },
    disabled: isTextGenMode || !mode || !preview,
    title: !mode ? '请先选择区域模式' : 'AI 分析',
    className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${isTextGenMode || !mode ? 'bg-slate-800/30 border-slate-700/30 text-slate-600 cursor-not-allowed' : 'bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20 border border-slate-600/50 hover:border-blue-500/40 text-slate-200 hover:text-blue-300'}`
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
  })), /*#__PURE__*/React.createElement("span", {
    className: ""
  }, "AI \u5206\u6790")), aiImageEnabled && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setIsTextGenMode(true);
      // 退出预览模式（如果正在查看历史图片）
      setPreview(null);
      // 等待 DOM 更新后滚动
      setTimeout(() => {
        if (textGenImages.length > 0) {
          // 生成过：滚动到九宫格区域
          const gridEl = document.querySelector('[data-ai-gen-grid]');
          if (gridEl) gridEl.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        } else {
          // 没生成过：聚焦文字输入框
          if (textInputRef && textInputRef.current) {
            textInputRef.current.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
            setTimeout(() => textInputRef.current.focus(), 500);
          }
        }
      }, 100);
    },
    className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20 border border-slate-600/50 hover:border-blue-500/40 text-slate-200 hover:text-blue-300 transition-all duration-200"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M13 10V3L4 14h7v7l9-11h-7z"
  })), /*#__PURE__*/React.createElement("span", {
    className: ""
  }, "AI \u6587\u751F\u56FE")), genLoading && /*#__PURE__*/React.createElement("button", {
    onClick: cancelGeneration,
    className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-br from-red-500/20 to-red-600/30 border border-red-500/40 text-red-300 hover:from-red-500/30 hover:to-red-600/40 transition-all"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "animate-spin h-3.5 w-3.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "\u53D6\u6D88"), selectedPromptNames.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "hidden sm:flex items-center gap-1 flex-wrap"
  }, selectedPromptNames.map((name, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-purple-500/10 border border-purple-500/20 text-purple-300"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-purple-500 font-mono"
  }, i + 1), name, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const newNames = selectedPromptNames.filter((_, j) => j !== i);
      const newPrompts = customPrompts.filter((_, j) => j !== i);
      setSelectedPromptNames(newNames);
      setCustomPrompts(newPrompts);
    },
    className: "ml-0.5 hover:text-red-300 transition-colors"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3 h-3",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  }))))), selectedPromptNames.length < 9 && /*#__PURE__*/React.createElement("span", {
    className: "text-[9px] text-slate-500"
  }, "+", 9 - selectedPromptNames.length, "\u9ED8\u8BA4")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (!isTextGenMode) {
        loadPrompts();
        setShowAiGenPanel(true);
      }
    },
    disabled: genLoading || showAiGenPanel || isTextGenMode || !activeFileId,
    className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-blue-500/25 hover:to-blue-600/20 border border-slate-600/50 hover:border-blue-500/40 text-slate-200 hover:text-blue-300"
  }, genLoading ? /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-br from-red-500/20 to-red-600/30 border border-red-500/40 text-red-300"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "animate-spin h-3.5 w-3.5",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "\u751F\u6210\u4E2D ", genProgress > 0 ? `${genProgress}/${genTotal}` : '') : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
  })), "AI \u751F\u56FE"))))), /*#__PURE__*/React.createElement("div", {
    className: `${preview ? `flex-1 overflow-y-auto ${isMobile ? 'flex flex-col p-2' : 'flex items-center justify-center p-8'}` : 'flex-1 flex flex-col px-8 pt-8 pb-0 min-h-0 overflow-hidden'} bg-[#080b12]`
  }, !preview ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex flex-col  min-h-0 w-full"
  }, textGenLoading || textGenImages.length > 0 ? /*#__PURE__*/React.createElement("div", {
    "data-ai-gen-grid": true,
    className: `w-full ${isMobile ? 'min-h-0' : 'flex-1 min-h-0'}`
  }, /*#__PURE__*/React.createElement(AiGenGrid, {
    images: textGenImages,
    progress: textGenProgress,
    loading: textGenLoading,
    error: textGenError,
    total: textGenTotal,
    progressPct: textGenTotal > 0 ? Math.round(textGenProgress / textGenTotal * 100) : 0,
    onAddToHistory: handleAddToHistory
  })) : /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-4xl flex-1 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: `drop-zone w-full h-full rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ease-out ${dragOver ? 'drag-over' : ''}`,
    style: {
      minHeight: isMobile ? '80px' : '200px'
    },
    onDragOver: e => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: onDrop,
    onClick: () => fileInputRef.current?.click()
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-12 h-12 text-slate-600 mb-3",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.5,
    d: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
  })), /*#__PURE__*/React.createElement("p", {
    className: "text-slate-400 text-sm"
  }, "\u62D6\u62FD\u56FE\u7247\u5230\u6B64\u5904\uFF0C\u6216\u70B9\u51FB\u9009\u62E9"), /*#__PURE__*/React.createElement("p", {
    className: "text-slate-600 text-xs mt-2"
  }, "JPG / PNG")))), /*#__PURE__*/React.createElement("div", {
    className: `flex-shrink-0 w-full px-4 pt-3 ${isMobile ? "pb-4" : ""}`,
    style: {
      background: '#080b12'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-4xl"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1"
  }, ['1:1', '4:3', '16:9'].map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    onClick: () => {
      setSelectedRatio(r);
      setSelectedSize(ratioSizeMap[r][0]);
    },
    className: `px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${selectedRatio === r ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'}`
  }, r))), selectedRatio === '4:3' && /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSelectedOrientation('landscape');
      setSelectedSize('1024x768');
    },
    className: `px-1.5 py-0.5 rounded text-[10px] transition-all border ${selectedOrientation === 'landscape' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'}`
  }, "\u6A2A"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSelectedOrientation('portrait');
      setSelectedSize('768x1024');
    },
    className: `px-1.5 py-0.5 rounded text-[10px] transition-all border ${selectedOrientation === 'portrait' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/40 text-slate-500 border-slate-700/40 hover:border-slate-600'}`
  }, "\u7AD6")), /*#__PURE__*/React.createElement("select", {
    value: selectedSize,
    onChange: e => setSelectedSize(e.target.value),
    className: "w-[110px] px-2 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/50 text-slate-300 outline-none focus:border-blue-500/40 transition-all shrink-0"
  }, ratioSizeMap[selectedRatio].map(s => /*#__PURE__*/React.createElement("option", {
    key: s,
    value: s
  }, s)))))), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 w-full flex items-center justify-center",
    style: {
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: '#080b12'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-4xl"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 bg-[#0d1117] border border-slate-700/60 rounded-xl px-3 py-2.5 focus-within:border-blue-500/50 transition-colors"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-4 h-4 text-slate-500 shrink-0",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
  })), /*#__PURE__*/React.createElement("input", {
    ref: textInputRef,
    type: "text",
    value: textPrompt,
    onChange: e => setTextPrompt(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter' && textPrompt.trim()) handleTextGenerate();
    },
    placeholder: "\u8F93\u5165\u6587\u5B57\u63CF\u8FF0\uFF0C\u76F4\u63A5\u751F\u6210\u4E5D\u5BAB\u683C...",
    className: "flex-1 bg-transparent text-slate-200 text-sm placeholder-slate-600 outline-none"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleTextGenerate,
    disabled: !textPrompt.trim() || textGenLoading,
    className: "px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-br from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 border border-blue-500/30 hover:border-blue-400/50 text-blue-300 hover:text-blue-200"
  }, textGenLoading ? /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "animate-spin h-3 w-3",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "\u751F\u6210\u4E2D") : `生成${genTotal || 9}张`), textGenLoading && /*#__PURE__*/React.createElement("button", {
    onClick: handleCancelTextGen,
    className: "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 hover:border-red-400/50 text-red-400 hover:text-red-300"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3 h-3",
    fill: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "6",
    width: "12",
    height: "12",
    rx: "2"
  })), "\u505C\u6B62")))))) : /*#__PURE__*/React.createElement("div", {
    className: `transition-all duration-500 ease-out min-w-0 ${isMobile ? 'flex flex-col gap-4 p-4' : 'flex items-center gap-6'}`,
    style: isMobile ? {
      height: 'auto'
    } : {
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'w-full flex-shrink-0 flex items-center justify-center' : 'overflow-hidden flex items-center justify-center min-w-0 flex-1'}`,
    style: isMobile ? {} : {
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-container relative",
    style: {
      display: 'inline-block'
    }
  }, /*#__PURE__*/React.createElement("img", {
    ref: imgRef,
    src: preview,
    alt: "preview",
    className: "rounded-lg shadow-2xl max-h-[70vh] max-w-full object-contain",
    style: isMobile ? { maxHeight: '25vh' } : {},
    style: isMobile ? { maxHeight: '25vh' } : {}
  }), /*#__PURE__*/React.createElement(MeteringOverlay, {
    points: result?.metering_points,
    width: result?.width,
    height: result?.height,
    imageWidth: imageDims.w,
    imageHeight: imageDims.h,
    visible: showOverlay && result && mode
  }))), (isMobile && result?.prompt) ? /*#__PURE__*/React.createElement("div", {
    className: "w-full flex-shrink-0 px-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-800/30 rounded-xl p-3 border border-slate-700/50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider mb-1.5"
  }, "提示词"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-300 leading-relaxed break-words whitespace-pre-wrap"
  }, result.prompt))) : null, (genLoading || genImages.length > 0) && /*#__PURE__*/React.createElement("div", {
    className: `flex items-center justify-center ${isMobile ? 'w-full flex-shrink-0' : 'flex-1 min-h-0'}`
  }, /*#__PURE__*/React.createElement(AiGenGrid, {
    images: genImages,
    progress: genProgress,
    loading: genLoading,
    error: genError,
    total: genTotal,
    progressPct: genProgress > 0 ? Math.round(genProgress / genTotal * 100) : 0,
    onAddToHistory: handleAddToHistory
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: !isTextGenMode && mode && !isMobile ? "flex" : "none"
    },
    className: "w-72 bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b border-slate-800"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold text-slate-300"
  }, "\u5206\u6790\u7ED3\u679C")), !result ? /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-600"
  }, "\u5BFC\u5165\u56FE\u7247\u540E\u70B9\u51FB\u5206\u6790")) : /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-4 space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-800/30 rounded-xl p-3 border border-slate-700/50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider mb-2"
  }, "\u6574\u4F53\u66DD\u5149"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-baseline gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl font-bold mono",
    style: {
      color: evColor((result.avg_brightness - 128) / 45)
    }
  }, ((result.avg_brightness - 128) / 45).toFixed(1)), /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, "EV")), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, "\u5E73\u5747\u4EAE\u5EA6: ", result.avg_brightness, " / 255")), /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-800/30 rounded-xl p-3 border border-slate-700/50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider mb-2"
  }, "\u4EAE\u5EA6\u76F4\u65B9\u56FE"), /*#__PURE__*/React.createElement(Histogram, {
    data: result.histogram
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-[9px] text-slate-600 mt-1"
  }, /*#__PURE__*/React.createElement("span", null, "\u6697\u90E8"), /*#__PURE__*/React.createElement("span", null, "\u4E2D\u95F4\u8C03"), /*#__PURE__*/React.createElement("span", null, "\u9AD8\u5149"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider mb-2"
  }, "\u533A\u57DF\u6D4B\u5149 \xB7 ", result.mode_name), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1.5"
  }, result.metering_points.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: `flex items-center justify-between px-3 py-2 rounded-lg border ${evBgClass(p.ev)}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-medium"
  }, p.name)), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] opacity-60 mono"
  }, p.brightness), /*#__PURE__*/React.createElement("span", {
    className: "text-sm font-bold mono"
  }, p.ev_display)))))), /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-800/30 rounded-xl p-3 border border-slate-700/50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 uppercase tracking-wider mb-2"
  }, "\u66DD\u5149\u8BC4\u4F30"), /*#__PURE__*/React.createElement(ExposureAdvice, {
    result: result
  })), aiEnabled && /*#__PURE__*/React.createElement(AiAdvice, {
    fileId: result.file_id,
    onRequest: aiAdviceRef
  }))), showAdmin && ReactDOM.createPortal(/*#__PURE__*/React.createElement(AdminPanel, {
    onClose: () => setShowAdmin(false)
  }), document.getElementById('admin-root')), showAnalysisModal && AnalysisModal({
    show: showAnalysisModal, data: analysisData, loading: analysisLoading, onClose: function() { setShowAnalysisModal(false); }
  }, document.getElementById('root')), showAiGenPanel && ReactDOM.createPortal(/*#__PURE__*/React.createElement(AiGenPanel, {
    prompts: promptTemplates,
    customPrompts: customPrompts,
    setCustomPrompts: setCustomPrompts,
    selectedPromptNames: selectedPromptNames,
    setSelectedPromptNames: setSelectedPromptNames,
    selectedStyleName: selectedStyleName,
    setSelectedStyleName: setSelectedStyleName,
    similarImages: similarImages,
    setSimilarImages: setSimilarImages,
    customPromptEnabled: customPromptEnabled,
    setCustomPromptEnabled: setCustomPromptEnabled,
    customPromptText: customPromptText,
    setCustomPromptText: setCustomPromptText,
    genLoading: genLoading,
    result: result,
    selectedRatio: selectedRatio,
    setSelectedRatio: setSelectedRatio,
    selectedOrientation: selectedOrientation,
    setSelectedOrientation: setSelectedOrientation,
    selectedSize: selectedSize,
    setSelectedSize: setSelectedSize,
    ratioSizeMap: ratioSizeMap,
    onGenerate: () => {
      if (!result) {
        alert("请先导入并分析图片");
        return;
      }
      const fid = result.file_id;
      if (customPromptEnabled && !customPromptText.trim()) {
        alert("请输入自定义提示词");
        return;
      }
      setShowAiGenPanel(false);
      setTimeout(() => {
        if (customPromptEnabled) {
          startGeneration(fid, {
            customPrompt: true
          });
        } else {
          startGeneration(fid, {
            similarImages,
            selectedStyleName
          });
        }
      }, 100);
    },
    onRefreshPrompts: loadPrompts,
    onDeletePrompt: deletePrompt,
    onSavePrompt: savePrompt,
    onClose: () => {
      setShowAiGenPanel(false);
      setCustomPromptEnabled(false);
      setCustomPromptText('');
    },
    textModelEnabled: aiEnabled
  }), document.getElementById('admin-root')));
}

// 曝光建议（基础规则）
function ExposureAdvice({
  result
}) {
  const avg = (result.avg_brightness - 128) / 45;
  const maxEv = Math.max(...result.metering_points.map(p => p.ev));
  const minEv = Math.min(...result.metering_points.map(p => p.ev));
  const range = maxEv - minEv;
  let advice = [];
  if (avg > 1) advice.push({
    text: '整体偏亮，建议降低曝光补偿',
    color: 'text-orange-400'
  });else if (avg < -1) advice.push({
    text: '整体偏暗，建议增加曝光补偿',
    color: 'text-blue-400'
  });else advice.push({
    text: '整体曝光正常',
    color: 'text-green-400'
  });
  if (range > 3) advice.push({
    text: '光比过大，建议使用HDR或补光',
    color: 'text-yellow-400'
  });else if (range > 2) advice.push({
    text: '光比适中，注意高光细节',
    color: 'text-cyan-400'
  });
  if (maxEv >= 2.5) advice.push({
    text: '存在过曝区域，注意高光溢出',
    color: 'text-red-400'
  });
  if (minEv <= -2.5) advice.push({
    text: '存在死黑区域，暗部细节丢失',
    color: 'text-purple-400'
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-1.5"
  }, advice.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: `text-xs ${a.color}`
  }, "\u2022 ", a.text)));
}

// AI 生图设置面板
// AI 生图设置面板（内嵌模板管理）
function AiGenPanel({
  prompts,
  customPrompts,
  setCustomPrompts,
  selectedPromptNames,
  setSelectedPromptNames,
  selectedStyleName,
  setSelectedStyleName,
  similarImages,
  setSimilarImages,
  customPromptEnabled,
  setCustomPromptEnabled,
  customPromptText,
  setCustomPromptText,
  genLoading,
  onGenerate,
  result,
  onRefreshPrompts,
  onSavePrompt,
  onDeletePrompt,
  onClose,
  textModelEnabled,
  selectedRatio,
  setSelectedRatio,
  selectedOrientation,
  setSelectedOrientation,
  selectedSize,
  setSelectedSize,
  ratioSizeMap
}) {
  const isMobile = useIsMobile();
  const promptList = (prompts || []).filter(p => (p.type || 'prompt') === 'prompt');
  const styleList = (prompts || []).filter(p => (p.type || 'prompt') === 'style');

  // 模板管理状态：null = 选择模式，'prompt' | 'style' = 管理模式
  const [manageTab, setManageTab] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editContent, setEditContent] = React.useState('');
  const [editId, setEditId] = React.useState(null);
  const [isCreating, setIsCreating] = React.useState(false);
  // 手机端模板 Tab 切换：'prompt' | 'style'
  const [mobileTemplateTab, setMobileTemplateTab] = React.useState('prompt');
  const togglePrompt = p => {
    if (selectedPromptNames.includes(p.name)) {
      setSelectedPromptNames(selectedPromptNames.filter(n => n !== p.name));
      setCustomPrompts(customPrompts.filter(cp => cp.name !== p.name));
    } else if (customPrompts.length < 9) {
      setSelectedPromptNames([...selectedPromptNames, p.name]);
      setCustomPrompts([...customPrompts, {
        name: p.name,
        content: p.content,
        order: customPrompts.length
      }]);
    }
  };

  // 阻止左滑返回
  React.useEffect(() => {
    const onPop = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  const preventClose = e => {
    e.preventDefault();
    e.stopPropagation();
  };

  // --- 管理模式：CRUD 处理器 ---
  const startEdit = item => {
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
  const handleDelete = id => {
    if (!confirm('确定删除此模板？解除锁定需要重新打开设置面板')) return;
    onDeletePrompt(id);
    onRefreshPrompts();
  };
  const currentItems = manageTab === 'prompt' ? promptList : styleList;

  // ==================== 管理视图 ====================
  if (manageTab) {
    const mgmtContainerStyle = isMobile ? {
      width: '100%',
      height: '100%',
      borderRadius: 0
    } : {
      width: 520,
      minWidth: 360,
      maxWidth: '95vw',
      maxHeight: '85vh'
    };
    const mgmtTitleStyle = isMobile ? {
      paddingTop: 'env(safe-area-inset-top, 0px)'
    } : {};
    return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm",
      style: Object.assign({ zIndex: 5001 }, isMobile ? {
        justifyContent: 'stretch',
        alignItems: 'stretch'
      } : {}),
      tabIndex: -1,
      onClick: preventClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-[520px] min-w-[360px] max-w-[95vw] max-h-[85vh] rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-2xl shadow-black/50 flex flex-col",
      style: mgmtContainerStyle,
      onClick: e => e.stopPropagation(),
      onMouseDown: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between px-5 py-3 border-b border-slate-800/60"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setManageTab(null);
        startNew();
      },
      className: "w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-4 h-4",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M15 19l-7-7 7-7"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-semibold text-white"
    }, manageTab === 'prompt' ? '🎯 提示词管理' : '🎨 全局风格管理'), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500"
    }, currentItems.length))), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setManageTab(null);
        setIsCreating(false);
        setEditName('');
        setEditContent('');
        setEditId(null);
      },
      className: "w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-all"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-4 h-4",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M6 18L18 6M6 6l12 12"
    })))), /*#__PURE__*/React.createElement("div", {
      className: "flex-1 overflow-y-auto p-4 space-y-3"
    }, currentItems.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "flex flex-col items-center justify-center py-10 text-slate-500"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-2xl mb-2"
    }, "\uD83D\uDCED"), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px]"
    }, "\u6682\u65E0", manageTab === 'prompt' ? '提示词' : '全局风格', "\u6A21\u677F")) : /*#__PURE__*/React.createElement("div", {
      className: "space-y-1.5"
    }, currentItems.map(item => /*#__PURE__*/React.createElement("div", {
      key: item.id,
      className: `flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all group ${editId === item.id ? 'bg-blue-500/10 border-blue-500/30' : 'bg-slate-800/40 border-slate-700/30 hover:border-slate-600/50'}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-medium text-white truncate"
    }, item.name), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] text-slate-500 truncate mt-0.5"
    }, item.content.slice(0, 50), item.content.length > 50 ? '…' : '')), /*#__PURE__*/React.createElement("div", {
      className: "flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => startEdit(item),
      className: "w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-300 hover:bg-blue-500/10 transition-all",
      title: "\u7F16\u8F91"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-3.5 h-3.5",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: () => handleDelete(item.id),
      className: "w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-all",
      title: "\u5220\u9664"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-3.5 h-3.5",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    }))))))), editName !== '' || editContent !== '' || editId !== null || isCreating ? /*#__PURE__*/React.createElement("div", {
      className: "p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/40 space-y-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[11px] font-medium text-slate-300"
    }, editId ? '编辑模板' : '新建模板'), editId && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setEditId(null);
        setEditName('');
        setEditContent('');
        setIsCreating(false);
      },
      className: "text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
    }, "\u53D6\u6D88\u7F16\u8F91")), /*#__PURE__*/React.createElement("input", {
      value: editName,
      onChange: e => setEditName(e.target.value),
      placeholder: "\u6A21\u677F\u540D\u79F0",
      className: "w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40"
    }), /*#__PURE__*/React.createElement("textarea", {
      value: editContent,
      onChange: e => setEditContent(e.target.value),
      placeholder: manageTab === 'prompt' ? '输入提示词内容…' : '输入全局风格描述…',
      rows: 3,
      className: "w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 resize-none"
    }), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end gap-2"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setEditId(null);
        setEditName('');
        setEditContent('');
        setIsCreating(false);
      },
      className: "px-3 py-1.5 rounded-lg text-[10px] bg-slate-700/40 hover:bg-slate-700/60 text-slate-400 transition-all"
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
      onClick: handleSave,
      disabled: !editName.trim() || !editContent.trim(),
      className: "px-3 py-1.5 rounded-lg text-[10px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
    }, editId ? '保存修改' : '创建'))) : null), /*#__PURE__*/React.createElement("div", {
      className: "px-4 py-3 border-t border-slate-800/60"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: startNew,
      className: "w-full py-2.5 rounded-xl text-xs font-medium bg-slate-800/70 hover:bg-slate-700/80 border border-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-4 h-4",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M12 4v16m8-8H4"
    })), "\u65B0\u5EFA", manageTab === 'prompt' ? '提示词' : '全局风格')))), document.getElementById('admin-root'));
  }

  // ==================== 选择视图 ====================
  const outerStyle = isMobile ? {
    justifyContent: 'stretch',
    alignItems: 'stretch',
    padding: 0
  } : {
    justifyContent: 'center',
    alignItems: 'center'
  };
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm",
    style: Object.assign({ zIndex: 5001 }, outerStyle),
    tabIndex: -1,
    onClick: preventClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative bg-slate-900 flex flex-col",
    style: isMobile ? {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      borderRadius: 0,
      zIndex: 5001,
      overflow: 'hidden'
    } : {
      width: '520px',
      maxWidth: '95vw',
      borderRadius: '1rem',
      overflow: 'hidden',
      border: '1px solid rgba(51, 65, 85, 0.5)',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
    },
    onClick: e => e.stopPropagation(),
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "absolute -bottom-24 -left-24 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "relative z-10 flex flex-col",
    style: {
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 flex items-center justify-between px-6 pt-5 pb-3",
    style: isMobile ? {
      paddingTop: 'max(20px, env(safe-area-inset-top, 12px))'
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 min-w-0 flex-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5 text-white",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-[15px] font-bold text-white tracking-wide"
  }, "AI \u751F\u56FE\u8BBE\u7F6E"), /*#__PURE__*/React.createElement("p", {
    className: "text-[13px] text-slate-300 mt-1 leading-snug"
  }, "\u9009\u62E9\u6A21\u677F \xB7 \u8C03\u6574\u98CE\u683C \xB7 \u4E00\u952E\u751F\u6210"))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-all flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent mx-6"
  }), isMobile && /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 px-4 pt-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex bg-slate-800/60 rounded-lg p-0.5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMobileTemplateTab('prompt'),
    className: `flex-1 py-2 rounded-md text-[11px] font-medium transition-all ${mobileTemplateTab === 'prompt' ? 'bg-slate-700/80 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`
  }, "\uD83C\uDFAF \u63D0\u793A\u8BCD"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMobileTemplateTab('style'),
    className: `flex-1 py-2 rounded-md text-[11px] font-medium transition-all ${mobileTemplateTab === 'style' ? 'bg-slate-700/80 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`
  }, "\uD83C\uDFA8 \u5168\u5C40\u98CE\u683C"))), /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'flex-1 overflow-y-auto' : ''}`,
    style: isMobile ? {
      minHeight: 0
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    className: `transition-all duration-300 ${isMobile ? 'px-4 pt-2 pb-2' : 'px-6 pt-4 pb-3'} ${isMobile && mobileTemplateTab !== 'prompt' ? 'hidden' : ''} ${customPromptEnabled ? 'opacity-30 pointer-events-none' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400"
  }, "\u63D0\u793A\u8BCD"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setManageTab('prompt'),
    className: "w-5 h-5 rounded-md flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/80 transition-all",
    title: "\u7BA1\u7406\u63D0\u793A\u8BCD\u6A21\u677F"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3 h-3",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  }), /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  })))), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-600 font-mono"
  }, selectedPromptNames.length > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "text-emerald-400"
  }, "\u5DF2\u9009 ", selectedPromptNames.length, "/9") : /*#__PURE__*/React.createElement("span", null, "\u672A\u9009\u62E9"))), /*#__PURE__*/React.createElement("p", {
    className: `text-[10px] text-slate-600 leading-relaxed ${isMobile ? 'mb-2' : 'mb-3'}`
  }, "\u52A8\u4F5C\u3001\u8868\u60C5\u3001\u795E\u6001\u3001\u5929\u6C14\u7B49\uFF0C\u4E0E\u5168\u5C40\u98CE\u683C\u5185\u5BB9\u51B2\u7A81\u65F6\u4EE5\u5168\u5C40\u4E3A\u4E3B"), promptList.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, promptList.map(p => {
    const idx = selectedPromptNames.indexOf(p.name);
    const isSelected = idx !== -1;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => togglePrompt(p),
      disabled: customPromptEnabled || !isSelected && customPrompts.length >= 9,
      className: `relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${isSelected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'} ${!isSelected && customPrompts.length >= 9 || customPromptEnabled ? 'opacity-40 cursor-not-allowed' : ''}`
    }, isSelected && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-[8px] font-bold text-white shadow shadow-emerald-500/40"
    }, idx + 1), p.name);
  })) : /*#__PURE__*/React.createElement("button", {
    onClick: () => setManageTab('prompt'),
    className: "flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800/40 border border-dashed border-slate-700/40 hover:border-slate-600/60 text-[11px] text-slate-500 hover:text-slate-300 transition-all w-full justify-center"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M12 4v16m8-8H4"
  })), "\u6682\u65E0\u63D0\u793A\u8BCD\uFF0C\u70B9\u51FB\u521B\u5EFA"), selectedPromptNames.length > 0 && selectedPromptNames.length < 9 && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5 text-[10px] text-slate-600"
  }, "\u5269\u4F59 ", 9 - selectedPromptNames.length, " \u4E2A\u4F4D\u7F6E\u5C06\u4F7F\u7528\u9ED8\u8BA4\u98CE\u683C\u81EA\u52A8\u586B\u5145")), /*#__PURE__*/React.createElement("div", {
    className: `h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent ${isMobile ? 'mx-4' : 'mx-6'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `transition-all duration-300 ${isMobile ? 'px-4 py-2' : 'px-6 py-4'} ${isMobile && mobileTemplateTab !== 'style' ? 'hidden' : ''} ${customPromptEnabled ? 'opacity-30 pointer-events-none' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400"
  }, "\u5168\u5C40\u98CE\u683C"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setManageTab('style'),
    className: "w-5 h-5 rounded-md flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/80 transition-all",
    title: "\u7BA1\u7406\u5168\u5C40\u98CE\u683C"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3 h-3",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  }), /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  })))), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-600 font-mono"
  }, selectedStyleName ? /*#__PURE__*/React.createElement("span", {
    className: "text-violet-400"
  }, "\u5DF2\u9009\u62E9") : /*#__PURE__*/React.createElement("span", null, "\u672A\u9009\u62E9\uFF089\u56FE\u4E0D\u540C\u98CE\u683C\uFF09"))), /*#__PURE__*/React.createElement("p", {
    className: `text-[10px] text-slate-600 leading-relaxed ${isMobile ? 'mb-2' : 'mb-3'}`
  }, "\u9009\u62E9\u4E00\u4E2A\u98CE\u683C\u5E94\u7528\u5230\u6240\u6709\u751F\u6210\u7684\u56FE\u7247\uFF0C\u70B9\u51FB\u5DF2\u9009\u53EF\u53D6\u6D88"), styleList.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, styleList.map(p => {
    const isSelected = selectedStyleName === p.name;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => setSelectedStyleName(isSelected ? null : p.name),
      disabled: customPromptEnabled,
      className: `relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${isSelected ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-lg shadow-violet-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'} ${customPromptEnabled ? 'opacity-40 cursor-not-allowed' : ''}`
    }, isSelected && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-[8px] font-bold text-white shadow shadow-violet-500/40"
    }, "\u2713"), p.name);
  })) : /*#__PURE__*/React.createElement("button", {
    onClick: () => setManageTab('style'),
    className: "flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800/40 border border-dashed border-slate-700/40 hover:border-slate-600/60 text-[11px] text-slate-500 hover:text-slate-300 transition-all w-full justify-center"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M12 4v16m8-8H4"
  })), "\u6682\u65E0\u5168\u5C40\u98CE\u683C\uFF0C\u70B9\u51FB\u521B\u5EFA")), /*#__PURE__*/React.createElement("div", {
    className: `h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent ${isMobile ? 'mx-4' : 'mx-6'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'px-4 py-2' : 'px-6 py-4'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400 mb-3 block"
  }, "\u6BD4\u4F8B\u548C\u5206\u8FA8\u7387"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3 flex-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1.5"
  }, ['1:1', '4:3', '16:9'].map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    onClick: () => {
      setSelectedRatio(r);
      setSelectedSize(ratioSizeMap[r][0]);
    },
    className: `px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${selectedRatio === r ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'}`
  }, r))), selectedRatio === '4:3' && /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1.5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSelectedOrientation('landscape');
      setSelectedSize('1024x768');
    },
    className: `px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${selectedOrientation === 'landscape' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'}`
  }, "\u6A2A"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSelectedOrientation('portrait');
      setSelectedSize('768x1024');
    },
    className: `px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border active:scale-95 ${selectedOrientation === 'portrait' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'}`
  }, "\u7AD6")), /*#__PURE__*/React.createElement("select", {
    value: selectedSize,
    onChange: e => setSelectedSize(e.target.value),
    className: "w-[130px] px-2.5 py-1.5 rounded-lg text-[11px] bg-slate-800/60 border border-slate-700/50 text-slate-200 outline-none focus:border-blue-500/40 transition-all shrink-0"
  }, ratioSizeMap[selectedRatio].map(s => /*#__PURE__*/React.createElement("option", {
    key: s,
    value: s
  }, s))))), /*#__PURE__*/React.createElement("div", {
    className: `h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent ${isMobile ? 'mx-4' : 'mx-6'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'px-4 py-2' : 'px-6 py-4'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400 mb-3 block"
  }, "\u751F\u6210\u9009\u9879"), /*#__PURE__*/React.createElement("label", {
    title: !textModelEnabled ? '需要先开启文字模型（AI 分析）' : '',
    className: `flex items-center gap-5 px-4 py-3.5 rounded-xl border transition-all group ${!textModelEnabled || customPromptEnabled ? 'bg-slate-800/10 border-slate-700/20 cursor-not-allowed opacity-40' : 'bg-slate-800/40 border-slate-700/40 cursor-pointer hover:border-slate-600/60'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative w-14 h-7 rounded-full border-2 border-white/20 transition-all duration-300 flex-shrink-0 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `absolute inset-0 transition-all duration-300 ${similarImages ? 'bg-blue-500' : 'bg-slate-600'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${similarImages ? 'left-[30px]' : 'left-0.5'}`
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-200 font-medium group-hover:text-white transition-colors"
  }, "\u65E0\u9650\u60F3\u8C61"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-500 ml-2"
  }, "\u4F7F\u7528\u6587\u5B57\u6A21\u578B\u770B\u56FE+\u56FE\u7247\u6A21\u578B\u751F\u6210")), /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: similarImages,
    onChange: e => {
      if (!customPromptEnabled && textModelEnabled) setSimilarImages(e.target.checked);
    },
    disabled: !textModelEnabled || customPromptEnabled,
    className: "sr-only"
  }))), /*#__PURE__*/React.createElement("div", {
    className: `h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent ${isMobile ? 'mx-4' : 'mx-6'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `${isMobile ? 'px-4 py-2' : 'px-6 py-4'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400 mb-3 block"
  }, "\u5176\u4ED6\u9009\u9879"), /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-5 px-4 py-3.5 rounded-xl bg-slate-800/40 border border-slate-700/40 cursor-pointer hover:border-slate-600/60 transition-all group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative w-14 h-7 rounded-full border-2 border-white/70 transition-all duration-300 flex-shrink-0 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `absolute inset-0 transition-all duration-300 ${customPromptEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${customPromptEnabled ? 'left-[30px]' : 'left-0.5'}`
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-200 font-medium group-hover:text-white transition-colors"
  }, "\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-500 ml-2"
  }, "\u5F00\u542F\u540E\u81EA\u5B9A\u4E49\u63CF\u8FF0\uFF0C\u5176\u4F59\u9009\u9879\u81EA\u52A8\u7981\u7528")), /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: customPromptEnabled,
    onChange: e => {
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
    },
    className: "sr-only"
  })), customPromptEnabled && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 animate-[fadeIn_0.2s_ease-out]"
  }, /*#__PURE__*/React.createElement("textarea", {
    value: customPromptText,
    onChange: e => setCustomPromptText(e.target.value.slice(0, 500)),
    placeholder: "\u8F93\u5165\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\uFF0CAI \u5C06\u57FA\u4E8E\u539F\u56FE\u6309\u6B64\u63CF\u8FF0\u751F\u6210\u4E00\u5F20\u56FE\u7247\u2026",
    rows: 4,
    className: "w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-emerald-500/30 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 resize-none transition-all"
  }), /*#__PURE__*/React.createElement("p", {
    className: "text-[9px] text-slate-600 mt-1.5 ml-1"
  }, "\u6700\u591A 500 \u5B57\uFF0C\u4EC5\u7528\u4E8E\u672C\u6B21\u751F\u6210\uFF0C\u4E0D\u4F1A\u4FDD\u5B58")))), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 px-6 pb-6",
    style: isMobile ? {
      paddingBottom: 'max(16px, env(safe-area-inset-bottom, 8px))'
    } : {}
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onGenerate,
    disabled: genLoading || !result,
    className: "w-full py-3 rounded-xl text-sm font-bold tracking-wide bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-400 hover:to-violet-400 active:scale-[0.98] transition-all duration-200 text-white shadow-lg shadow-pink-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
  }, genLoading ? /*#__PURE__*/React.createElement("span", {
    className: "flex items-center justify-center gap-2"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "animate-spin h-4 w-4",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "\u751F\u6210\u4E2D\u2026") : /*#__PURE__*/React.createElement("span", {
    className: "flex items-center justify-center gap-2"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
  })), "\u751F\u6210 ", (() => {
    if (customPromptEnabled) return '1 张';
    const pc = selectedPromptNames.length;
    const hasGlobal = !!selectedStyleName;
    if (hasGlobal && pc === 0 && !similarImages) return '1 张';
    if (hasGlobal && pc > 0) return `${pc} 张`;
    if (pc > 1) return `${pc} 张`;
    return '9 张';
  })())))))), document.getElementById('admin-root'));
}
function AiGenGrid({
  images,
  progress,
  loading,
  error,
  imageHeight,
  progressPct,
  cellCount,
  total,
  onAddToHistory
}) {
  const [visible, setVisible] = React.useState(false);
  const [previewImg, setPreviewImg] = React.useState(null); // { url, index }
  const [addingToHistory, setAddingToHistory] = React.useState(false);
  const [addedToHistory, setAddedToHistory] = React.useState(false);
  const [gridDim, setGridDim] = React.useState(400); // 网格总尺寸（宽高相等）
  const gridRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const isMobile = useIsMobile();
  React.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // 用 ResizeObserver 跟踪容器尺寸，取容器宽高中较小值
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setGridDim(Math.max(100, isMobile ? rect.width : Math.min(rect.width, rect.height)));
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
      var prompt = images[previewImg.index]?.prompt || '';
      const fileId = await onAddRef.current(previewImg.url, prompt);
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
  return /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col flex-1 min-h-0 items-center w-full h-full"
  }, /*#__PURE__*/React.createElement("div", {
    ref: containerRef,
    className: `flex-1 min-h-0 w-full h-full transition-all duration-500 ease-out flex items-center justify-center ${visible ? 'opacity-100' : 'opacity-0'}`
  }, /*#__PURE__*/React.createElement("div", {
    ref: gridRef,
    className: "grid",
    style: {
      gridTemplateColumns: `repeat(3, ${cellW}px)`,
      gap: `${gap}px`,
      width: `${gridW}px`,
      height: `${gridH}px`
    }
  }, Array.from({
    length: 9
  }).map((_, i) => {
    // 跳过空位
    if (i >= displayCount) {
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "hidden"
      });
    }
    const img = images.find(im => im.index === i);
    const isDone = img && img.status === 'done';
    const isFailed = img && img.status === 'failed';
    // 生成结束后（取消/完成/失败），只显示成功的图片，隐藏转圈和失败框
    const generationEnded = !loading;
    if (generationEnded && !isDone) {
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "hidden"
      });
    }
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: `rounded-lg overflow-hidden bg-slate-900 border border-slate-800/50 relative transition-all duration-500 ease-out group ${isSingleImage ? 'row-span-3 col-span-3' : ''}`,
      style: {
        width: isSingleImage ? `${gridW}px` : `${cellW}px`,
        height: isSingleImage ? `${gridH}px` : `${cellW}px`,
        animation: visible && (images.length > i || loading && i < progress) ? `fadeSlideIn 0.3s ease-out ${i * 60}ms both` : 'none'
      }
    }, isDone ? /*#__PURE__*/React.createElement("img", {
      src: `${API_BASE}${img.url}`,
      alt: `生成图 ${i + 1}`,
      className: "w-full h-full object-cover group-hover:scale-110 transition-transform duration-300 cursor-pointer",
      onClick: () => setPreviewImg({
        url: `${API_BASE}${img.url}`,
        index: i
      })
    }) : isFailed ? /*#__PURE__*/React.createElement("div", {
      className: "w-full h-full flex items-center justify-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[8px] text-red-500/50"
    }, "\u5931\u8D25")) : /*#__PURE__*/React.createElement("div", {
      className: "w-full h-full flex items-center justify-center"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-4 h-4 rounded-full border border-slate-600 border-t-slate-400 animate-spin"
    })), !isSingleImage && /*#__PURE__*/React.createElement("div", {
      className: "absolute top-1 left-1 w-4 h-4 rounded bg-black/40 backdrop-blur-sm flex items-center justify-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[7px] text-slate-400 font-mono"
    }, i + 1)), img && img.label && /*#__PURE__*/React.createElement("div", {
      className: "absolute bottom-1 left-1 right-1 px-1 py-0.5 rounded bg-black/50 backdrop-blur-sm truncate"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[7px] text-slate-300 font-mono"
    }, img.label)));
  }))), loading && /*#__PURE__*/React.createElement("div", {
    className: "w-full flex items-center justify-center mt-3 transition-all duration-500 ease-out"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-full",
    style: {
      maxWidth: `${gridW}px`
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-blue-400 font-mono"
  }, progressPct, "%"), /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, progress, "/", total || 9)), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-2 bg-slate-800/80 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-500 rounded-full transition-all duration-500 ease-out",
    style: {
      width: `${progressPct}%`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 2s linear infinite'
    }
  })))), error && /*#__PURE__*/React.createElement("div", {
    className: "w-full flex items-center justify-center mt-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-3 rounded-lg bg-red-500/10 border border-red-500/20",
    style: {
      maxWidth: `${gridW}px`,
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-red-400"
  }, error))), previewImg && /*#__PURE__*/React.createElement("div", {
    className: "ai-gen-preview-overlay",
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)'
    },
    onClick: closePreview
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: isMobile ? {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(15,23,42,0.95)',
      overflow: 'hidden'
    } : {
      position: 'absolute',
      left: '2.5vw',
      top: '5vh',
      right: '2.5vw',
      bottom: '5vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(15,23,42,0.95)',
      borderRadius: '16px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 0',
      minHeight: 0,
      overflow: 'auto',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? 0 : '16px',
      padding: isMobile ? 0 : '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flex: '1 1 0',
      minHeight: 0,
      padding: '8px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: previewImg.url,
    alt: `生成图 ${previewImg.index + 1}`,
    style: {
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: isMobile ? '100%' : '240px',
      flexShrink: 0,
      background: 'rgba(30,41,59,0.9)',
      padding: '16px',
      borderRadius: isMobile ? 0 : '8px',
      border: '1px solid rgba(100,116,139,0.2)',
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      color: '#64748b',
      marginBottom: '8px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontWeight: 600
    }
  }, "\u63D0\u793A\u8BCD"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#94a3b8',
      fontSize: '13px',
      lineHeight: '1.7',
      wordBreak: 'break-word'
    }
  }, images[previewImg.index]?.prompt || '无提示词信息'), images[previewImg.index]?.label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '10px',
      color: '#475569',
      marginTop: '12px',
      borderTop: '1px solid rgba(100,116,139,0.15)',
      paddingTop: '8px'
    }
  }, "\u6807\u7B7E\uFF1A", images[previewImg.index].label))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 20px',
      background: 'rgba(15,23,42,0.98)',
      borderTop: '1px solid rgba(100,116,139,0.2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-400 font-mono"
  }, "#", previewImg.index + 1, " / ", displayCount), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => downloadImage(previewImg.url, previewImg.index),
    className: "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-400 hover:to-violet-400 active:scale-95 transition-all duration-200 text-white shadow-lg shadow-pink-500/25"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
  })), "\u4E0B\u8F7D\u539F\u56FE"), onAddToHistory && /*#__PURE__*/React.createElement("button", {
    onClick: addToHistory,
    disabled: addingToHistory || addedToHistory,
    className: `flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium
                      active:scale-95 transition-all duration-200
                      ${addedToHistory ? 'bg-emerald-600/80 text-emerald-100 cursor-default' : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/25'}
                      ${addingToHistory ? 'opacity-70 cursor-wait' : ''}
                    `
  }, addedToHistory ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M5 13l4 4L19 7"
  })), "\u5DF2\u4FDD\u5B58\u5230\u5386\u53F2") : addingToHistory ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5 animate-spin",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "\u4FDD\u5B58\u4E2D...") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M12 4v16m8-8H4"
  })), "\u6DFB\u52A0\u5230\u5386\u53F2")), /*#__PURE__*/React.createElement("button", {
    onClick: closePreview,
    className: "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all duration-200 text-slate-300"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  }))))))));
}

// AI 智能建议（手动触发）
function AiAdvice({
  fileId,
  onRequest
}) {
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
  return /*#__PURE__*/React.createElement("div", {
    className: "bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-xl p-3 border border-slate-700/50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 mb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-blue-400/80"
  }, "AI \u667A\u80FD\u5206\u6790")), !advice && !loading && !error && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 italic"
  }, "\u70B9\u51FB\u9876\u90E8\u300CAI \u5206\u6790\u300D\u6309\u94AE"), loading && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 text-xs text-slate-400"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "animate-spin h-3 w-3",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "opacity-25",
    cx: "12",
    cy: "12",
    r: "10",
    stroke: "currentColor",
    strokeWidth: "4",
    fill: "none"
  }), /*#__PURE__*/React.createElement("path", {
    className: "opacity-75",
    fill: "currentColor",
    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
  })), "AI\u6B63\u5728\u5206\u6790\u4E2D..."), error && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-400"
  }, "\u2022 ", error), advice && /*#__PURE__*/React.createElement("div", {
    className: "space-y-1.5",
    style: {
      color: '#e2e8f0'
    }
  }, advice.split('\n').filter(l => l.trim()).map((line, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "text-xs text-slate-200"
  }, line.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').replace(/^\*\*|\*\*$/g, '')))));
}

// 提示词管理面板（两步式 UI：选类型 → 列表 + 编辑）

// AnalysisModalBody 组件：分析弹窗内容
function AnalysisModalBody(props) {
  var loading = props.loading;
  var data = props.data;
  if (loading) {
    return /*#__PURE__*/React.createElement("div", { className: "flex items-center justify-center gap-2 text-sm text-slate-400 py-6" },
      /*#__PURE__*/React.createElement("svg", { className: "animate-spin h-4 w-4", viewBox: "0 0 24 24", fill: "none" },
        /*#__PURE__*/React.createElement("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }),
        /*#__PURE__*/React.createElement("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" })
      ),
      "AI \u6B63\u5728\u5206\u6790\u4E2D..."
    );
  }
  if (data) {
    var lines = data.split('\n').filter(function(l) { return l.trim(); });
    return /*#__PURE__*/React.createElement("div", { className: "space-y-1.5 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap" },
      lines.map(function(line, i) {
        return /*#__PURE__*/React.createElement("div", { key: i }, line.replace(/^\d+\.\s*/, '').replace(/\*\*/g, ''));
      })
    );
  }
  return /*#__PURE__*/React.createElement("div", { className: "text-sm text-slate-500 text-center py-6" }, "\u6682\u65E0\u5206\u6790\u7ED3\u679C");
}

// AnalysisModal 组件：移动端分析弹窗
function AnalysisModal(props) {
  var show = props.show;
  var data = props.data;
  var loading = props.loading;
  var onClose = props.onClose;
  if (!show) return null;
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    style: { position: "fixed", inset: 0, zIndex: 4000, background: "rgb(15,23,42)" },
    children: [
      /*#__PURE__*/React.createElement("button", {
        onClick: onClose,
        style: { position: "fixed", top: 12, right: 12, zIndex: 4001, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "rgba(30,41,59,0.9)", color: "rgb(203,213,225)", fontSize: 24 },
        children: "\u00D7"
      }),
      /*#__PURE__*/React.createElement("div", {
        style: { paddingTop: 60, paddingBottom: 20, paddingLeft: 20, paddingRight: 20, height: "100%", overflowY: "auto", boxSizing: "border-box" },
        children: /*#__PURE__*/React.createElement(AnalysisModalBody, { loading: loading, data: data })
      })
    ]
  }), document.getElementById('root'));
}

ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));