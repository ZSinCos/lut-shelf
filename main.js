const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const exifr = require('exifr');

let mainWindow;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('读取配置失败:', e);
  }
  return {};
}

function saveConfig(config) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '选择 LUT 文件夹',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: '选择 LUT 文件夹',
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send('menu-lut-dir-selected', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: '全部置于顶层' },
        ] : []),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 LUT 预览工具',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: 'LUT 预览工具',
              detail: '基于 Electron 的 LUT 实时预览工具\n支持 .vlt / .cube 格式',
            });
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'LUT 预览工具',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  buildMenu();
  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const config = loadConfig();
  if (config.lutDir) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('auto-load-luts', config.lutDir);
    });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ── IPC handlers ── */

ipcMain.handle('select-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 LUT 文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-lut-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 LUT 文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('save-lut-dir', async (event, dirPath) => {
  const config = loadConfig();
  config.lutDir = dirPath;
  saveConfig(config);
  return true;
});

ipcMain.handle('scan-lut-dir', async (event, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath);
    const lutFiles = files
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ext === '.vlt' || ext === '.cube';
      })
      .map(f => ({
        name: f,
        path: path.join(dirPath, f),
      }));
    return lutFiles;
  } catch (e) {
    console.error('扫描目录失败:', e);
    return [];
  }
});

ipcMain.handle('read-lut-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error('读取LUT文件失败:', e);
    return null;
  }
});

ipcMain.handle('save-file', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出图片',
    defaultPath: options.defaultName || 'export.png',
    filters: options.filters || [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const buf = Buffer.from(options.dataBase64, 'base64');
  fs.writeFileSync(result.filePath, buf);
  return result.filePath;
});

ipcMain.handle('extract-raw-preview', async (event, filePath) => {
  try {
    let thumb = await exifr.thumbnail(filePath);
    if (thumb) {
      const buf = Buffer.from(thumb);
      return { data: buf.toString('base64'), ext: '.jpg' };
    }
    const raw = fs.readFileSync(filePath);
    let jpegStart = -1;
    for (let i = 0; i < raw.length - 2; i++) {
      if (raw[i] === 0xFF && raw[i + 1] === 0xD8 && raw[i + 2] === 0xFF) {
        jpegStart = i;
        break;
      }
    }
    if (jpegStart < 0) throw new Error('未找到 JPEG 数据');
    let jpegEnd = -1;
    for (let i = raw.length - 2; i > jpegStart; i--) {
      if (raw[i] === 0xFF && raw[i + 1] === 0xD9) {
        jpegEnd = i + 2;
        break;
      }
    }
    if (jpegEnd < 0) throw new Error('未找到 JPEG 结束标记');
    const jpegBuf = raw.slice(jpegStart, jpegEnd);
    console.log(`[RAW] 内嵌JPEG: 偏移 ${jpegStart}, 大小 ${jpegBuf.length} 字节`);
    return { data: jpegBuf.toString('base64'), ext: '.jpg' };
  } catch (e) {
    console.error('提取RAW预览失败:', e);
    return null;
  }
});

/* ── Repo (folder-based, like Obsidian) ── */

const LUT_EXTENSIONS = new Set(['.vlt', '.cube']);

function getRepoPath() {
  const config = loadConfig();
  return config.repoDir || null;
}

function saveRepoPath(dirPath) {
  const config = loadConfig();
  config.repoDir = dirPath;
  saveConfig(config);
}

function getMetaPath(repoDir) {
  return path.join(repoDir, '.lutmeta.json');
}

function loadMeta(repoDir) {
  const metaPath = getMetaPath(repoDir);
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch (e) {
    console.error('读取 .lutmeta.json 失败:', e);
  }
  return {};
}

