(function () {
  const state = {
    luts: [],
    currentLutIndex: -1,
    sourceImage: null,
    compareMode: false,
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
    loadLutDirBtn: document.getElementById('loadLutDirBtn'),
    statusText: document.getElementById('statusText'),
    lutCount: document.getElementById('lutCount'),
    infoBar: document.getElementById('infoBar'),
    lutInfoName: document.getElementById('lutInfoName'),
    lutInfoMeta: document.getElementById('lutInfoMeta'),
    sortFavBtn: document.getElementById('sortFavBtn'),
  };

  let ctx = els.canvas.getContext('2d');
  let webglCanvas = null;
  let webgl = null;
  let useWebgl = false;
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

  /* ── Thumbnail generation ── */

  function generateThumbnail(lut) {
    const size = 16;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const cx = c.getContext('2d');
    const imgData = cx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const r = x / (size - 1);
        const g = y / (size - 1);
        const b = 0.5 + 0.5 * Math.sin((x + y) / size * Math.PI);
        const [or, og, ob] = LUTParser.sampleLUT(lut, r, g, b);
        imgData.data[i]     = Math.round(or * 255);
        imgData.data[i + 1] = Math.round(og * 255);
        imgData.data[i + 2] = Math.round(ob * 255);
        imgData.data[i + 3] = 255;
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  /* ── Events ── */

  els.lutSearch.addEventListener('input', renderLutList);

  els.imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await loadImage(file);
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
    const imgFile = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (imgFile) await loadImage(imgFile);
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

  els.loadLutDirBtn.addEventListener('click', () => {
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

  /* ── Image loading ── */

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
    els.canvas.style.display = 'block';
    els.placeholder.style.display = 'none';
    console.log(`[App] 画布: ${els.canvas.width}x${els.canvas.height}, 容器: ${rect.width}x${rect.height}, 图片: ${state.sourceImage.width}x${state.sourceImage.height}`);
  }

  /* ── Preview rendering ── */

  function renderPreview() {
    if (!state.sourceImage) return;
    const lut = state.currentLutIndex >= 0 ? state.luts[state.currentLutIndex] : null;
    const w = els.canvas.width;
    const h = els.canvas.height;

    if (w === 0 || h === 0) {
      console.warn('[App] 画布尺寸为 0，跳过渲染');
      return;
    }

    try {
      if (useWebgl && webgl && lut) {
        webgl.resize(w, h);
        webgl.uploadImage(state.sourceImage);
        webgl.uploadLUT(lut);
        const rendered = webgl.render(w, h, state.compareMode);
        ctx.clearRect(0, 0, w, h);
        if (rendered) {
          ctx.drawImage(webglCanvas, 0, 0);
        } else {
          ctx.drawImage(state.sourceImage, 0, 0, w, h);
        }
      } else {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, w, h);

        if (lut) {
          const imageData = ctx.getImageData(0, 0, w, h);
          if (state.compareMode) {
            LUTApply.applyLUTWithSplit(imageData, lut, 0.5);
          } else {
            LUTApply.applyLUT(imageData, lut);
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }

      if (state.compareMode) {
        const splitX = w / 2;
        ctx.save();
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, h);
        ctx.stroke();
        ctx.fillStyle = 'rgba(233,69,96,0.85)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LUT', splitX / 2, 18);
        ctx.fillText('原始', splitX + splitX / 2, 18);
        ctx.restore();
      }
    } catch (err) {
      console.error('[App] 渲染错误:', err);
    }

    updateInfoBar();
    updateButtons();
  }

  /* ── LUT loading ── */

  async function loadLutFiles(files) {
    state.luts = [];
    state.currentLutIndex = -1;

    for (const file of files) {
      try {
        const lut = await LUTParser.parseLUT(file);
        lut.thumb = generateThumbnail(lut);
        state.luts.push(lut);
      } catch (err) {
        console.warn(`加载失败: ${file.name}`, err);
      }
    }

    state.luts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN-u-kf-upper'));
    renderLutList();
    if (state.luts.length > 0) {
      selectLut(0);
    }
    els.lutCount.textContent = `${state.luts.length} 个 LUT`;
    updateButtons();
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

    if (filtered.length === 0) {
      els.lutList.innerHTML = `<div class="empty-state"><p>${keyword ? '无匹配 LUT' : '尚未加载 LUT'}</p></div>`;
      return;
    }

    els.lutList.innerHTML = filtered.map((lut) => {
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

    els.lutList.querySelectorAll('.lut-item').forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      const thumbDiv = el.querySelector('.lut-thumb');
      if (thumbDiv && state.luts[idx] && state.luts[idx].thumb) {
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
    if (index < 0 || index >= state.luts.length) return;
    state.currentLutIndex = index;
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
    if (state.currentLutIndex >= 0) {
      const lut = state.luts[state.currentLutIndex];
      els.lutInfoName.textContent = lut.name;
      const engine = useWebgl ? 'WebGL' : 'CPU';
      els.lutInfoMeta.textContent = `${lut.size}³  ${lut.type.toUpperCase()}  ${engine}  ●  ${state.currentLutIndex + 1} / ${state.luts.length}`;
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
  }

  /* ── Status ── */

  function setStatus(msg) {
    els.statusText.textContent = msg;
  }

  /* ── Helpers ── */

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
