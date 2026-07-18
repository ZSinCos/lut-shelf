(function () {
  const state = {
    rootPath: null,
    treeData: null,
    currentLutPath: null,
    currentLut: null,
    sourceImage: null,
    sourceFileName: '',
    lutIntensity: 100,
    compareMode: false,
  };

  const els = {
    canvas: document.getElementById('previewCanvas'),
    container: document.getElementById('canvasContainer'),
    placeholder: document.getElementById('placeholder'),
    folderTree: document.getElementById('folderTree'),
    imageInput: document.getElementById('imageInput'),
    loadDirBtn: document.getElementById('loadDirBtn'),
    headerPath: document.getElementById('headerPath'),
    toggleCompareBtn: document.getElementById('toggleCompareBtn'),
    fitViewBtn: document.getElementById('fitViewBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportFormat: document.getElementById('exportFormat'),
    intensitySlider: document.getElementById('intensitySlider'),
    intensityValue: document.getElementById('intensityValue'),
    statusText: document.getElementById('statusText'),
    infoEmpty: document.getElementById('infoEmpty'),
    infoContent: document.getElementById('infoContent'),
    infoName: document.getElementById('infoName'),
    infoAuthor: document.getElementById('infoAuthor'),
    infoDesc: document.getElementById('infoDesc'),
    infoFormat: document.getElementById('infoFormat'),
    infoSize: document.getElementById('infoSize'),
    infoPath: document.getElementById('infoPath'),
    infoPreviewCanvas: document.getElementById('infoPreviewCanvas'),
  };

  const isElectron = !!window.electronAPI;
  const RAW_EXTS = ['rw2', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'dng', 'pef', 'srw', 'x3f'];

  let ctx = els.canvas.getContext('2d');
  let origCache = document.createElement('canvas');
  let origCtx = origCache.getContext('2d');
  let lutCache = document.createElement('canvas');
  let lutCtx = lutCache.getContext('2d');
  let cacheValid = false;
  let resizeTimer = null;

  let webglCanvas = null;
  let webgl = null;
  let useWebgl = false;

  function initWebGL() {
    webglCanvas = document.createElement('canvas');
    webgl = new LUTWebGL(webglCanvas);
    useWebgl = webgl.supported;
  }
  initWebGL();

  /* ── Thumb source ── */

  let thumbSourceImg = null;
  const THUMB_SIZE = 64;

  async function initThumbSource() {
    if (!isElectron) return;
    try {
      const src = await window.electronAPI.thumbGetSource();
      if (src) {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = `data:image/jpeg;base64,${src.data}`;
        });
        thumbSourceImg = img;
      }
    } catch (e) {
      thumbSourceImg = null;
    }
  }

  (async () => {
    if (isElectron) {
      const existing = await window.electronAPI.thumbGetSource();
      if (!existing) {
        const rw2Path = 'C:\\Users\\SinCos\\Desktop\\P1011709.RW2';
        await window.electronAPI.thumbSetSource(rw2Path);
      }
    }
    await initThumbSource();
  })();

  function thumbCacheKey(lutName, size, type) {
    const raw = `${lutName}|${size}|${type}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  async function generatePreview(lut, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    if (thumbSourceImg) {
      const s = thumbSourceImg;
      const scale = Math.max(w / s.width, h / s.height);
      const sw = s.width * scale, sh = s.height * scale;
      const sx = (sw - w) / 2, sy = (sh - h) / 2;
      cx.drawImage(s, 0, 0, s.width, s.height, -sx, -sy, sw, sh);
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          cx.fillStyle = `rgb(${x/w*255|0},${y/h*255|0},${128+64*Math.sin((x+y)/(w)*Math.PI)|0})`;
          cx.fillRect(x, y, 1, 1);
        }
      }
    }
    const imgData = cx.getImageData(0, 0, w, h);
    LUTApply.applyLUT(imgData, lut);
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  /* ── Folder tree ── */

  els.loadDirBtn.addEventListener('click', async () => {
    if (!isElectron) return;
    const dir = await window.electronAPI.selectDir();
    if (!dir) return;
    state.rootPath = dir;
    els.headerPath.textContent = dir;
    setStatus('正在扫描...');
    const tree = await window.electronAPI.scanTree(dir);
    state.treeData = tree;
    renderTree();
    setStatus(`已加载 ${countFiles(tree)} 个 LUT`);
  });

  function countFiles(node) {
    let n = node.files.length;
    for (const f of node.folders) n += countFiles(f.children);
    return n;
  }

  function renderTree() {
    els.folderTree.innerHTML = '';
    if (!state.treeData) {
      els.folderTree.innerHTML = '<div class="empty-state"><p>点击上方「选择目录」</p></div>';
      return;
    }
    const ul = document.createElement('div');
    renderTreeNodes(state.treeData, '', ul);
    els.folderTree.appendChild(ul);
  }

  function renderTreeNodes(node, prefix, container) {
    for (const f of node.folders) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (prefix ? 8 : 0) + 'px';

      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = '▶';
      item.appendChild(toggle);

      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = '📁';
      item.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = f.name;
      item.appendChild(label);

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = childrenDiv.classList.toggle('open');
        toggle.classList.toggle('expanded', isOpen);
      });

      container.appendChild(item);
      container.appendChild(childrenDiv);
      renderTreeNodes(f.children, prefix + '  ', childrenDiv);
    }

    for (const f of node.files) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (prefix ? 20 : 0) + 'px';
      item.dataset.path = f.path;

      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.style.visibility = 'hidden';
      toggle.textContent = '▶';
      item.appendChild(toggle);

      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = '📄';
      item.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = f.name;
      item.appendChild(label);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectLutFile(f);
      });

      container.appendChild(item);
    }
  }

  /* ── Select LUT ── */

  async function selectLutFile(fileInfo) {
    // Deselect all
    els.folderTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    const item = els.folderTree.querySelector(`[data-path="${fileInfo.path}"]`);
    if (item) item.classList.add('active');

    state.currentLutPath = fileInfo.path;

    const content = await window.electronAPI.readFile(fileInfo.path);
    if (!content) { setStatus('读取失败'); return; }

    const lut = LUTParser.parseLUTFromText(fileInfo.name, content);
    state.currentLut = lut;

    setStatus(`已加载: ${fileInfo.name}`);

    // Show info panel
    showInfo(lut, fileInfo);

    // Render preview on main canvas if we have an image
    if (state.sourceImage) {
      cacheValid = false;
      renderPreview();
    } else {
      // Auto-load reference image for preview
      await loadDefaultImage();
    }
  }

  /* ── Info panel ── */

  function guessAuthor(lutPath, lutName) {
    const rel = lutPath.replace(state.rootPath, '');
    const parts = rel.split(/[/\\]/).filter(Boolean);
    // Look for author hints: folder name patterns like "ejay xxx", "波子Booz xxx", "Plady Chan xxx"
    for (const p of parts) {
      const known = ['ejay', '波子', 'booz', 'plady', '林馆长', '凉子', 'forrest'];
      for (const k of known) {
        if (p.toLowerCase().includes(k)) return p;
      }
    }
    return '';
  }

  function guessDescription(lutPath, lutName) {
    const rel = lutPath.replace(state.rootPath, '');
    const parts = rel.split(/[/\\]/).filter(Boolean);
    const clues = [];
    for (const p of parts) {
      // Extract meaningful descriptions from folder names
      if (p.includes('胶片')) clues.push('胶片风格');
      if (p.includes('日系')) clues.push('日系风格');
      if (p.includes('电影')) clues.push('电影感');
      if (p.includes('人像')) clues.push('人像优化');
      if (p.includes('肤色')) clues.push('肤色优化');
      if (p.includes('黑白')) clues.push('黑白风格');
      if (p.includes('青橙')) clues.push('青橙色调');
      if (p.includes('复古')) clues.push('复古风格');
      if (p.includes('夜景')) clues.push('夜景优化');
      if (p.includes('vlog') || p.includes('V-Log')) clues.push('基于 V-Log');
      if (p.includes('raw') || p.includes('RAW')) clues.push('基于 RAW');
      if (p.includes('新经典')) clues.push('基于新经典模式');
      if (p.includes('标准')) clues.push('基于标准模式');
      if (p.includes('直出')) clues.push('直出可用');
      if (p.includes('机内')) clues.push('支持机内烧录');
      if (p.includes('后期')) clues.push('后期处理');
      if (p.includes('监')) clues.push('机内监视用');
    }
    const unique = [...new Set(clues)];
    return unique.length > 0 ? unique.join('，') : '';
  }

  function showInfo(lut, fileInfo) {
    els.infoEmpty.style.display = 'none';
    els.infoContent.style.display = 'block';
    const panel = document.getElementById('infoPanel');
    panel.style.width = '';
    panel.style.overflow = '';
    document.getElementById('splitterRight').style.display = '';

    els.infoName.textContent = lut.name;
    els.infoAuthor.textContent = guessAuthor(fileInfo.path, lut.name) || '未知';
    els.infoDesc.textContent = guessDescription(fileInfo.path, lut.name) || '无说明';
    els.infoFormat.textContent = lut.type.toUpperCase();
    els.infoSize.textContent = `${lut.size}³`;
    els.infoPath.textContent = fileInfo.path;

    // Generate preview image
    const pw = els.infoPreviewCanvas.width = 320;
    const ph = els.infoPreviewCanvas.height = 180;
    const pctx = els.infoPreviewCanvas.getContext('2d');

    if (thumbSourceImg) {
      generatePreview(lut, pw, ph).then(c => {
        pctx.clearRect(0, 0, pw, ph);
        pctx.drawImage(c, 0, 0);
      });
    } else {
      pctx.fillStyle = '#0f3460';
      pctx.fillRect(0, 0, pw, ph);
      pctx.fillStyle = '#8899aa';
      pctx.font = '12px sans-serif';
      pctx.textAlign = 'center';
      pctx.fillText('加载参考图中...', pw / 2, ph / 2);
      // Will retry when thumb source loads
    }
  }

  /* ── Image handling ── */

  async function loadDefaultImage() {
    if (!thumbSourceImg) return;
    state.sourceImage = thumbSourceImg;
    state.sourceFileName = '参考图';
    fitCanvas();
    if (state.currentLut) {
      cacheValid = false;
      renderPreview();
    }
  }

  els.imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await loadImageFile(file);
    } catch (err) {
      setStatus('图片加载失败');
    }
  });

  els.container.addEventListener('dragover', (e) => { e.preventDefault(); els.container.style.outline = '2px dashed var(--accent)'; });
  els.container.addEventListener('dragleave', () => { els.container.style.outline = ''; });
  els.container.addEventListener('drop', async (e) => {
    e.preventDefault();
    els.container.style.outline = '';
    const file = Array.from(e.dataTransfer.files)[0];
    if (file) await loadImageFile(file);
  });

  async function loadImageFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (RAW_EXTS.includes(ext)) {
      if (!isElectron) { setStatus('RAW 仅限桌面版'); return; }
      setStatus('正在解析 RAW...');
      const result = await window.electronAPI.extractRawPreview(file.path);
      if (!result) { setStatus('无法提取 RAW 预览'); return; }
      const byteChars = atob(result.data);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = blobUrl; });
      state.sourceImage = img;
      state.sourceFileName = file.name.replace(/\.[^.]+$/, '');
      URL.revokeObjectURL(blobUrl);
      fitCanvas();
      cacheValid = false;
      renderPreview();
      setStatus(`RAW: ${file.name}`);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(); img.src = url; });
    state.sourceImage = img;
    state.sourceFileName = file.name.replace(/\.[^.]+$/, '');
    fitCanvas();
    cacheValid = false;
    renderPreview();
    setStatus(file.name);
    URL.revokeObjectURL(url);
  }

  function fitCanvas() {
    if (!state.sourceImage) return;
    const rect = els.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { setTimeout(fitCanvas, 50); return; }
    const pad = 20;
    const maxW = Math.max(rect.width - pad, 100);
    const maxH = Math.max(rect.height - pad, 100);
    const scale = Math.min(maxW / state.sourceImage.width, maxH / state.sourceImage.height, 1);
    const w = Math.floor(state.sourceImage.width * scale);
    const h = Math.floor(state.sourceImage.height * scale);
    els.canvas.width = Math.max(w, 1);
    els.canvas.height = Math.max(h, 1);
    origCache.width = els.canvas.width;
    origCache.height = els.canvas.height;
    lutCache.width = els.canvas.width;
    lutCache.height = els.canvas.height;
    els.canvas.style.display = 'block';
    els.placeholder.style.display = 'none';
    cacheValid = false;
  }

  /* ── Rendering ── */

  function renderLutToCanvas(canvas, ctx, lut) {
    let ok = false;
    if (useWebgl && webgl) {
      webgl.resize(canvas.width, canvas.height);
      webgl.uploadImage(state.sourceImage);
      webgl.uploadLUT(lut);
      ok = webgl.render(canvas.width, canvas.height, false);
      if (ok) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(webglCanvas, 0, 0);
      }
    }
    if (!ok) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      LUTApply.applyLUT(imageData, lut);
      ctx.putImageData(imageData, 0, 0);
    }
  }

  function rebuildCache() {
    if (!state.sourceImage || !state.currentLut) return;
    const w = els.canvas.width, h = els.canvas.height;
    if (w === 0 || h === 0) return;
    origCtx.clearRect(0, 0, w, h);
    origCtx.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, w, h);
    renderLutToCanvas(lutCache, lutCtx, state.currentLut);
    cacheValid = true;
  }

  function renderPreview() {
    if (!state.sourceImage || !state.currentLut) return;
    const w = els.canvas.width, h = els.canvas.height;
    if (w === 0 || h === 0) return;
    try {
      if (!cacheValid) rebuildCache();
      const intensityAlpha = state.lutIntensity / 100;
      ctx.clearRect(0, 0, w, h);
      if (state.compareMode) {
        const splitX = Math.round(w * 0.5);
        ctx.drawImage(origCache, 0, 0, splitX, h, 0, 0, splitX, h);
        ctx.globalAlpha = intensityAlpha;
        ctx.drawImage(lutCache, 0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(233,69,96,0.85)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LUT', Math.round(splitX / 2), 18);
        ctx.fillText('原始', Math.round(splitX + (w - splitX) / 2), 18);
        ctx.restore();
      } else {
        ctx.drawImage(origCache, 0, 0, w, h);
        ctx.globalAlpha = intensityAlpha;
        ctx.drawImage(lutCache, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    } catch (err) {
      console.error('[App] 渲染错误:', err);
    }
    updateButtons();
  }

  /* ── Events ── */

  els.toggleCompareBtn.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    els.toggleCompareBtn.textContent = state.compareMode ? '退出对比' : '对比模式';
    renderPreview();
  });

  els.fitViewBtn.addEventListener('click', () => {
    fitCanvas();
    renderPreview();
  });

  els.intensitySlider.addEventListener('input', () => {
    state.lutIntensity = parseInt(els.intensitySlider.value);
    els.intensityValue.textContent = `${state.lutIntensity}%`;
    renderPreview();
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fitCanvas(); renderPreview(); }, 150);
  });

  els.canvas.addEventListener('mousedown', (e) => {
    if (!state.compareMode) return;
    const rect = els.canvas.getBoundingClientRect();
    const scaleX = els.canvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const splitX = els.canvas.width * 0.5;
    if (Math.abs(mx - splitX) < 8) {
      state.dragging = true;
      els.canvas.style.cursor = 'ew-resize';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const rect = els.canvas.getBoundingClientRect();
    const scaleX = els.canvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
  });

  document.addEventListener('mouseup', () => {
    if (state.dragging) { state.dragging = false; els.canvas.style.cursor = ''; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Navigate tree items
      const items = els.folderTree.querySelectorAll('.tree-item[data-path]');
      const activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
      let next = e.key === 'ArrowDown' ? activeIdx + 1 : activeIdx - 1;
      if (next >= 0 && next < items.length) {
        items[next].click();
        items[next].scrollIntoView({ block: 'nearest' });
      }
    }
  });

  /* ── Export ── */

  els.exportBtn.addEventListener('click', async () => {
    if (!state.sourceImage || !state.currentLut) return;
    const fmt = els.exportFormat.value;
    const mimeType = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = fmt === 'jpg' ? 'jpg' : 'png';
    const w = state.sourceImage.naturalWidth || state.sourceImage.width;
    const h = state.sourceImage.naturalHeight || state.sourceImage.height;
    setStatus('正在导出...');

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = w;
    exportCanvas.height = h;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.drawImage(state.sourceImage, 0, 0, w, h);

    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tmpCtx = tmp.getContext('2d');
    renderLutToCanvas(tmp, tmpCtx, state.currentLut);
    exportCtx.clearRect(0, 0, w, h);
    exportCtx.drawImage(tmp, 0, 0);

    const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, mimeType));
    if (!blob) { setStatus('导出失败'); return; }

    const baseName = state.sourceFileName || 'export';
    const lutName = state.currentLut.name.replace(/\.[^.]+$/, '');
    const defaultName = `${baseName}_${lutName}.${ext}`;

    if (isElectron) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const path = await window.electronAPI.saveFile({
          dataBase64: base64,
          defaultName,
          filters: fmt === 'jpg'
            ? [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
            : [{ name: 'PNG', extensions: ['png'] }],
        });
        setStatus(path ? `已导出: ${path}` : '导出取消');
      };
      reader.readAsDataURL(blob);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('导出完成');
    }
  });

  /* ── Splitters ── */

  (function initSplitters() {
    // Left splitter
    const splitter = document.getElementById('splitter');
    const sidebar = document.getElementById('sidebar');
    let drag = false, dragRight = false;
    const rightSplitter = document.getElementById('splitterRight');
    const infoPanel = document.getElementById('infoPanel');

    splitter.addEventListener('mousedown', (e) => {
      drag = true;
      splitter.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    rightSplitter.addEventListener('mousedown', (e) => {
      dragRight = true;
      rightSplitter.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (drag) {
        const rect = sidebar.parentElement.getBoundingClientRect();
        let w = e.clientX - rect.left;
        w = Math.max(160, Math.min(w, rect.width * 0.5));
        sidebar.style.width = w + 'px';
      }
      if (dragRight) {
        const rect = infoPanel.parentElement.getBoundingClientRect();
        let w = rect.right - e.clientX;
        w = Math.max(200, Math.min(w, rect.width * 0.4));
        infoPanel.style.width = w + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (drag) { drag = false; splitter.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
      if (dragRight) { dragRight = false; rightSplitter.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    });
  })();

  /* ── Utils ── */

  function setStatus(msg) {
    els.statusText.textContent = msg;
  }

  function updateButtons() {
    const hasLut = !!state.currentLut;
    const hasImage = !!state.sourceImage;
    els.toggleCompareBtn.disabled = !(hasLut && hasImage);
    els.fitViewBtn.disabled = !hasImage;
    const canExport = hasLut && hasImage;
    els.exportBtn.disabled = !canExport;
    els.exportFormat.disabled = !canExport;
    els.intensitySlider.disabled = !(hasLut && hasImage);
  }

  // Auto-load default image on startup
  setTimeout(async () => {
    if (thumbSourceImg) {
      await loadDefaultImage();
    }
  }, 500);
})();