function saveMeta(repoDir, meta) {
  const metaPath = getMetaPath(repoDir);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

function guessLutSize(content) {
  const match = content.match(/LUT_3D_SIZE\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 17;
}

/* Scan repo folder: return { folders: [...], files: [...] } */
function scanRepoSync(repoDir, relativePath) {
  const absDir = relativePath ? path.join(repoDir, relativePath) : repoDir;
  const folders = [];
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    return { folders, files };
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const rel = relativePath ? path.join(relativePath, name) : name;
    if (entry.isDirectory()) {
      folders.push({ name, relativePath: rel });
    } else if (entry.isFile() && LUT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      const content = fs.readFileSync(path.join(absDir, name), 'utf8');
      files.push({
        name,
        relativePath: rel,
        size: guessLutSize(content),
        type: path.extname(name).slice(1),
      });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

/* ── IPC handlers ── */

ipcMain.handle('repo-select-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择 LUT 仓库文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  saveRepoPath(dir);
  return dir;
});

ipcMain.handle('repo-get-dir', async () => {
  return getRepoPath();
});

ipcMain.handle('repo-scan', async (event, relativePath) => {
  const repoDir = getRepoPath();
  if (!repoDir) return { folders: [], files: [] };
  return scanRepoSync(repoDir, relativePath || '');
});

ipcMain.handle('repo-read-file', async (event, relativePath) => {
  const repoDir = getRepoPath();
  if (!repoDir) return null;
  const fp = path.join(repoDir, relativePath);
  try {
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf8');
  } catch (e) {
    console.error('读取仓库文件失败:', e);
    return null;
  }
});

ipcMain.handle('repo-import-files', async () => {
  const repoDir = getRepoPath();
  if (!repoDir) return 0;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '导入 LUT 文件到仓库',
    filters: [{ name: 'LUT 文件', extensions: ['vlt', 'cube'] }],
  });
  if (result.canceled || !result.filePaths) return 0;
  let count = 0;
  for (const src of result.filePaths) {
    try {
      const name = path.basename(src);
      const dest = path.join(repoDir, name);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        count++;
      }
    } catch (e) {
      console.error('导入失败:', e);
    }
  }
  return count;
});

ipcMain.handle('repo-create-folder', async (event, folderName) => {
  const repoDir = getRepoPath();
  if (!repoDir) return false;
  try {
    const fp = path.join(repoDir, folderName);
    if (!fs.existsSync(fp)) {
      fs.mkdirSync(fp, { recursive: true });
    }
    return true;
  } catch (e) {
    console.error('创建文件夹失败:', e);
    return false;
  }
});

ipcMain.handle('repo-delete', async (event, relativePath) => {
  const repoDir = getRepoPath();
  if (!repoDir) return false;
  const fp = path.join(repoDir, relativePath);
  try {
    if (fs.statSync(fp).isDirectory()) {
      fs.rmSync(fp, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fp);
    }
    return true;
  } catch (e) {
    console.error('删除失败:', e);
    return false;
  }
});

ipcMain.handle('repo-rename', async (event, { oldPath, newName }) => {
  const repoDir = getRepoPath();
  if (!repoDir) return false;
  try {
    const src = path.join(repoDir, oldPath);
    const dir = path.dirname(src);
    const dest = path.join(dir, newName);
    if (fs.existsSync(dest)) return false;
    fs.renameSync(src, dest);
    return true;
  } catch (e) {
    console.error('重命名失败:', e);
    return false;
  }
});

ipcMain.handle('repo-move-file', async (event, { fileRelPath, targetFolderRel }) => {
  const repoDir = getRepoPath();
  if (!repoDir) return false;
  try {
    const src = path.join(repoDir, fileRelPath);
    const fileName = path.basename(fileRelPath);
    const destDir = path.join(repoDir, targetFolderRel);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, fileName);
    if (fs.existsSync(dest)) return false;
    fs.renameSync(src, dest);
    return true;
  } catch (e) {
    console.error('移动文件失败:', e);
    return false;
  }
});

ipcMain.handle('repo-load-meta', async () => {
  const repoDir = getRepoPath();
  if (!repoDir) return {};
  return loadMeta(repoDir);
});

