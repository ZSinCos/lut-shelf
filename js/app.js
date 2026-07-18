(function () {
  const state = {
    rootPath: null,
    treeData: null,
    currentFolderPath: null,
    currentFolderFiles: [],
    currentLutPath: null,
    currentLut: null,
    sourceImage: null,
    sourceFileName: '',
    lutIntensity: 100,
    compareMode: false,
    previewActive: false,
    splitXRatio: 0.5,
    dragging: false,
  };

  const els = {
    loadDirBtn: document.getElementById('loadDirBtn'),
    headerPath: document.getElementById('headerPath'),
    headerCount: document.getElementById('headerCount'),
    folderTree: document.getElementById('folderTree'),
    shelfGrid: document.getElementById('shelfGrid'),
    shelfTitle: document.getElementById('shelfTitle'),
    shelfSearch: document.getElementById('shelfSearch'),
    shelfPagination: document.getElementById('shelfPagination'),
    pagePrevBtn: document.getElementById('pagePrevBtn'),
    pageNextBtn: document.getElementById('pageNextBtn'),
    pageInfo: document.getElementById('pageInfo'),
    infoPanel: document.getElementById('infoPanel'),
    infoEmpty: document.getElementById('infoEmpty'),
    infoContent: document.getElementById('infoContent'),
    infoName: document.getElementById('infoName'),
    infoFormat: document.getElementById('infoFormat'),
    infoSize: document.getElementById('infoSize'),
    infoPath: document.getElementById('infoPath'),
    infoPreviewCanvas: document.getElementById('infoPreviewCanvas'),
    previewFromInfoBtn: document.getElementById('previewFromInfoBtn'),
    previewOverlay: document.getElementById('previewOverlay'),
    previewBackBtn: document.getElementById('previewBackBtn'),
    previewCanvas: document.getElementById('previewCanvas'),
    imageInput: document.getElementById('imageInput'),
    toggleCompareBtn: document.getElementById('toggleCompareBtn'),
    intensitySlider: document.getElementById('intensitySlider'),
    intensityValue: document.getElementById('intensityValue'),
    exportBtn: document.getElementById('exportBtn'),
    exportFormat: document.getElementById('exportFormat'),
    statusText: document.getElementById('statusText'),
    headerStatus: document.getElementById('headerStatus'),
    placeholder: document.querySelector('.preview-canvas-wrap .placeholder'),
    infoNotes: document.getElementById('infoNotes'),
    infoAuthorInput: document.getElementById('infoAuthor'),
    infoDescInput: document.getElementById('infoDesc'),
    favSection: document.getElementById('favSection'),
    favCount: document.getElementById('favCount'),
    favBtn: document.getElementById('favBtn'),
    clearImageBtn: document.getElementById('clearImageBtn'),
    expandAllBtn: document.getElementById('expandAllBtn'),
    collapseAllBtn: document.getElementById('collapseAllBtn'),
  };
  let noteSaveTimer = null;

  const isElectron = !!window.electronAPI;
  const RAW_EXTS = ['rw2', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'dng', 'pef', 'srw', 'x3f'];

  let ctx = els.previewCanvas.getContext('2d');
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
    if (isElectron && window.electronAPI.saveLutDir) {
      window.electronAPI.saveLutDir(dir);
    }
    loadDirFromPath(dir);
  });

  function countAllFiles(node) {
    let n = node.files.length;
    for (const f of node.folders) n += countAllFiles(f.children);
    return n;
  }

  function getAllLutFiles(node, basePath) {
    const files = [];
    const prefix = basePath ? basePath + '\\' : '';
    for (const f of node.files) {
      files.push(f);
    }
    for (const f of node.folders) {
      files.push(...getAllLutFiles(f.children, prefix + f.name));
    }
    return files;
  }

  function renderTree() {
    els.folderTree.innerHTML = '';
    if (!state.treeData) {
      els.folderTree.innerHTML = '<div class="empty-state"><p>点击「选择目录」</p></div>';
      return;
    }
    const container = document.createElement('div');
    renderTreeNodes(state.treeData, container, 0);
    els.folderTree.appendChild(container);
  }

  function renderTreeNodes(node, container, depth) {
    for (const f of node.folders) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (12 + depth * 14) + 'px';

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

      const hasLuts = getAllLutFiles(f.children, f.name).length > 0;
      if (!hasLuts) {
        toggle.style.visibility = 'hidden';
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        els.favSection.classList.remove('active');
        selectFolder(f, f.name);
        const isOpen = childrenDiv.classList.toggle('open');
        toggle.classList.toggle('expanded', isOpen);
      });

      container.appendChild(item);
      container.appendChild(childrenDiv);
      renderTreeNodes(f.children, childrenDiv, depth + 1);
    }

    for (const f of node.files) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (12 + depth * 14 + 18) + 'px';
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
        els.favSection.classList.remove('active');
        selectLutFile(f);
      });

      container.appendChild(item);
    }
  }

  async function selectFolder(folderNode, folderName) {
    els.folderTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    const folderPath = folderNode.path || folderName;
    state.currentFolderPath = folderPath;
    els.shelfTitle.textContent = folderName;

    let lutFiles;
    if (isElectron && window.electronAPI.dbGetFolderFiles) {
      const rows = await window.electronAPI.dbGetFolderFiles(folderPath);
      lutFiles = rows.map(r => ({ name: r.name, path: r.path, size: r.file_size, mtime: r.mtime }));
    } else {
      lutFiles = getAllLutFiles(folderNode.children, folderName);
    }
    state.currentFolderFiles = lutFiles;
    searchActive = false;
    els.shelfSearch.value = '';
    renderShelf(lutFiles);
  }

  /* ── Bookshelf Grid ── */

  const MIN_CARD_W = 180;
  const ROWS_PER_PAGE = 5;
  const pagination = { files: [], page: 0, pageSize: 30, totalPages: 0 };

  let shelfObserver = null;
  let wheelAccum = 0;
  let gridResizeObs = null;

  function calcPageSize() {
    const w = els.shelfGrid.clientWidth;
    if (w <= 0) return 30;
    const gap = 12;
    const cols = Math.max(1, Math.floor((w + gap) / (MIN_CARD_W + gap)));
    return cols * ROWS_PER_PAGE;
  }

  function recalcPagination() {
    const newSize = calcPageSize();
    if (newSize === pagination.pageSize && pagination.totalPages > 0) return false;
    pagination.pageSize = newSize;
    pagination.totalPages = Math.max(1, Math.ceil(pagination.files.length / newSize));
    pagination.page = Math.min(pagination.page, pagination.totalPages - 1);
    return true;
  }

  function renderShelf(files) {
    const grid = els.shelfGrid;
    pagination.files = files;
    pagination.page = 0;
    pagination.pageSize = calcPageSize();
    pagination.totalPages = Math.max(1, Math.ceil(files.length / pagination.pageSize));
    if (files.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>此文件夹下没有 LUT 文件</p></div>';
      els.shelfPagination.style.display = 'none';
      return;
    }
    renderPage();
  }

  function renderPage() {
    const grid = els.shelfGrid;
    const activePath = els.shelfGrid.querySelector('.shelf-card.active')?.dataset.path;
    grid.innerHTML = '';

    if (shelfObserver) shelfObserver.disconnect();
    shelfObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const card = entry.target;
          const path = card.dataset.path;
          if (!card.dataset.thumbLoaded) {
            card.dataset.thumbLoaded = '1';
            generateThumbForCard(card, path);
          }
          shelfObserver.unobserve(card);
        }
      }
    }, { rootMargin: '200px' });

    const { files, page, pageSize, totalPages } = pagination;
    const start = page * pageSize;
    const pageFiles = files.slice(start, start + pageSize);

    for (const f of pageFiles) {
      const card = createShelfCard(f);
      if (activePath && card.dataset.path === activePath) card.classList.add('active');
      grid.appendChild(card);
      shelfObserver.observe(card);
    }

    const showPagination = totalPages > 1;
    els.shelfPagination.style.display = showPagination ? '' : 'none';
    if (showPagination) {
      els.pageInfo.textContent = `${page + 1} / ${totalPages}`;
      els.pagePrevBtn.disabled = page === 0;
      els.pageNextBtn.disabled = page >= totalPages - 1;
    }
  }

  els.pagePrevBtn.addEventListener('click', () => {
    if (pagination.page > 0) { pagination.page--; renderPage(); }
  });

  els.pageNextBtn.addEventListener('click', () => {
    if (pagination.page < pagination.totalPages - 1) { pagination.page++; renderPage(); }
  });

  els.shelfGrid.addEventListener('wheel', (e) => {
    if (pagination.totalPages <= 1) return;
    if (e.deltaMode === 0) {
      wheelAccum += e.deltaY;
    } else {
      wheelAccum += e.deltaY * 40;
    }
    if (Math.abs(wheelAccum) >= 80) {
      const dir = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      const newPage = pagination.page + dir;
      if (newPage >= 0 && newPage < pagination.totalPages) {
        pagination.page = newPage;
        renderPage();
        e.preventDefault();
      }
    } else {
      e.preventDefault();
    }
  }, { passive: false });

  /* Watch grid width changes (info panel open/close, resize) */
  if (window.ResizeObserver) {
    gridResizeObs = new ResizeObserver(() => {
      if (!pagination.files.length || searchActive) return;
      if (recalcPagination()) renderPage();
    });
    setTimeout(() => {
      if (els.shelfGrid) gridResizeObs.observe(els.shelfGrid);
    }, 100);
  }

  function extname(name) {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i) : '';
  }
  function basename(p) {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(i + 1) : p;
  }

  async function generateThumbForCard(card, filePath) {
    const thumbCanvas = card.querySelector('.shelf-card-thumb canvas');
    if (!thumbCanvas) return;
    const w = thumbCanvas.width, h = thumbCanvas.height;

    try {
      if (thumbSourceImg) {
        const s = thumbSourceImg;
        const scale = Math.max(w / s.width, h / s.height);
        const sw = s.width * scale, sh = s.height * scale;
        const sx = (sw - w) / 2, sy = (sh - h) / 2;
        const cx = thumbCanvas.getContext('2d');
        cx.drawImage(s, 0, 0, s.width, s.height, -sx, -sy, sw, sh);
        const imgData = cx.getImageData(0, 0, w, h);

        try {
          const content = await window.electronAPI.readFile(filePath);
          if (content) {
            const lut = LUTParser.parseLUTFromText(basename(filePath), content);
            LUTApply.applyLUT(imgData, lut);
          }
        } catch (e) {}

        cx.putImageData(imgData, 0, 0);
      }
    } catch (e) {}
  }

  /* ── Search ── */

  let searchActive = false;

  els.shelfSearch.addEventListener('input', () => {
    const q = els.shelfSearch.value.toLowerCase().trim();
    searchActive = q.length > 0;
    if (searchActive) {
      const grid = els.shelfGrid;
      grid.innerHTML = '';
      if (shelfObserver) shelfObserver.disconnect();
      els.shelfPagination.style.display = 'none';
      const doSearch = async () => {
        let results;
        if (isElectron && window.electronAPI.dbSearch) {
          results = await window.electronAPI.dbSearch(q);
        } else {
          results = pagination.files.filter(f => f.name.toLowerCase().includes(q));
        }
        if (els.shelfSearch.value.toLowerCase().trim() !== q) return;
        if (results.length === 0) {
          grid.innerHTML = '<div class="empty-state"><p>没有匹配的 LUT</p></div>';
          return;
        }
        shelfObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const card = entry.target;
              if (!card.dataset.thumbLoaded) {
                card.dataset.thumbLoaded = '1';
                generateThumbForCard(card, card.dataset.path);
              }
              shelfObserver.unobserve(card);
            }
          }
        }, { rootMargin: '200px' });
        for (const r of results) {
          const f = { name: r.name, path: r.path, size: r.file_size || 0, mtime: r.mtime || 0 };
          const card = createShelfCard(f);
          grid.appendChild(card);
          shelfObserver.observe(card);
        }
      };
      doSearch();
    } else {
      els.shelfPagination.style.display = pagination.totalPages > 1 ? '' : 'none';
      renderPage();
    }
  });

  function createShelfCard(f) {
    const card = document.createElement('div');
    card.className = 'shelf-card';
    card.dataset.path = f.path;

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'shelf-card-thumb';
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 320;
    thumbCanvas.height = 180;
    thumbDiv.appendChild(thumbCanvas);
    card.appendChild(thumbDiv);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'shelf-card-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'shelf-card-name';
    nameDiv.textContent = f.name;
    infoDiv.appendChild(nameDiv);
    const metaDiv = document.createElement('div');
    metaDiv.className = 'shelf-card-meta';
    metaDiv.textContent = extname(f.name).toLowerCase().slice(1);
    infoDiv.appendChild(metaDiv);
    card.appendChild(infoDiv);

    card.addEventListener('click', () => {
      els.shelfGrid.querySelectorAll('.shelf-card.active').forEach(el => el.classList.remove('active'));
      card.classList.add('active');
      selectLutFile(f);
    });
    card.addEventListener('dblclick', () => {
      selectLutFile(f).then(() => openPreview());
    });
    return card;
  }

  /* ── Select LUT ── */

  async function selectLutFile(fileInfo) {
    state.currentLutPath = fileInfo.path;
    state.currentLut = null;

    const content = await window.electronAPI.readFile(fileInfo.path);
    if (!content) { setStatus('读取失败'); return; }

    const lut = LUTParser.parseLUTFromText(fileInfo.name, content);
    state.currentLut = lut;

    // Lazily parse and save LUT size to DB
    if (isElectron && window.electronAPI.parseLutSize && lut.size > 0) {
      window.electronAPI.parseLutSize(fileInfo.path);
    }

    setStatus(`已加载: ${fileInfo.name}`);
    showInfo(lut, fileInfo);

    if (state.sourceImage) {
      cacheValid = false;
      renderPreview();
    }
  }

  /* ── Info panel ── */

  function guessAuthor(lutPath, lutName) {
    if (!state.rootPath) return '';
    const rel = lutPath.replace(state.rootPath, '');
    const parts = rel.split(/[/\\]/).filter(Boolean);
    for (const p of parts) {
      const known = ['ejay', '波子', 'booz', 'plady', '林馆长', '凉子', 'forrest'];
      for (const k of known) {
        if (p.toLowerCase().includes(k)) return p;
      }
    }
    return '';
  }

  function guessDescription(lutPath) {
    if (!state.rootPath) return '';
    const rel = lutPath.replace(state.rootPath, '');
    const parts = rel.split(/[/\\]/).filter(Boolean);
    const clues = [];
    for (const p of parts) {
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

    els.infoName.textContent = lut.name;
    els.infoFormat.textContent = lut.type.toUpperCase();
    els.infoSize.textContent = `${lut.size}³`;
    els.infoPath.textContent = fileInfo.path;

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
    }

    if (isElectron && window.electronAPI.dbGetLut) {
      window.electronAPI.dbGetLut(fileInfo.path).then(row => {
        if (!row) {
          els.infoAuthorInput.value = guessAuthor(fileInfo.path, lut.name) || '';
          els.infoDescInput.value = guessDescription(fileInfo.path) || '';
          els.infoNotes.value = '';
          els.favBtn.classList.remove('favorited');
          els.favBtn.textContent = '☆ 收藏';
          return;
        }
        els.infoAuthorInput.value = row.author || guessAuthor(fileInfo.path, lut.name) || '';
        els.infoDescInput.value = row.description || guessDescription(fileInfo.path) || '';
        els.infoNotes.value = row.notes || '';
        const isFav = !!row.favorite;
        els.favBtn.classList.toggle('favorited', isFav);
        els.favBtn.textContent = isFav ? '★ 已收藏' : '☆ 收藏';
      });
    } else {
      els.infoAuthorInput.value = guessAuthor(fileInfo.path, lut.name) || '';
      els.infoDescInput.value = guessDescription(fileInfo.path) || '';
      els.infoNotes.value = '';
      els.favBtn.classList.remove('favorited');
      els.favBtn.textContent = '☆ 收藏';
    }
  }

  function saveNoteField(field) {
    if (noteSaveTimer) clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(() => {
      const p = state.currentLutPath;
      if (!p || !isElectron) return;
      if (field === 'notes') {
        window.electronAPI.dbUpdateNotes(p, els.infoNotes.value);
      } else if (field === 'author') {
        window.electronAPI.dbUpdateAuthor(p, els.infoAuthorInput.value);
      } else if (field === 'description') {
        window.electronAPI.dbUpdateDescription(p, els.infoDescInput.value);
      }
    }, 400);
  }

  els.infoNotes.addEventListener('input', () => saveNoteField('notes'));
  els.infoAuthorInput.addEventListener('input', () => saveNoteField('author'));
  els.infoDescInput.addEventListener('input', () => saveNoteField('description'));

  /* ── Favorites ── */

  async function refreshFavCount() {
    if (!isElectron) return;
    try {
      const favs = await window.electronAPI.getFavorites();
      els.favCount.textContent = favs.length;
    } catch {}
  }

  async function showFavorites() {
    els.folderTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    els.favSection.classList.add('active');
    els.shelfTitle.textContent = '⭐ 我的收藏';
    searchActive = false;
    els.shelfSearch.value = '';

    let favs;
    try { favs = await window.electronAPI.getFavorites(); } catch { favs = []; }
    const files = favs.map(r => ({ name: r.name, path: r.path, size: r.file_size || 0, mtime: r.mtime || 0 }));
    state.currentFolderFiles = files;
    renderShelf(files);
  }

  els.favSection.addEventListener('click', () => {
    showFavorites();
  });

  els.favBtn.addEventListener('click', async () => {
    const p = state.currentLutPath;
    if (!p || !isElectron) return;
    const isFav = await window.electronAPI.toggleFavorite(p);
    els.favBtn.classList.toggle('favorited', isFav);
    els.favBtn.textContent = isFav ? ' 已收藏' : ' 收藏';
    refreshFavCount();
  });

  /* ── Tree expand/collapse ── */

  function expandAllTree() {
    els.folderTree.querySelectorAll('.tree-children').forEach(el => {
      el.classList.add('open');
    });
    els.folderTree.querySelectorAll('.tree-toggle').forEach(el => {
      if (el.style.visibility !== 'hidden') el.classList.add('expanded');
    });
  }

  function collapseAllTree() {
    els.folderTree.querySelectorAll('.tree-children').forEach(el => {
      el.classList.remove('open');
    });
    els.folderTree.querySelectorAll('.tree-toggle').forEach(el => {
      el.classList.remove('expanded');
    });
  }

  els.expandAllBtn.addEventListener('click', expandAllTree);
  els.collapseAllBtn.addEventListener('click', collapseAllTree);

  /* ── Preview Overlay ── */

  els.previewFromInfoBtn.addEventListener('click', openPreview);

  els.previewBackBtn.addEventListener('click', closePreview);

  function openPreview() {
    if (!state.currentLut) return;
    els.previewOverlay.style.display = 'flex';
    state.previewActive = true;
    if (!state.sourceImage) {
      loadDefaultImage();
    }
  }

  function closePreview() {
    els.previewOverlay.style.display = 'none';
    state.previewActive = false;
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

  els.clearImageBtn.addEventListener('click', () => {
    if (thumbSourceImg) {
      loadDefaultImage();
      setStatus('已切换回默认参考图');
    }
  });

  const canvasWrap = els.previewCanvas.parentElement;
  canvasWrap.addEventListener('dragover', (e) => { e.preventDefault(); canvasWrap.style.outline = '2px dashed var(--accent)'; });
  canvasWrap.addEventListener('dragleave', () => { canvasWrap.style.outline = ''; });
  canvasWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    canvasWrap.style.outline = '';
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
    const rect = canvasWrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { setTimeout(fitCanvas, 50); return; }
    const pad = 20;
    const maxW = Math.max(rect.width - pad, 100);
    const maxH = Math.max(rect.height - pad, 100);
    const scale = Math.min(maxW / state.sourceImage.width, maxH / state.sourceImage.height, 1);
    const w = Math.floor(state.sourceImage.width * scale);
    const h = Math.floor(state.sourceImage.height * scale);
    els.previewCanvas.width = Math.max(w, 1);
    els.previewCanvas.height = Math.max(h, 1);
    origCache.width = els.previewCanvas.width;
    origCache.height = els.previewCanvas.height;
    lutCache.width = els.previewCanvas.width;
    lutCache.height = els.previewCanvas.height;
    els.previewCanvas.style.display = 'block';
    els.placeholder.style.display = 'none';
    cacheValid = false;
  }

  /* ── Rendering ── */

  function renderLutToCanvas(canvas, ctxt, lut) {
    let ok = false;
    if (useWebgl && webgl) {
      webgl.resize(canvas.width, canvas.height);
      webgl.uploadImage(state.sourceImage);
      webgl.uploadLUT(lut);
      ok = webgl.render(canvas.width, canvas.height, false);
      if (ok) {
        ctxt.clearRect(0, 0, canvas.width, canvas.height);
        ctxt.drawImage(webglCanvas, 0, 0);
      }
    }
    if (!ok) {
      ctxt.clearRect(0, 0, canvas.width, canvas.height);
      ctxt.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, canvas.width, canvas.height);
      const imageData = ctxt.getImageData(0, 0, canvas.width, canvas.height);
      LUTApply.applyLUT(imageData, lut);
      ctxt.putImageData(imageData, 0, 0);
    }
  }

  function rebuildCache() {
    if (!state.sourceImage || !state.currentLut) return;
    const w = els.previewCanvas.width, h = els.previewCanvas.height;
    if (w === 0 || h === 0) return;
    origCtx.clearRect(0, 0, w, h);
    origCtx.drawImage(state.sourceImage, 0, 0, state.sourceImage.width, state.sourceImage.height, 0, 0, w, h);
    renderLutToCanvas(lutCache, lutCtx, state.currentLut);
    cacheValid = true;
  }

  function renderPreview() {
    if (!state.sourceImage || !state.currentLut) return;
    const w = els.previewCanvas.width, h = els.previewCanvas.height;
    if (w === 0 || h === 0) return;
    try {
      if (!cacheValid) rebuildCache();
      const intensityAlpha = state.lutIntensity / 100;
      ctx.clearRect(0, 0, w, h);
      if (state.compareMode) {
        const splitX = Math.round(w * state.splitXRatio);
        // Left side: original
        ctx.drawImage(origCache, 0, 0, splitX, h, 0, 0, splitX, h);
        // Right side: LUT at intensity
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, w - splitX, h);
        ctx.clip();
        ctx.drawImage(lutCache, 0, 0, w, h);
        if (intensityAlpha < 1) {
          ctx.globalAlpha = 1 - intensityAlpha;
          ctx.drawImage(origCache, 0, 0, w, h);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        // Split line
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
        ctx.fillText('原始', Math.round(splitX / 2), 18);
        ctx.fillText('LUT', Math.round(splitX + (w - splitX) / 2), 18);
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

  els.intensitySlider.addEventListener('input', () => {
    state.lutIntensity = parseInt(els.intensitySlider.value);
    els.intensityValue.textContent = `${state.lutIntensity}%`;
    renderPreview();
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.previewActive) { fitCanvas(); renderPreview(); } }, 150);
  });

  /* ── Compare mode drag ── */

  els.previewCanvas.addEventListener('mousedown', (e) => {
    if (!state.compareMode) return;
    const rect = els.previewCanvas.getBoundingClientRect();
    const scaleX = els.previewCanvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const splitX = Math.round(els.previewCanvas.width * state.splitXRatio);
    if (Math.abs(mx - splitX) < 12) {
      state.dragging = true;
      els.previewCanvas.style.cursor = 'ew-resize';
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const rect = els.previewCanvas.getBoundingClientRect();
    const scaleX = els.previewCanvas.width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    state.splitXRatio = Math.max(0.05, Math.min(0.95, mx / els.previewCanvas.width));
    renderPreview();
    e.preventDefault();
  });

  document.addEventListener('mouseup', () => {
    if (state.dragging) { state.dragging = false; els.previewCanvas.style.cursor = ''; }
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
        const filePath = await window.electronAPI.saveFile({
          dataBase64: base64,
          defaultName,
          filters: fmt === 'jpg'
            ? [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
            : [{ name: 'PNG', extensions: ['png'] }],
        });
        setStatus(filePath ? `已导出: ${filePath}` : '导出取消');
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
    const splitterLeft = document.getElementById('splitterLeft');
    const splitterRight = document.getElementById('splitterRight');
    const sidebar = document.getElementById('sidebar');
    const infoPanel = document.getElementById('infoPanel');
    let drag = false, dragRight = false;

    splitterLeft.addEventListener('mousedown', (e) => {
      drag = true;
      splitterLeft.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    splitterRight.addEventListener('mousedown', (e) => {
      dragRight = true;
      splitterRight.classList.add('active');
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
      if (drag) { drag = false; splitterLeft.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
      if (dragRight) { dragRight = false; splitterRight.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    });
  })();

  /* ── Utils ── */

  function setStatus(msg) {
    if (els.statusText) els.statusText.textContent = msg;
    if (els.headerStatus) els.headerStatus.textContent = msg;
  }

  function updateButtons() {
    const hasLut = !!state.currentLut;
    const hasImage = !!state.sourceImage;
    els.toggleCompareBtn.disabled = !(hasLut && hasImage);
    const canExport = hasLut && hasImage;
    els.exportBtn.disabled = !canExport;
    els.exportFormat.disabled = !canExport;
    els.intensitySlider.disabled = !(hasLut && hasImage);
  }

  /* ── IPC events from menu/auto-load ── */

  if (isElectron && window.electronAPI.onAutoLoadLuts) {
    window.electronAPI.onAutoLoadLuts((dir) => {
      if (dir) setTimeout(() => loadDirFromPath(dir), 300);
    });
  }
  if (isElectron && window.electronAPI.onMenuLutDirSelected) {
    window.electronAPI.onMenuLutDirSelected((dir) => {
      if (dir) loadDirFromPath(dir);
    });
  }
  if (isElectron && window.electronAPI.onMenuRescan) {
    window.electronAPI.onMenuRescan(() => {
      if (state.rootPath) loadDirFromPath(state.rootPath);
    });
  }

  refreshFavCount();

  async function loadDirFromPath(dir) {
    state.rootPath = dir;
    els.headerPath.textContent = dir;
    setStatus('正在扫描... 0 个文件');
    if (isElectron && window.electronAPI.saveLutDir) {
      window.electronAPI.saveLutDir(dir);
    }
    if (isElectron && window.electronAPI.onScanProgress) {
      window.electronAPI.onScanProgress((data) => {
        if (data.done) {
          setStatus(`扫描完成: ${data.scanned} 个文件`);
        } else {
          setStatus(`正在扫描... ${data.scanned} 个文件`);
        }
      });
    } else if (isElectron) {
      setStatus('正在扫描...');
    }
    const tree = await window.electronAPI.scanTree(dir);
    state.treeData = tree;
    renderTree();
    els.favSection.classList.remove('active');
    const stats = tree._stats || {};
    const count = countAllFiles(tree);
    els.headerCount.textContent = `${count} 个 LUT`;
    setStatus(`已加载 ${count} 个 LUT (新增 ${stats.added || 0}, 移除 ${stats.removed || 0})`);
    refreshFavCount();
  }

  setTimeout(async () => {
    if (thumbSourceImg) {
      await loadDefaultImage();
    }
  }, 500);
})();
