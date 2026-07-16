(function () {
  const state = {
    luts: [],
    currentLutIndex: -1,
    sourceImage: null,
    compareMode: false,
    favorites: JSON.parse(localStorage.getItem('lutFavorites') || '[]'),
  };

  const elements = {
    canvas: document.getElementById('previewCanvas'),
    container: document.getElementById('canvasContainer'),
    placeholder: document.getElementById('placeholder'),
    lutList: document.getElementById('lutList'),
    lutSearch: document.getElementById('lutSearch'),
    imageInput: document.getElementById('imageInput'),
    toggleCompareBtn: document.getElementById('toggleCompareBtn'),
    resetViewBtn: document.getElementById('resetViewBtn'),
    loadLutDirBtn: document.getElementById('loadLutDirBtn'),
    statusText: document.getElementById('statusText'),
  };

  let ctx = elements.canvas.getContext('2d');
  let cachedOriginalData = null;

  elements.lutSearch.addEventListener('input', renderLutList);

  elements.imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await loadImage(file);
  });

  elements.container.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.container.style.outline = '2px dashed var(--accent)';
  });

  elements.container.addEventListener('dragleave', () => {
    elements.container.style.outline = '';
  });

  elements.container.addEventListener('drop', async (e) => {
    e.preventDefault();
    elements.container.style.outline = '';
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const imgFile = Array.from(files).find(f => f.type.startsWith('image/'));
      if (imgFile) await loadImage(imgFile);
    }
  });

  elements.toggleCompareBtn.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    elements.toggleCompareBtn.textContent = state.compareMode ? '退出对比' : '对比模式';
    renderPreview();
  });

  elements.resetViewBtn.addEventListener('click', () => {
    fitCanvas();
    renderPreview();
  });

  elements.loadLutDirBtn.addEventListener('click', () => {
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectLut(state.currentLutIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectLut(state.currentLutIndex - 1);
    }
  });

  async function loadImage(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      state.sourceImage = img;
      fitCanvas();
      renderPreview();
      setStatus(`已加载: ${file.name}`);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function fitCanvas() {
    if (!state.sourceImage) return;
    const rect = elements.container.getBoundingClientRect();
    const maxW = rect.width - 20;
    const maxH = rect.height - 20;
    const scale = Math.min(maxW / state.sourceImage.width, maxH / state.sourceImage.height, 1);
    const w = Math.floor(state.sourceImage.width * scale);
    const h = Math.floor(state.sourceImage.height * scale);
    elements.canvas.width = w;
    elements.canvas.height = h;
    elements.canvas.style.display = 'block';
    elements.placeholder.style.display = 'none';
  }

  function renderPreview() {
    if (!state.sourceImage) return;
    const lut = state.currentLutIndex >= 0 ? state.luts[state.currentLutIndex] : null;

    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    ctx.drawImage(state.sourceImage, 0, 0, elements.canvas.width, elements.canvas.height);

    if (lut) {
      const imageData = ctx.getImageData(0, 0, elements.canvas.width, elements.canvas.height);
      if (state.compareMode) {
        LUTApply.applyLUTWithSplit(imageData, lut, 0.5);
      } else {
        LUTApply.applyLUT(imageData, lut);
      }
      ctx.putImageData(imageData, 0, 0);

      if (state.compareMode) {
        ctx.strokeStyle = 'var(--accent)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const splitX = elements.canvas.width / 2;
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, elements.canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'var(--accent)';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LUT', splitX / 2, 20);
        ctx.fillText('原始', splitX + splitX / 2, 20);
      }
    }

    updateStatusLut();
  }

  function updateStatusLut() {
    if (state.currentLutIndex >= 0) {
      const lut = state.luts[state.currentLutIndex];
      setStatus(`${lut.name}  (${state.currentLutIndex + 1}/${state.luts.length})`);
    } else if (state.sourceImage) {
      setStatus('请选择一个 LUT');
    }
  }

  async function loadLutFiles(files) {
    state.luts = [];
    state.currentLutIndex = -1;

    for (const file of files) {
      try {
        const lut = await LUTParser.parseLUT(file);
        state.luts.push(lut);
      } catch (err) {
        console.warn(`加载失败: ${file.name}`, err);
      }
    }

    state.luts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    renderLutList();
    if (state.luts.length > 0) {
      selectLut(0);
    }
    setStatus(`已加载 ${state.luts.length} 个 LUT`);
  }

  function renderLutList() {
    const keyword = elements.lutSearch.value.trim().toLowerCase();
    const filtered = keyword
      ? state.luts.filter(l => l.name.toLowerCase().includes(keyword))
      : state.luts;

    elements.lutList.innerHTML = filtered.map((lut, idx) => {
      const realIdx = state.luts.indexOf(lut);
      const isActive = realIdx === state.currentLutIndex;
      const isFav = state.favorites.includes(lut.name);
      return `<div class="lut-item ${isActive ? 'active' : ''}" data-index="${realIdx}">
        <span class="lut-name">${lut.name}</span>
        <span class="lut-badge">${lut.size}</span>
        <button class="favorite-btn ${isFav ? 'active' : ''}" data-lutname="${lut.name}">${isFav ? '★' : '☆'}</button>
      </div>`;
    }).join('');

    elements.lutList.querySelectorAll('.lut-item').forEach(el => {
      el.addEventListener('click', () => {
        selectLut(parseInt(el.dataset.index, 10));
      });
    });

    elements.lutList.querySelectorAll('.favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.lutname);
      });
    });
  }

  function selectLut(index) {
    if (index < 0 || index >= state.luts.length) return;
    state.currentLutIndex = index;
    renderLutList();
    renderPreview();
    const el = elements.lutList.querySelector(`.lut-item[data-index="${index}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

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

  function setStatus(msg) {
    elements.statusText.textContent = msg;
  }
})();