ipcMain.handle('repo-save-meta', async (event, meta) => {
  const repoDir = getRepoPath();
  if (!repoDir) return;
  saveMeta(repoDir, meta);
});

ipcMain.handle('repo-load-order', async () => {
  const repoDir = getRepoPath();
  if (!repoDir) return [];
  const orderPath = path.join(repoDir, '.reporder.json');
  try {
    if (!fs.existsSync(orderPath)) return [];
    return JSON.parse(fs.readFileSync(orderPath, 'utf8'));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('repo-save-order', async (event, order) => {
  const repoDir = getRepoPath();
  if (!repoDir) return;
  const orderPath = path.join(repoDir, '.reporder.json');
  try {
    fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));
  } catch (e) {
    console.error('保存顺序失败:', e);
  }
});

/* ── Thumbnail system ── */

const THUMB_DIR = path.join(app.getPath('userData'), 'thumbs');
const THUMB_SOURCE_PATH = path.join(app.getPath('userData'), 'thumb-source.jpg');

function ensureThumbDir() {
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
}

/* Extract JPEG preview from RAW/any image and save as thumb-source */
ipcMain.handle('thumb-set-source', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return false;
    const ext = path.extname(filePath).toLowerCase();
    let jpegBuf = null;
    if (['.rw2', '.arw', '.cr2', '.cr3', '.nef', '.nrw', '.orf', '.raf', '.dng', '.pef', '.srw', '.x3f'].includes(ext)) {
      const raw = fs.readFileSync(filePath);
      for (let i = 0; i < raw.length - 2; i++) {
        if (raw[i] === 0xFF && raw[i + 1] === 0xD8 && raw[i + 2] === 0xFF) {
          let end = raw.length - 2;
          for (let j = raw.length - 2; j > i; j--) {
            if (raw[j] === 0xFF && raw[j + 1] === 0xD9) { end = j + 2; break; }
          }
          jpegBuf = raw.slice(i, end);
          break;
        }
      }
    } else {
      jpegBuf = fs.readFileSync(filePath);
    }
    if (!jpegBuf) return false;
    fs.writeFileSync(THUMB_SOURCE_PATH, jpegBuf);
    return { data: jpegBuf.toString('base64') };
  } catch (e) {
    console.error('设置缩略图源失败:', e);
    return false;
  }
});

ipcMain.handle('thumb-get-source', async () => {
  try {
    if (!fs.existsSync(THUMB_SOURCE_PATH)) return null;
    const buf = fs.readFileSync(THUMB_SOURCE_PATH);
    return { data: buf.toString('base64') };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('thumb-cache-get', async (event, key) => {
  ensureThumbDir();
  const fp = path.join(THUMB_DIR, `${key}.png`);
  try {
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    return { data: buf.toString('base64') };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('thumb-cache-put', async (event, { key, dataBase64 }) => {
  ensureThumbDir();
  try {
    const buf = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(path.join(THUMB_DIR, `${key}.png`), buf);
    return true;
  } catch (e) {
    console.error('缓存缩略图失败:', e);
    return false;
  }
});

/* ── Folder tree scan (recursive) ── */

const LUT_EXTS = new Set(['.vlt', '.cube', '.3dl', '.csp']);

function scanTreeSync(dirPath) {
  const result = { folders: [], files: [] };
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return result;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = scanTreeSync(full);
      if (sub.folders.length > 0 || sub.files.length > 0) {
        result.folders.push({ name: entry.name, children: sub });
      }
    } else if (entry.isFile() && LUT_EXTS.has(path.extname(entry.name).toLowerCase())) {
      const stats = fs.statSync(full);
      result.files.push({
        name: entry.name,
        path: full,
        size: stats.size,
        mtime: stats.mtimeMs,
      });
    }
  }
  return result;
}

ipcMain.handle('scan-tree', async (event, dirPath) => {
  return scanTreeSync(dirPath);
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
});
