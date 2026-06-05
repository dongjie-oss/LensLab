const {
  useState,
  useRef,
  useEffect,
  useCallback
} = React;

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
    . {
      transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), margin-right 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    . {
      transform: translateX(-80px);
      margin-right: -80px;
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
  if (!points || !visible) return null;
  const scaleX = imageWidth / width;
  const scaleY = imageHeight / height;
  return /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 pointer-events-none"
  }, points.map((p, i) => {
    const left = p.cx / width * imageWidth;
    const top = p.cy / height * imageHeight;
    const color = evColor(p.ev);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "absolute transform -translate-x-1/2 -translate-y-1/2 metering-dot",
      style: {
        left,
        top,
        color
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute w-4 h-[1px] bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute w-[1px] h-4 bg-current/40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    }), /*#__PURE__*/React.createElement("div", {
      className: "absolute left-1/2 -translate-x-1/2 whitespace-nowrap flex flex-col items-center gap-0.5",
      style: {
        top: 18
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-medium text-white/80 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm"
    }, p.name), /*#__PURE__*/React.createElement("span", {
      className: "text-xs font-bold mono px-1.5 py-0.5 rounded backdrop-blur-sm border",
      style: {
        backgroundColor: `${color}33`,
        color: color,
        borderColor: `${color}55`
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
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, modes.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.key,
    onClick: () => onChange(current === m.key ? null : m.key),
    className: `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${current === m.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:border-slate-600'}`
  }, m.name, /*#__PURE__*/React.createElement("span", {
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
  }, item.filename), /*#__PURE__*/React.createElement("div", {
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
  const [showAdmin, setShowAdmin] = useState(false);
  const toggleAdmin = () => setShowAdmin(v => !v);
  const imgRef = useRef(null);
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
  const [showPromptPanel, setShowPromptPanel] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState([]);
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptEditId, setPromptEditId] = useState(null);
  const [promptType, setPromptType] = useState('prompt'); // 'prompt' or 'style'
  const [customPrompts, setCustomPrompts] = useState([]); // [{name, content, order}]
  const [selectedPromptNames, setSelectedPromptNames] = useState([]);
  const [showAiGenPanel, setShowAiGenPanel] = useState(false);
  const [selectedStyleName, setSelectedStyleName] = useState(null); // 全局风格（单选，可反选）
  const [similarImages, setSimilarImages] = useState(false);
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
  const savePrompt = async () => {
    if (!promptName.trim() || !promptContent.trim()) return;
    const fd = new FormData();
    fd.append('id', promptEditId || '');
    fd.append('name', promptName.trim());
    fd.append('content', promptContent.trim());
    fd.append('type', promptType);
    await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      body: fd
    });
    await loadPrompts();
    setPromptName('');
    setPromptContent('');
    setPromptEditId(null);
    setPromptType('prompt');
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
    loadPrompts();
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

  // AI 生图
  const startGeneration = async (fileId, options = {}) => {
    const {
      similar = false,
      selectedStyleName = null
    } = options;
    // 🔴 先计算 numImages，再 set state
    const promptCount = customPrompts.length;
    const hasGlobal = !!selectedStyleName;
    let numImages = 9;
    if (hasGlobal && promptCount === 0 && !similar) {
      numImages = 1; // 只选全局风格 → 1张占满9格
    } else if (!hasGlobal && promptCount === 1 && similar) {
      numImages = 9; // 1个提示词+类似图片 → 9张(1号提示词+2-9类似)
    } else if (!hasGlobal && promptCount > 1) {
      numImages = promptCount; // 多个提示词无全局 → N张
    } else if (hasGlobal && promptCount > 0) {
      numImages = promptCount; // 全局+提示词 → N张
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
      if (selectedStyleName) {
        const tpl = promptTemplates.find(p => p.name === selectedStyleName);
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
      setMode(null);
      setGenImages([]);
      setShowOverlay(true);
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
      setFile(null);
    }
  };

  // 图片加载后获取实际显示尺寸
  const onImageLoad = () => {
    if (imgRef.current) {
      setImageDims({
        w: imgRef.current.clientWidth,
        h: imgRef.current.clientHeight
      });
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "flex h-screen overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-64 bg-[#0d1117] border-r border-slate-800 flex flex-col"
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
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex flex-col overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-14 bg-[#0d1117] border-b border-slate-800 flex items-center justify-between px-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-4"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-500"
  }, "\u533A\u57DF\u6A21\u5F0F"), /*#__PURE__*/React.createElement(ModeSelector, {
    modes: modes,
    current: mode,
    onChange: setMode
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-2 text-xs text-slate-400 cursor-pointer"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: showOverlay,
    onChange: e => setShowOverlay(e.target.checked),
    className: "rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
  }), "\u663E\u793A\u6D4B\u5149\u70B9"), result && result.ai_enabled && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => aiAdviceRef.current?.(),
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
    d: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
  })), "AI \u5206\u6790"), genLoading && /*#__PURE__*/React.createElement("button", {
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
  })), "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowPromptPanel(true);
      loadPrompts();
    },
    className: "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 bg-gradient-to-br from-slate-700/60 to-slate-800/80 hover:from-purple-500/25 hover:to-purple-600/20 border border-slate-600/50 hover:border-purple-500/40 text-slate-200 hover:text-purple-300",
    title: "\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD"
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
  }))), selectedPromptNames.length > 0 && /*#__PURE__*/React.createElement("div", {
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
      loadPrompts();
      setShowAiGenPanel(true);
    },
    disabled: genLoading || showAiGenPanel,
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
  })), "\u751F\u6210\u4E2D ", genProgress > 0 ? `${genProgress}/9` : '') : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("svg", {
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
    className: "flex-1 overflow-auto flex items-center justify-center p-8 bg-[#080b12]"
  }, !preview ? /*#__PURE__*/React.createElement("div", {
    className: `drop-zone w-full max-w-lg aspect-video rounded-2xl flex flex-col items-center justify-center cursor-pointer ${dragOver ? 'drag-over' : ''}`,
    onDragOver: e => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: onDrop,
    onClick: () => fileInputRef.current?.click()
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-12 h-12 text-slate-600 mb-4",
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
  }, "\u652F\u6301 JPG / PNG")) : /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-6 transition-all duration-500 ease-out"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "image-container"
  }, /*#__PURE__*/React.createElement("img", {
    ref: imgRef,
    src: preview,
    alt: "preview",
    onLoad: onImageLoad,
    className: "rounded-lg shadow-2xl max-h-[75vh]"
  }), /*#__PURE__*/React.createElement(MeteringOverlay, {
    points: result?.metering_points,
    width: result?.width,
    height: result?.height,
    imageWidth: imageDims.w,
    imageHeight: imageDims.h,
    visible: showOverlay && result && mode
  }))), (genLoading || genImages.length > 0) && /*#__PURE__*/React.createElement(AiGenGrid, {
    images: genImages,
    progress: genProgress,
    loading: genLoading,
    error: genError,
    imageHeight: imageDims.h,
    total: genTotal,
    progressPct: genProgress > 0 ? Math.round(genProgress / genTotal * 100) : 0
  })))), /*#__PURE__*/React.createElement("div", {
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
  })), result.ai_enabled && /*#__PURE__*/React.createElement(AiAdvice, {
    fileId: result.file_id,
    onRequest: aiAdviceRef
  }))), showAdmin && ReactDOM.createPortal(/*#__PURE__*/React.createElement(AdminPanel, {
    onClose: () => setShowAdmin(false)
  }), document.getElementById('admin-root')), showPromptPanel && ReactDOM.createPortal(/*#__PURE__*/React.createElement(PromptPanel, {
    prompts: promptTemplates,
    promptName: promptName,
    setPromptName: setPromptName,
    promptContent: promptContent,
    setPromptContent: setPromptContent,
    promptEditId: promptEditId,
    setPromptEditId: setPromptEditId,
    promptType: promptType,
    setPromptType: setPromptType,
    onSave: savePrompt,
    onDelete: deletePrompt,
    onClose: () => setShowPromptPanel(false)
  }), document.getElementById('admin-root')), showAiGenPanel && ReactDOM.createPortal(/*#__PURE__*/React.createElement(AiGenPanel, {
    prompts: promptTemplates,
    customPrompts: customPrompts,
    setCustomPrompts: setCustomPrompts,
    selectedPromptNames: selectedPromptNames,
    setSelectedPromptNames: setSelectedPromptNames,
    selectedStyleName: selectedStyleName,
    setSelectedStyleName: setSelectedStyleName,
    similarImages: similarImages,
    setSimilarImages: setSimilarImages,
    genLoading: genLoading,
    onGenerate: () => startGeneration(result.file_id, {
      similarImages,
      selectedStyleName
    }),
    onClose: () => setShowAiGenPanel(false)
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
  genLoading,
  onGenerate,
  onClose
}) {
  const promptList = (prompts || []).filter(p => (p.type || 'prompt') === 'prompt');
  const styleList = (prompts || []).filter(p => (p.type || 'prompt') === 'style');
  const togglePrompt = p => {
    if (selectedPromptNames.includes(p.name)) {
      // 取消选中
      setSelectedPromptNames(selectedPromptNames.filter(n => n !== p.name));
      setCustomPrompts(customPrompts.filter(cp => cp.name !== p.name));
    } else if (customPrompts.length < 9) {
      // 选中（追加到末尾，按点击顺序）
      setSelectedPromptNames([...selectedPromptNames, p.name]);
      setCustomPrompts([...customPrompts, {
        name: p.name,
        content: p.content,
        order: customPrompts.length
      }]);
    }
  };
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative w-[520px] max-w-[95vw] rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/50 shadow-2xl shadow-black/50",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "absolute -bottom-24 -left-24 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "relative z-10"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-6 pt-5 pb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/25"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-4 h-4 text-white",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-bold text-white tracking-wide"
  }, "AI \u751F\u56FE\u8BBE\u7F6E"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, "\u9009\u62E9\u6A21\u677F \xB7 \u8C03\u6574\u98CE\u683C \xB7 \u4E00\u952E\u751F\u6210"))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-all"
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
    className: "h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent mx-6"
  }), /*#__PURE__*/React.createElement("div", {
    className: "px-6 pt-4 pb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400"
  }, "\u63D0\u793A\u8BCD"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-600 font-mono"
  }, selectedPromptNames.length > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "text-emerald-400"
  }, "\u5DF2\u9009 ", selectedPromptNames.length, "/9") : /*#__PURE__*/React.createElement("span", null, "\u672A\u9009\u62E9"))), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-600 mb-3 leading-relaxed"
  }, "\u52A8\u4F5C\u3001\u8868\u60C5\u3001\u795E\u6001\u3001\u5929\u6C14\u7B49\uFF0C\u4E0E\u5168\u5C40\u98CE\u683C\u5185\u5BB9\u51B2\u7A81\u65F6\u4EE5\u5168\u5C40\u5185\u5BB9\u4E3A\u4E3B"), promptList.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, promptList.map(p => {
    const idx = selectedPromptNames.indexOf(p.name);
    const isSelected = idx !== -1;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => togglePrompt(p),
      disabled: !isSelected && customPrompts.length >= 9,
      className: `relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${isSelected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'} ${!isSelected && customPrompts.length >= 9 ? 'opacity-40 cursor-not-allowed' : ''}`
    }, isSelected && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-[8px] font-bold text-white shadow shadow-emerald-500/40"
    }, idx + 1), p.name);
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-center py-6"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-600"
  }, "\u6682\u65E0\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u8BF7\u5148\u5728\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u9762\u677F\u4E2D\u521B\u5EFA")), selectedPromptNames.length > 0 && selectedPromptNames.length < 9 && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-[10px] text-slate-600"
  }, "\u5269\u4F59 ", 9 - selectedPromptNames.length, " \u4E2A\u4F4D\u7F6E\u5C06\u4F7F\u7528\u9ED8\u8BA4\u98CE\u683C\u81EA\u52A8\u586B\u5145")), /*#__PURE__*/React.createElement("div", {
    className: "h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6"
  }), /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400"
  }, "\u5168\u5C40\u98CE\u683C"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-600 font-mono"
  }, selectedStyleName ? /*#__PURE__*/React.createElement("span", {
    className: "text-violet-400"
  }, "\u5DF2\u9009\u62E9") : /*#__PURE__*/React.createElement("span", null, "\u672A\u9009\u62E9\uFF089\u56FE\u4E0D\u540C\u98CE\u683C\uFF09"))), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-600 mb-3 leading-relaxed"
  }, "\u9009\u62E9\u4E00\u4E2A\u98CE\u683C\u5E94\u7528\u5230\u6240\u6709\u751F\u6210\u7684\u56FE\u7247\uFF0C\u70B9\u51FB\u5DF2\u9009\u53EF\u53D6\u6D88"), styleList.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, styleList.map(p => {
    const isSelected = selectedStyleName === p.name;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => setSelectedStyleName(isSelected ? null : p.name),
      className: `relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all duration-200 border active:scale-95 ${isSelected ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-lg shadow-violet-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600 hover:text-slate-300 hover:bg-slate-800/80'}`
    }, isSelected && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-[8px] font-bold text-white shadow shadow-violet-500/40"
    }, "\u2713"), p.name);
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-center py-6"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] text-slate-600"
  }, "\u6682\u65E0\u5168\u5C40\u98CE\u683C\u6A21\u677F\uFF0C\u8BF7\u5148\u5728\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u9762\u677F\u4E2D\u521B\u5EFA"))), /*#__PURE__*/React.createElement("div", {
    className: "h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mx-6"
  }), /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-medium text-slate-400 mb-3 block"
  }, "\u751F\u6210\u9009\u9879"), /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-5 px-4 py-3.5 rounded-xl bg-slate-800/40 border border-slate-700/40 cursor-pointer hover:border-slate-600/60 transition-all group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative w-14 h-7 rounded-full border-2 border-white/70 transition-all duration-300 flex-shrink-0 overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `absolute inset-0 transition-all duration-300 ${similarImages ? 'bg-blue-500' : 'bg-slate-600'}`
  }), /*#__PURE__*/React.createElement("div", {
    className: `absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${similarImages ? 'left-[30px]' : 'left-0.5'}`
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-slate-200 font-medium group-hover:text-white transition-colors"
  }, "\u751F\u6210\u7C7B\u4F3C\u56FE\u7247"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-500 ml-2"
  }, "\u63D0\u793A\u8BCD\u4E2D\u52A0\u5165\u300C\u53C2\u7167\u539F\u56FE\u5185\u5BB9\u751F\u6210\u300D")), /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: similarImages,
    onChange: e => setSimilarImages(e.target.checked),
    className: "sr-only"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "px-6 pb-6"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      onGenerate();
      onClose();
    },
    disabled: genLoading,
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
    d: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
  })), "\u751F\u6210 ", (() => {
    const pc = selectedPromptNames.length;
    const hasGlobal = !!selectedStyleName;
    if (hasGlobal && pc === 0 && !similarImages) return '1 张';
    if (pc > 0 && hasGlobal) return `${pc} 张`;
    if (pc > 1) return `${pc} 张`;
    return '9 张';
  })())))))), document.getElementById('admin-root'));
}

