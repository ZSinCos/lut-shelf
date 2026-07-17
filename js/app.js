(function () {
  const state = {
    luts: [],
    currentLutIndex: -1,
    sourceImage: null,
    sourceFileName: '',
    compareMode: false,
    dualLut: false,
    lutBIndex: -1,
    lutBlend: 50,
    lutIntensity: 100,
    splitRatio: 0.5,
    dragging: false,
    sortFav: false,
    favorites: JSON.parse(localStorage.getItem('lutFavorites') || '[]'),
  };

  const els = {
    canvas: document.getElementById('previewCanvas'),
    container: document.getElementById('canvasContainer'),
    placeholder: document.getElementById('placeholder'),
    lutList: document.getElementById('lutList'),
    lutSearch: document.getElementById('lutSearch'),
    imageInput: document.getElementById('imageInput'),
    toggleCompareBtn: document.getElementById('toggleCompareBtn'),
    fitViewBtn: document.getElementById('fitViewBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportFormat: document.getElementById('exportFormat'),
    intensitySlider: document.getElementById('intensitySlider'),
    intensityValue: document.getElementById('intensityValue'),
    dualLutBtn: document.getElementById('dualLutBtn'),
    dualLutControls: document.getElementById('dualLutControls'),
    lutBSelect: document.getElementById('lutBSelect'),
    blendSlider: document.getElementById('blendSlider'),
    blendValue: document.getElementById('blendValue'),
    loadLutDirBtn: document.getElementById('loadLutDirBtn'),
    statusText: document.getElementById('statusText'),
    lutCount: document.getElementById('lutCount'),
    infoBar: document.getElementById('infoBar'),
    lutInfoName: document.getElementById('lutInfoName'),
    lutInfoMeta: document.getElementById('lutInfoMeta'),
    sortFavBtn: document.getElementById('sortFavBtn'),
  };

  let ctx = els.canvas.getContext('2d');
  let origCache = document.createElement('canvas');
  let origCtx = origCache.getContext('2d');
  let lutCache = document.createElement('canvas');
  let lutCtx = lutCache.getContext('2d');
  let lutBCache = document.createElement('canvas');
  let lutBCtx = lutBCache.getContext('2d');
  let blendCache = document.createElement('canvas');
  let blendCtx = blendCache.getContext('2d');
  let webglCanvas = null;
  let webgl = null;
  let useWebgl = false;
  let cacheValid = false;
  let resizeTimer = null;

  function initWebGL() {
    webglCanvas = document.createElement('canvas');
    webgl = new LUTWebGL(webglCanvas);
    useWebgl = webgl.supported;
    if (useWebgl) {
      console.log('[App] 使用 WebGL 加速渲染');
    }
  }

  initWebGL();

  /* ── Thumbnail system (photo-based + disk cache) ── */

  let thumbSourceImg = null;
  const THUMB_SIZE = 64;

  async function initThumbSource() {
    if (!isElectron) {
      // fallback: use a generated gradient for browser mode
      thumbSourceImg = null;
      return;
    }
    // try loading cached source from disk
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
  }

  function thumbCacheKey(lut) {
    // use name + size + type as a stable cache key
    const raw = `${lut.name}|${lut.size}|${lut.type}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  async function generateThumbnail(lut) {
    // check disk cache first
    if (isElectron) {
      const key = thumbCacheKey(lut);
      const cached = await window.electronAPI.thumbCacheGet(key);
      if (cached) {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = `data:image/png;base64,${cached.data}`;
        });
        const c = document.createElement('canvas');
        c.width = THUMB_SIZE;
        c.height = THUMB_SIZE;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
      }
    }

    // generate thumbnail
    const c = document.createElement('canvas');
    c.width = THUMB_SIZE;
    c.height = THUMB_SIZE;
    const cx = c.getContext('2d');

    if (thumbSourceImg) {
      // draw source image covering the canvas
      const s = thumbSourceImg;
      const scale = Math.max(THUMB_SIZE / s.width, THUMB_SIZE / s.height);
      const sw = s.width * scale, sh = s.height * scale;
      const sx = (sw - THUMB_SIZE) / 2, sy = (sh - THUMB_SIZE) / 2;
      cx.drawImage(s, 0, 0, s.width, s.height, -sx, -sy, sw, sh);
    } else {
      // fallback gradient
      for (let y = 0; y < THUMB_SIZE; y++) {
        for (let x = 0; x < THUMB_SIZE; x++) {
          cx.fillStyle = `rgb(${x/THUMB_SIZE*255|0},${y/THUMB_SIZE*255|0},${128+64*Math.sin((x+y)/THUMB_SIZE*Math.PI)|0})`;
          cx.fillRect(x, y, 1, 1);
        }
      }
    }

    const imgData = cx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);
    LUTApply.applyLUT(imgData, lut);
    cx.putImageData(imgData, 0, 0);

    // save to disk cache
    if (isElectron) {
      const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(',')[1];
        window.electronAPI.thumbCachePut(thumbCacheKey(lut), b64);
      };
      reader.readAsDataURL(blob);
    }

    return c;
  }

  // Initialize thumb source on load
  initThumbSource();

  /* ── Events ── */

  els.lutSearch.addEventListener('input', renderLutList);

  function isRawFile(ext) {
    return RAW_EXTS.includes(ext.toLowerCase());
  }

  els.imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await loadImageFile(file);
    } catch (err) {
      console.error('[App] 图片加载失败:', err);
      setStatus('图片加载失败');
    }
  });

  els.container.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.container.style.outline = '2px dashed var(--accent)';
  });

  els.container.addEventListener('dragleave', () => {
    els.container.style.outline = '';
  });

  els.container.addEventListener('drop', async (e) => {
    e.preventDefault();
    els.container.style.outline = '';
    const file = Array.from(e.dataTransfer.files)[0];
    if (file) await loadImageFile(file);
  });

  els.toggleCompareBtn.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    els.toggleCompareBtn.textContent = state.compareMode ? '退出对比' : '对比模式';
    renderPreview();
  });

  els.fitViewBtn.addEventListener('click', () => {
    fitCanvas();
    renderPreview();
  });

  els.exportBtn.addEventListener('click', exportImage);

  els.intensitySlider.addEventListener('input', () => {
    state.lutIntensity = parseInt(els.intensitySlider.value);
    els.intensityValue.textContent = `${state.lutIntensity}%`;
    renderPreview();
  });

  els.dualLutBtn.addEventListener('click', () => {
    state.dualLut = !state.dualLut;
    els.dualLutBtn.textContent = state.dualLut ? '关双LUT' : '双 LUT';
    els.dualLutControls.style.display = state.dualLut ? 'inline-flex' : 'none';
    if (state.dualLut && state.luts.length > 1 && state.lutBIndex < 0) {
      state.lutBIndex = state.luts[0] === state.luts[state.currentLutIndex >= 0 ? state.currentLutIndex : 0] ? 1 : 0;
      els.lutBSelect.value = state.lutBIndex;
    }
    if (state.dualLut && state.lutBIndex >= 0) populateLutBSelect();
    cacheValid = false;
    renderPreview();
  });

  els.blendSlider.addEventListener('input', () => {
    state.lutBlend = parseInt(els.blendSlider.value);
    els.blendValue.textContent = `${state.lutBlend}%`;
    renderPreview();
  });

  els.lutBSelect.addEventListener('change', () => {
    state.lutBIndex = parseInt(els.lutBSelect.value);
    cacheValid = false;
    renderPreview();
  });

  const isElectron = !!window.electronAPI;
  const RAW_EXTS = ['rw2', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'dng', 'pef', 'srw', 'x3f'];

  els.loadLutDirBtn.addEventListener('click', async () => {
    if (isElectron) {
      const dirPath = await window.electronAPI.selectLutDir();
      if (!dirPath) return;
      setStatus('正在扫描 LUT 文件...');
      const lutFiles = await window.electronAPI.scanLutDir(dirPath);
      if (lutFiles.length === 0) {
        setStatus('该目录未找到 LUT 文件');
        return;
      }
      setStatus(`正在加载 ${lutFiles.length} 个 LUT...`);
      await loadLutFilesElectron(lutFiles);
      await window.electronAPI.saveLutDir(dirPath);
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.accept = '.vlt,.cube';
      input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files).filter(f => {
          const ext = f.name.split('.').pop().toLowerCase();
          return ext === 'vlt' || ext === 'cube';
        });
        if (files.length === 0) {
          setStatus('未找到 LUT 文件');
          return;
        }
        setStatus(`正在加载 ${files.length} 个 LUT...`);
        await loadLutFiles(files);
      });
      input.click();
    }
  });

  els.sortFavBtn.addEventListener('click', () => {
    state.sortFav = !state.sortFav;
    els.sortFavBtn.style.color = state.sortFav ? '#ffd700' : '';
    renderLutList();
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitCanvas();
      renderPreview();
    }, 150);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectLut(state.currentLutIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectLut(state.currentLutIndex - 1);
    } else if ((e.key === 'f' || e.key === 'F') && state.currentLutIndex >= 0) {
      toggleFavorite(state.luts[state.currentLutIndex].name);
    }
  });

  /* ── Split line drag ── */

  els.canvas.addEventListener('mousedown', (e) => {
    if (!state.compareMode) return;
    const rect = els.canvas.getBoundingClientRect();
    const scaleX = els.canvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const splitX = els.canvas.width * state.splitRatio;
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
    state.splitRatio = Math.max(0.05, Math.min(0.95, mx / els.canvas.width));
    renderPreview();
  });

  document.addEventListener('mouseup', () => {
    if (state.dragging) {
      state.dragging = false;
      els.canvas.style.cursor = '';
    }
  });

  els.canvas.addEventListener('mouseleave', () => {
    if (state.dragging) {
      state.dragging = false;
      els.canvas.style.cursor = '';
    }
  });

  /* ── Image loading ── */

  async function loadImageFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (isRawFile(ext)) {
      if (!isElectron) {
        setStatus('RAW 格式仅限桌面版支持');
        return;
      }
      setStatus(`正在解析 RAW: ${file.name}...`);
      const result = await window.electronAPI.extractRawPreview(file.path);
      if (!result) {
        setStatus('无法提取 RAW 内嵌预览图');
        return;
      }
      const byteChars = atob(result.data);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = blobUrl;
      });
      state.sourceImage = img;
      state.sourceFileName = file.name.replace(/\.[^.]+$/, '');
      URL.revokeObjectURL(blobUrl);
      fitCanvas();
      renderPreview();
      setStatus(`RAW 预览: ${file.name}`);
      return;
    }
    await loadImage(file);
  }

  async function loadImage(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
    if (!img.width || !img.height) {
      URL.revokeObjectURL(url);
      throw new Error('图片尺寸无效');
    }
    state.sourceImage = img;
    state.sourceFileName = file.name.replace(/\.[^.]+$/, '');
    fitCanvas();
    renderPreview();
    setStatus(`${file.name}`);
    URL.revokeObjectURL(url);
  }

  function fitCanvas() {
    if (!state.sourceImage) return;
    const rect = els.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      console.warn('[App] 容器尺寸无效，延迟渲染');
      setTimeout(fitCanvas, 50);
      return;
    }
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
    lutBCache.width = els.canvas.width;
    lutBCache.height = els.canvas.height;
    blendCache.width = els.canvas.width;
    blendCache.height = els.canvas.height;
    els.canvas.style.display = 'block';
    els.placeholder.style.display = 'none';
    cacheValid = false;
    console.log(`[App] 画布: ${els.canvas.width}x${els.canvas.height}, 容器: ${rect.width}x${rect.height}, 图片: ${state.sourceImage.width}x${state.sourceImage.height}`);
  }

  /* ── Cache rebuild (only when LUT/image changes) ── */

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
    if (!state.sourceImage) return;
    const lutA = state.currentLutIndex >= 0 ? state.luts[state.currentLutIndex] : null;
    const lutB = state.dualLut && state.lutBIndex >= 0 ? state.luts[state.lutBIndex] : null;
    const w = els.canvas.width;
    const h = els.canvas.height;
    if (w === 0 || h === 0) return;

    origCtx.clearRect(0, 0, w, h);
    origCtx.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, w, h);

    if (lutA) {
      renderLutToCanvas(lutCache, lutCtx, lutA);
    } else {
      lutCtx.clearRect(0, 0, w, h);
    }

    if (lutB && lutB !== lutA) {
      renderLutToCanvas(lutBCache, lutBCtx, lutB);
    } else {
      lutBCtx.clearRect(0, 0, w, h);
    }

    cacheValid = true;
  }

  /* ── Preview rendering (uses caches for fast blitting) ── */

  function renderPreview() {
    if (!state.sourceImage) return;
    const w = els.canvas.width;
    const h = els.canvas.height;
    if (w === 0 || h === 0) return;

    try {
      if (!cacheValid) rebuildCache();

      const intensityAlpha = state.lutIntensity / 100;
      const hasLutB = state.dualLut && state.lutBIndex >= 0 && state.lutBIndex !== state.currentLutIndex;

      ctx.clearRect(0, 0, w, h);

      if (state.compareMode) {
        const splitX = Math.round(w * state.splitRatio);
        ctx.drawImage(origCache, 0, 0, w, h);
        if (hasLutB) {
          blendCtx.clearRect(0, 0, w, h);
          blendCtx.drawImage(lutCache, 0, 0, splitX, h, 0, 0, splitX, h);
          blendCtx.globalAlpha = state.lutBlend / 100;
          blendCtx.drawImage(lutBCache, 0, 0, splitX, h, 0, 0, splitX, h);
          blendCtx.globalAlpha = 1;
          ctx.globalAlpha = intensityAlpha;
          ctx.drawImage(blendCache, 0, 0, splitX, h, 0, 0, splitX, h);
        } else {
          ctx.globalAlpha = intensityAlpha;
          ctx.drawImage(lutCache, 0, 0, splitX, h, 0, 0, splitX, h);
        }
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
        ctx.fillStyle = '#e94560';
        ctx.beginPath();
        ctx.arc(splitX, h / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(233,69,96,0.85)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LUT', Math.round(splitX / 2), 18);
        ctx.fillText('原始', Math.round(splitX + (w - splitX) / 2), 18);
        ctx.restore();
      } else {
        ctx.drawImage(origCache, 0, 0, w, h);
        if (hasLutB) {
          blendCtx.clearRect(0, 0, w, h);
          blendCtx.drawImage(lutCache, 0, 0, w, h);
          blendCtx.globalAlpha = state.lutBlend / 100;
          blendCtx.drawImage(lutBCache, 0, 0, w, h);
          blendCtx.globalAlpha = 1;
          ctx.globalAlpha = intensityAlpha;
          ctx.drawImage(blendCache, 0, 0, w, h);
        } else {
          ctx.globalAlpha = intensityAlpha;
          ctx.drawImage(lutCache, 0, 0, w, h);
        }
        ctx.globalAlpha = 1;
      }
    } catch (err) {
      console.error('[App] 渲染错误:', err);
    }

    updateInfoBar();
    updateButtons();
  }

  function populateLutBSelect() {
    const sel = els.lutBSelect;
    sel.innerHTML = '<option value="-1">LUT B（无）</option>' +
      state.luts.map((l, i) =>
        `<option value="${i}"${i === state.lutBIndex ? ' selected' : ''}>${escHtml(l.name)}</option>`
      ).join('');
  }

  /* ── Export ── */

  async function exportImage() {
    const lutA = state.currentLutIndex >= 0 ? state.luts[state.currentLutIndex] : null;
    if (!state.sourceImage || !lutA) return;

    const lutB = state.dualLut && state.lutBIndex >= 0 && state.lutBIndex !== state.currentLutIndex
      ? state.luts[state.lutBIndex] : null;

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

    const tmpA = document.createElement('canvas');
    tmpA.width = w; tmpA.height = h;
    const tmpACtx = tmpA.getContext('2d');
    renderLutToCanvas(tmpA, tmpACtx, lutA);

    if (lutB) {
      const tmpB = document.createElement('canvas');
      tmpB.width = w; tmpB.height = h;
      const tmpBCtx = tmpB.getContext('2d');
      renderLutToCanvas(tmpB, tmpBCtx, lutB);
      exportCtx.clearRect(0, 0, w, h);
      exportCtx.drawImage(tmpA, 0, 0);
      exportCtx.globalAlpha = state.lutBlend / 100;
      exportCtx.drawImage(tmpB, 0, 0);
      exportCtx.globalAlpha = 1;
    } else {
      exportCtx.clearRect(0, 0, w, h);
      exportCtx.drawImage(tmpA, 0, 0);
    }

    const intensityAlpha = state.lutIntensity / 100;
    if (intensityAlpha < 1) {
      const origFull = document.createElement('canvas');
      origFull.width = w; origFull.height = h;
      const origFullCtx = origFull.getContext('2d');
      origFullCtx.drawImage(state.sourceImage, 0, 0, w, h);
      exportCtx.globalAlpha = intensityAlpha;
      exportCtx.drawImage(exportCanvas, 0, 0);
      exportCtx.globalAlpha = 1;
    }

    const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, mimeType));

    if (!blob) {
      setStatus('导出失败');
      return;
    }

    const baseName = state.sourceFileName || 'export';
    const lutName = lutB
      ? `${lutA.name.replace(/\.[^.]+$/, '')}_${lutB.name.replace(/\.[^.]+$/, '')}`
      : lutA.name.replace(/\.[^.]+$/, '');
    const defaultName = `${baseName}_${lutName}.${ext}`;

    if (isElectron) {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const path = await window.electronAPI.saveFile({
          dataBase64: base64,
          defaultName,
          filters: fmt === 'jpg'
            ? [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }]
            : [{ name: 'PNG 图片', extensions: ['png'] }],
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
  }

  /* ── LUT loading ── */

  async function loadLutFiles(files) {
    state.luts = [];
    state.currentLutIndex = -1;

    for (const file of files) {
      try {
        const lut = await LUTParser.parseLUT(file);
        lut.thumb = await generateThumbnail(lut);
        state.luts.push(lut);
      } catch (err) {
        console.warn(`加载失败: ${file.name}`, err);
      }
    }

    state.luts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN-u-kf-upper'));
    renderLutList();
    populateLutBSelect();
    selectLut(-1);
    els.lutCount.textContent = `${state.luts.length} 个 LUT`;
    updateButtons();
  }

  async function loadLutFilesElectron(lutFileEntries) {
    state.luts = [];
    state.currentLutIndex = -1;

    for (const entry of lutFileEntries) {
      try {
        const text = await window.electronAPI.readLutFile(entry.path);
        if (!text) continue;
        const lut = LUTParser.parseLUTFromText(entry.name, text);
        lut.thumb = await generateThumbnail(lut);
        state.luts.push(lut);
      } catch (err) {
        console.warn(`加载失败: ${entry.name}`, err);
      }
    }

    state.luts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN-u-kf-upper'));
    renderLutList();
    populateLutBSelect();
    selectLut(-1);
    els.lutCount.textContent = `${state.luts.length} 个 LUT`;
    updateButtons();
  }

  if (isElectron) {
    window.electronAPI.onAutoLoadLuts(async (dirPath) => {
      setStatus('正在自动加载 LUT...');
      const lutFiles = await window.electronAPI.scanLutDir(dirPath);
      if (lutFiles.length > 0) {
        setStatus(`正在加载 ${lutFiles.length} 个 LUT...`);
        await loadLutFilesElectron(lutFiles);
        setStatus(`已加载 ${lutFiles.length} 个 LUT`);
      }
    });
    window.electronAPI.onMenuSelectLutDir(async (dirPath) => {
      setStatus('正在扫描 LUT 文件...');
      const lutFiles = await window.electronAPI.scanLutDir(dirPath);
      if (lutFiles.length === 0) {
        setStatus('该目录未找到 LUT 文件');
        return;
      }
      setStatus(`正在加载 ${lutFiles.length} 个 LUT...`);
      await loadLutFilesElectron(lutFiles);
      await window.electronAPI.saveLutDir(dirPath);
    });
  }

  /* ── LUT list ── */

  function renderLutList() {
    const keyword = els.lutSearch.value.trim().toLowerCase();
    let filtered = state.luts;

    if (keyword) {
      filtered = filtered.filter(l => l.name.toLowerCase().includes(keyword));
    }

    if (state.sortFav) {
      filtered = [...filtered].sort((a, b) => {
        const af = state.favorites.includes(a.name) ? 0 : 1;
        const bf = state.favorites.includes(b.name) ? 0 : 1;
        return af - bf;
      });
    }

    const origActive = state.currentLutIndex === -1;
    let html = `<div class="lut-item ${origActive ? 'active' : ''}" data-index="-1">
      <div class="lut-thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-secondary)">⊘</div>
      <div class="lut-info">
        <span class="lut-name">原图</span>
        <span class="lut-meta">原始图像</span>
      </div>
    </div>`;

    if (filtered.length > 0) {
      html += filtered.map((lut) => {
        const realIdx = state.luts.indexOf(lut);
        const isActive = realIdx === state.currentLutIndex;
        const isFav = state.favorites.includes(lut.name);
        return `<div class="lut-item ${isActive ? 'active' : ''}" data-index="${realIdx}">
          <div class="lut-thumb"></div>
          <div class="lut-info">
            <span class="lut-name">${escHtml(lut.name)}</span>
            <span class="lut-meta">${lut.size}³  ${lut.type}</span>
          </div>
          <button class="favorite-btn ${isFav ? 'active' : ''}" data-lutname="${lut.name}">${isFav ? '★' : '☆'}</button>
        </div>`;
      }).join('');
    } else if (!keyword) {
      html += `<div class="empty-state"><p>尚未加载 LUT</p></div>`;
    }

    els.lutList.innerHTML = html;

    els.lutList.querySelectorAll('.lut-item').forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      const thumbDiv = el.querySelector('.lut-thumb');
      if (idx >= 0 && thumbDiv && state.luts[idx] && state.luts[idx].thumb) {
        thumbDiv.appendChild(state.luts[idx].thumb.cloneNode(true));
      }
      el.addEventListener('click', () => selectLut(idx));
    });

    els.lutList.querySelectorAll('.favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.lutname);
      });
    });
  }

  /* ── Selection ── */

  function selectLut(index) {
    if (index < -1 || index >= state.luts.length) return;
    state.currentLutIndex = index;
    cacheValid = false;
    renderLutList();
    renderPreview();
    const el = els.lutList.querySelector(`.lut-item[data-index="${index}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ── Favorites ── */

  function toggleFavorite(name) {
    const idx = state.favorites.indexOf(name);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
    } else {
      state.favorites.push(name);
    }
    localStorage.setItem('lutFavorites', JSON.stringify(state.favorites));
    renderLutList();
  }

  /* ── Info bar ── */

  function updateInfoBar() {
    const hasLutB = state.dualLut && state.lutBIndex >= 0 && state.lutBIndex !== state.currentLutIndex;
    if (state.currentLutIndex >= 0) {
      const lut = state.luts[state.currentLutIndex];
      if (hasLutB) {
        const lutB = state.luts[state.lutBIndex];
        els.lutInfoName.textContent = `${lut.name} + ${lutB.name}`;
        els.lutInfoMeta.textContent = `混合 ${state.lutBlend}%  ●  强度 ${state.lutIntensity}%`;
      } else {
        els.lutInfoName.textContent = lut.name;
        const engine = useWebgl ? 'WebGL' : 'CPU';
        els.lutInfoMeta.textContent = `${lut.size}³  ${lut.type.toUpperCase()}  ${engine}  ●  ${state.currentLutIndex + 1} / ${state.luts.length}`;
      }
      els.infoBar.style.display = 'flex';
    } else if (state.currentLutIndex === -1 && state.sourceImage) {
      els.lutInfoName.textContent = '原图';
      els.lutInfoMeta.textContent = '原始图像，无 LUT';
      els.infoBar.style.display = 'flex';
    } else {
      els.infoBar.style.display = 'none';
    }
  }

  /* ── Buttons state ── */

  function updateButtons() {
    const hasLut = state.luts.length > 0;
    const hasImage = !!state.sourceImage;
    els.toggleCompareBtn.disabled = !(hasLut && hasImage);
    els.fitViewBtn.disabled = !hasImage;
    const canExport = hasLut && hasImage;
    els.exportBtn.disabled = !canExport;
    els.exportFormat.disabled = !canExport;
    els.intensitySlider.disabled = !(hasLut && hasImage);
    els.dualLutBtn.disabled = !(hasLut && hasImage);
    const dualActive = state.dualLut && hasLut && hasImage;
    els.dualLutControls.style.display = dualActive ? 'inline-flex' : 'none';
    els.lutBSelect.disabled = !dualActive;
    els.blendSlider.disabled = !dualActive;
  }

  /* ── Status ── */

  function setStatus(msg) {
    els.statusText.textContent = msg;
  }

  /* ── Repo (folder-based, like Obsidian) ── */

  if (isElectron) {
    els.browseTabBtn = document.getElementById('browseTabBtn');
    els.repoTabBtn = document.getElementById('repoTabBtn');
    els.browseTab = document.getElementById('browseTab');
    els.repoTab = document.getElementById('repoTab');
    els.repoSelectDirBtn = document.getElementById('repoSelectDirBtn');
    els.repoTitle = document.getElementById('repoTitle');
    els.repoBreadcrumb = document.getElementById('repoBreadcrumb');
    els.repoContent = document.getElementById('repoContent');
    els.repoActions = document.getElementById('repoActions');
    els.repoImportBtn = document.getElementById('repoImportBtn');
    els.repoNewFolderBtn = document.getElementById('repoNewFolderBtn');
    els.repoSetThumbBtn = document.getElementById('repoSetThumbBtn');
    els.repoEditModal = document.getElementById('repoEditModal');
    els.editModalTitle = document.getElementById('editModalTitle');
    els.editModalClose = document.getElementById('editModalClose');
    els.editNote = document.getElementById('editNote');
    els.editDeleteBtn = document.getElementById('editDeleteBtn');
    els.editCancelBtn = document.getElementById('editCancelBtn');
    els.editSaveBtn = document.getElementById('editSaveBtn');
    els.editRating = document.getElementById('editRating');

    let activeTab = 'browse';
    let repoCurrentPath = '';  // relative path inside repo
    let repoMeta = {};

    function switchTab(tab) {
      activeTab = tab;
      els.browseTabBtn.classList.toggle('active', tab === 'browse');
      els.repoTabBtn.classList.toggle('active', tab === 'repo');
      els.browseTab.style.display = tab === 'browse' ? '' : 'none';
      els.repoTab.style.display = tab === 'repo' ? '' : 'none';
      if (tab === 'repo') loadRepoView();
    }

    els.browseTabBtn.addEventListener('click', () => switchTab('browse'));
    els.repoTabBtn.addEventListener('click', () => switchTab('repo'));

    async function loadRepoView() {
      const dir = await window.electronAPI.repoGetDir();
      if (!dir) {
        els.repoTitle.textContent = 'LUT 仓库（未设置）';
        els.repoBreadcrumb.innerHTML = '';
        els.repoContent.innerHTML = '<div class="empty-state"><p>请先点击上方「选择仓库」按钮<br/>选择一个文件夹作为 LUT 仓库</p></div>';
        els.repoActions.style.display = 'none';
        return;
      }
      els.repoActions.style.display = '';
      els.repoTitle.textContent = `仓库: ${dir.split(/[/\\]/).pop()}`;
      repoMeta = await window.electronAPI.repoLoadMeta();
      const result = await window.electronAPI.repoScan(repoCurrentPath);
      renderBreadcrumb();
      renderRepoContent(result);
    }

    function renderBreadcrumb() {
      const parts = repoCurrentPath ? repoCurrentPath.split(/[/\\]/) : [];
      let html = '<span data-path="">仓库根目录</span>';
      let acc = '';
      parts.forEach((p, i) => {
        acc = acc ? `${acc}/${p}` : p;
        html += `<span class="sep">›</span><span data-path="${acc}">${escHtml(p)}</span>`;
      });
      els.repoBreadcrumb.innerHTML = html;
      els.repoBreadcrumb.querySelectorAll('span[data-path]').forEach(el => {
        el.addEventListener('click', () => {
          repoCurrentPath = el.dataset.path;
          loadRepoView();
        });
      });
    }

    function renderRepoContent(result) {
      if (result.folders.length === 0 && result.files.length === 0) {
        els.repoContent.innerHTML = '<div class="empty-state"><p>此文件夹为空<br/>点击「＋导入」添加 LUT</p></div>';
        return;
      }
      let html = '';
      result.folders.forEach(f => {
        html += `<div class="repo-item repo-item-folder" data-type="folder" data-path="${f.relativePath}">
          <div class="repo-item-icon">📁</div>
          <div class="repo-item-name">${escHtml(f.name)}</div>
        </div>`;
      });
      result.files.forEach(f => {
        const meta = repoMeta[f.relativePath] || {};
        const stars = meta.rating ? '★'.repeat(meta.rating) + '☆'.repeat(5 - meta.rating) : '';
        const isActive = state.luts.some(l => l._repoRelPath === f.relativePath);
        html += `<div class="repo-item ${isActive ? 'active' : ''}" data-type="file" data-path="${f.relativePath}">
          <div class="repo-item-thumb"></div>
          <div class="repo-item-name">${escHtml(f.name.replace(/\.[^.]+$/, ''))}</div>
          ${meta.rating ? `<div class="repo-item-rating">${stars}</div>` : ''}
        </div>`;
      });
      els.repoContent.innerHTML = html;

      els.repoContent.querySelectorAll('[data-type="folder"]').forEach(el => {
        el.addEventListener('click', () => {
          repoCurrentPath = el.dataset.path;
          loadRepoView();
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const act = prompt('操作: 输入新名称重命名，留空删除文件夹');
          if (act === null) return;
          if (act.trim()) {
            window.electronAPI.repoRename(el.dataset.path, act.trim()).then(() => loadRepoView());
          } else {
            if (confirm('确定删除此文件夹及其中所有文件？')) {
              window.electronAPI.repoDelete(el.dataset.path).then(() => loadRepoView());
            }
          }
        });
      });

      els.repoContent.querySelectorAll('[data-type="file"]').forEach(el => {
        const path = el.dataset.path;
        const meta = repoMeta[path] || {};
        const thumbDiv = el.querySelector('.repo-item-thumb');
        const cached = state.luts.find(l => l._repoRelPath === path);
        if (cached?.thumb) {
          thumbDiv.appendChild(cached.thumb.cloneNode(true));
        }
        el.addEventListener('click', () => applyRepoFile(path));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openFileMenu(path);
        });
      });
    }

    async function applyRepoFile(relPath) {
      const content = await window.electronAPI.repoReadFile(relPath);
      if (!content) return;
      const name = relPath.split(/[/\\]/).pop();
      const parsed = LUTParser.parseLUTFromText(name, content);
      parsed._repoRelPath = relPath;
      parsed.thumb = await generateThumbnail(parsed);
      const existing = state.luts.findIndex(l => l._repoRelPath === relPath);
      if (existing >= 0) {
        state.currentLutIndex = existing;
      } else {
        state.luts.unshift(parsed);
        state.currentLutIndex = 0;
      }
      cacheValid = false;
      renderLutList();
      populateLutBSelect();
      renderPreview();
      loadRepoView();
    }

    function openFileMenu(relPath) {
      const meta = repoMeta[relPath] || {};
      els.editModalTitle.textContent = `属性: ${relPath.split(/[/\\]/).pop()}`;
      els.editNote.value = meta.note || '';
      updateStarUI(meta.rating || 0);
      els.repoEditModal.style.display = 'flex';

      const saveHandler = async () => {
        const rating = els.editRating.querySelectorAll('.star.active').length;
        repoMeta[relPath] = {
          rating,
          note: els.editNote.value.trim(),
        };
        await window.electronAPI.repoSaveMeta(repoMeta);
        els.repoEditModal.style.display = 'none';
        loadRepoView();
      };

      const deleteHandler = async () => {
        if (confirm(`确定删除 ${relPath}？`)) {
          await window.electronAPI.repoDelete(relPath);
          const idx = state.luts.findIndex(l => l._repoRelPath === relPath);
          if (idx >= 0) {
            state.luts.splice(idx, 1);
            if (state.currentLutIndex >= state.luts.length) state.currentLutIndex = state.luts.length - 1;
            if (state.currentLutIndex === idx) state.currentLutIndex = -1;
            cacheValid = false;
            renderLutList();
            populateLutBSelect();
            renderPreview();
          }
          els.repoEditModal.style.display = 'none';
          loadRepoView();
        }
      };

      els.editSaveBtn.onclick = saveHandler;
      els.editDeleteBtn.onclick = deleteHandler;
    }

    function updateStarUI(val) {
      els.editRating.querySelectorAll('.star').forEach(el => {
        const v = parseInt(el.dataset.val, 10);
        el.textContent = v <= val ? '★' : '☆';
        el.classList.toggle('active', v <= val);
      });
    }

    els.editRating.addEventListener('click', (e) => {
      const star = e.target.closest('.star');
      if (!star) return;
      const val = parseInt(star.dataset.val, 10);
      updateStarUI(val);
    });

    els.editCancelBtn.addEventListener('click', () => {
      els.repoEditModal.style.display = 'none';
    });
    els.editModalClose.addEventListener('click', () => {
      els.repoEditModal.style.display = 'none';
    });

    els.repoSelectDirBtn.addEventListener('click', async () => {
      const dir = await window.electronAPI.repoSelectDir();
      if (dir) {
        repoCurrentPath = '';
        loadRepoView();
      }
    });

    els.repoImportBtn.addEventListener('click', async () => {
      const count = await window.electronAPI.repoImportFiles();
      if (count > 0) {
        setStatus(`已导入 ${count} 个 LUT`);
        loadRepoView();
      } else {
        setStatus('未导入任何 LUT');
      }
    });

    els.repoNewFolderBtn.addEventListener('click', async () => {
      const name = prompt('文件夹名称:');
      if (name && name.trim()) {
        const target = repoCurrentPath ? `${repoCurrentPath}/${name.trim()}` : name.trim();
        const ok = await window.electronAPI.repoCreateFolder(target);
        if (ok) loadRepoView();
      }
    });

    // One-time thumb source setup from user's RW2 file
    (async () => {
      const existing = await window.electronAPI.thumbGetSource();
      if (!existing) {
        const rw2Path = 'C:\\Users\\SinCos\\Desktop\\P1011709.RW2';
        const result = await window.electronAPI.thumbSetSource(rw2Path);
        if (result) {
          await initThumbSource();
        }
      }
    })();

    els.repoSetThumbBtn.addEventListener('click', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.rw2,.arw,.cr2,.cr3,.nef,.nrw,.orf,.raf,.dng';
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (window.electronAPI) {
          const result = await window.electronAPI.thumbSetSource(file.path);
          if (result) {
            await initThumbSource();
            setStatus('缩略图源已更新');
          }
        }
      });
      input.click();
    });

    // Initial load if repo dir already set
    loadRepoView();
  }

  /* ── Helpers ── */

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