// AI 生图网格（支持1张占满9格、N张≤9格、空位隐藏）
function AiGenGrid({
  images,
  progress,
  loading,
  error,
  imageHeight,
  progressPct,
  cellCount,
  total
}) {
  const [visible, setVisible] = React.useState(false);
  const [previewImg, setPreviewImg] = React.useState(null); // { url, index }
  const gridRef = React.useRef(null);
  React.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // 根据图片高度计算网格尺寸
  const imgH = imageHeight || 400;
  const gap = 4; // 4px gap
  const cellW = Math.floor((imgH - gap * 2) / 3);
  const gridW = cellW * 3 + gap * 2;
  const gridH = gridW;

  // 计算需要展示的格子数（用 total，不用 images.length，因为加载时 images 为空）
  const displayCount = total || 9;
  // 单图模式：只生成1张 → 占满整个3×3网格
  const isSingleImage = total === 1;

  // 关闭预览
  const closePreview = () => setPreviewImg(null);

  // 下载图片
  const downloadImage = (imgUrl, index) => {
    const link = document.createElement('a');
    link.href = imgUrl;
    link.download = `exposure-lab-ai-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: `flex-shrink-0 transition-all duration-500 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`,
    style: {
      width: `${gridW}px`,
      height: `${gridH}px`
    }
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
  })), loading && /*#__PURE__*/React.createElement("div", {
    className: "mt-2",
    style: {
      width: `${gridW}px`
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-0.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[9px] text-blue-400 font-mono"
  }, progressPct, "%"), /*#__PURE__*/React.createElement("span", {
    className: "text-[9px] text-slate-500"
  }, progress, "/", total || 9)), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-1 bg-slate-800/80 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-500 rounded-full transition-all duration-500 ease-out",
    style: {
      width: `${progressPct}%`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 2s linear infinite'
    }
  }))), error && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20",
    style: {
      width: `${gridW}px`
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-red-400"
  }, error))), previewImg && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm",
    onClick: closePreview
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative max-w-[80vw] max-h-[85vh] rounded-2xl overflow-hidden animate-[fadeIn_0.2s_ease-out]",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("img", {
    src: previewImg.url,
    alt: `生成图 ${previewImg.index + 1}`,
    className: "max-w-full max-h-[75vh] object-contain rounded-t-2xl"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-5 py-3 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/60"
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
  })), "\u4E0B\u8F7D\u539F\u56FE"), /*#__PURE__*/React.createElement("button", {
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

// 提示词管理面板
function PromptPanel({
  prompts,
  promptName,
  setPromptName,
  promptContent,
  setPromptContent,
  promptEditId,
  setPromptEditId,
  promptType,
  setPromptType,
  onSave,
  onDelete,
  onClose
}) {
  const [localName, setLocalName] = React.useState(promptName || '');
  const [localContent, setLocalContent] = React.useState(promptContent || '');
  const [localType, setLocalType] = React.useState(promptType || 'prompt');
  React.useEffect(() => {
    setLocalName(promptName || '');
    setLocalContent(promptContent || '');
    setLocalType(promptType || 'prompt');
  }, [promptName, promptContent, promptType]);
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-[600px] max-w-[90vw] max-h-[85vh] bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between px-5 py-3 bg-slate-900/95 border-b border-slate-800/60"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold text-white"
  }, "\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u6A21\u677F"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
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
    className: "flex-1 p-5 overflow-y-auto space-y-5"
  }, prompts.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[11px] font-medium text-slate-400"
  }, "\u5DF2\u4FDD\u5B58\u7684\u6A21\u677F")), prompts.map(p => {
    const ptype = p.type || 'prompt';
    return /*#__PURE__*/React.createElement("div", {
      key: p.id,
      className: "flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/40"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", {
      className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${ptype === 'style' ? 'text-violet-300 bg-violet-500/20' : 'text-emerald-300 bg-emerald-500/20'}`
    }, ptype === 'style' ? '全局风格' : '提示词'), /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-medium text-white truncate"
    }, p.name)), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] text-slate-500 truncate mt-0.5"
    }, p.content.substring(0, 80), p.content.length > 80 ? '...' : '')), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setLocalName(p.name);
        setLocalContent(p.content);
        setLocalType(ptype);
        setPromptEditId(p.id);
      },
      className: "px-2 py-1 rounded text-[10px] bg-slate-700/50 hover:bg-blue-500/20 text-slate-400 hover:text-blue-300 transition-all flex-shrink-0"
    }, "\u7F16\u8F91"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (confirm('删除此模板?')) onDelete(p.id);
      },
      className: "px-2 py-1 rounded text-[10px] bg-slate-700/50 hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition-all flex-shrink-0"
    }, "\u5220\u9664"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[11px] font-medium text-slate-400"
  }, promptEditId ? '编辑模板' : '新建模板'), /*#__PURE__*/React.createElement("input", {
    value: localName,
    onChange: e => setLocalName(e.target.value),
    placeholder: "\u6A21\u677F\u540D\u79F0\uFF08\u5982\uFF1A\u65E5\u7CFB\u6E05\u65B0\u98CE\uFF09",
    className: "w-full px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700/50 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 transition-all"
  }), /*#__PURE__*/React.createElement("textarea", {
    value: localContent,
    onChange: e => setLocalContent(e.target.value),
    placeholder: "\u8F93\u5165\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD\u2026",
    rows: 4,
    className: "w-full px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700/50 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/40 transition-all resize-none"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-500 mb-2 block"
  }, "\u7C7B\u578B\uFF08\u4E8C\u9009\u4E00\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setLocalType('prompt'),
    className: `flex-1 px-3 py-2 rounded-lg text-[11px] font-medium border transition-all ${localType === 'prompt' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'}`
  }, "\u63D0\u793A\u8BCD", /*#__PURE__*/React.createElement("div", {
    className: "text-[9px] mt-0.5 opacity-60"
  }, "\u52A8\u4F5C\u3001\u8868\u60C5\u3001\u795E\u6001\u3001\u5929\u6C14\u7B49")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setLocalType('style'),
    className: `flex-1 px-3 py-2 rounded-lg text-[11px] font-medium border transition-all ${localType === 'style' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-lg shadow-violet-500/10' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'}`
  }, "\u5168\u5C40\u98CE\u683C", /*#__PURE__*/React.createElement("div", {
    className: "text-[9px] mt-0.5 opacity-60"
  }, "\u6240\u6709\u56FE\u7247\u5171\u7528\u4E00\u79CD\u98CE\u683C")))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-500"
  }, localContent.length, " \u5B57"), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, promptEditId && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setPromptEditId(null);
      setLocalName('');
      setLocalContent('');
      setLocalType('prompt');
    },
    className: "px-3 py-1.5 rounded-lg text-[11px] bg-slate-700/50 hover:bg-slate-700/80 text-slate-400 transition-all"
  }, "\u53D6\u6D88\u7F16\u8F91"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (!localName.trim() || !localContent.trim()) return;
      setPromptName(localName);
      setPromptContent(localContent);
      setPromptType(localType);
      onSave();
    },
    className: "px-3 py-1.5 rounded-lg text-[11px] bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 transition-all disabled:opacity-40",
    disabled: !localName.trim() || !localContent.trim()
  }, "\u4FDD\u5B58")))), /*#__PURE__*/React.createElement("div", {
    className: "border-t border-slate-800/60 pt-4"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] text-slate-500 leading-relaxed"
  }, /*#__PURE__*/React.createElement("strong", null, "\u63D0\u793A\u8BCD"), "\uFF1A\u52A8\u4F5C\u3001\u8868\u60C5\u3001\u795E\u6001\u3001\u5929\u6C14\u7B49\u975E\u98CE\u683C\u5185\u5BB9\uFF0C\u5728 AI \u751F\u56FE\u8BBE\u7F6E\u4E2D\u53EF\u591A\u9009\u3002", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("strong", null, "\u5168\u5C40\u98CE\u683C"), "\uFF1A\u6240\u6709\u56FE\u7247\u5171\u7528\u4E00\u79CD\u98CE\u683C\uFF0C\u5728 AI \u751F\u56FE\u8BBE\u7F6E\u4E2D\u5355\u9009\u3002", /*#__PURE__*/React.createElement("br", null), "\u4FDD\u5B58\u540E\u7684\u6A21\u677F\u53EF\u4EE5\u5728 AI \u751F\u56FE\u8BBE\u7F6E\u4E2D\u8C03\u7528\u3002"))))), document.getElementById('admin-root'));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));