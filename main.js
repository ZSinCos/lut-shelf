const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const exifr = require('exifr');
const LutDB = require('./database');

let mainWindow;
let db;
let dbPath;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DB_FILE = 'lut.db';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(config) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
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
        { label: '重新扫描', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.send('menu-rescan') },
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
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '全部置于顶层' }] : []),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 LUT 预览工具',
          click: () => {
            const stats = db ? db.getAllStats() : { luts: 0, folders: 0 };
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: 'LUT 预览工具',
              detail: `基于 Electron 的 LUT 管理工具\n数据库: ${stats.luts} 个 LUT, ${stats.folders} 个文件夹`,
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
    title: 'LUT 书架',
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

app.whenReady().then(() => {
  dbPath = path.join(app.getPath('userData'), DB_FILE);
  db = new LutDB(dbPath);
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ── IPC Handlers ── */

ipcMain.handle('select-dir', async () => {
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

ipcMain.handle('scan-tree', async (event, dirPath) => {
  if (!db) return { folders: [], files: [] };
  if (!dirPath) return { folders: [], files: [] };

  const win = BrowserWindow.fromWebContents(event.sender);
  const stats = await db.scanAndSync(dirPath, (scanned, added, removed, done) => {
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send('scan-progress', { scanned, added, removed, done });
      }
    } catch {}
  });
  const tree = db.getTree();
  tree._stats = stats;
  return tree;
});

ipcMain.handle('quick-check', async (event, dirPath) => {
  if (!db) return false;
  return db.quickCheck(dirPath);
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
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
      return { data: Buffer.from(thumb).toString('base64'), ext: '.jpg' };
    }
    const raw = fs.readFileSync(filePath);
    let jpegStart = -1;
    for (let i = 0; i < raw.length - 2; i++) {
      if (raw[i] === 0xFF && raw[i + 1] === 0xD8 && raw[i + 2] === 0xFF) {
        jpegStart = i;
        break;
      }
    }
    if (jpegStart < 0) throw new Error('No JPEG header');
    let jpegEnd = -1;
    for (let i = raw.length - 2; i > jpegStart; i--) {
      if (raw[i] === 0xFF && raw[i + 1] === 0xD9) {
        jpegEnd = i + 2;
        break;
      }
    }
    if (jpegEnd < 0) throw new Error('No JPEG footer');
    return { data: raw.slice(jpegStart, jpegEnd).toString('base64'), ext: '.jpg' };
  } catch (e) {
    console.error('[RAW]', e.message);
    return null;
  }
});

/* ── Thumbnail cache ── */

const THUMB_DIR = path.join(app.getPath('userData'), 'thumbs');
const THUMB_SOURCE_PATH = path.join(app.getPath('userData'), 'thumb-source.jpg');

function ensureThumbDir() {
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
}

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
    console.error('[Thumb]', e.message);
    return false;
  }
});

ipcMain.handle('thumb-get-source', async () => {
  try {
    if (!fs.existsSync(THUMB_SOURCE_PATH)) return null;
    return { data: fs.readFileSync(THUMB_SOURCE_PATH).toString('base64') };
  } catch {
    return null;
  }
});

ipcMain.handle('thumb-cache-get', async (event, key) => {
  ensureThumbDir();
  const fp = path.join(THUMB_DIR, `${key}.png`);
  try {
    if (!fs.existsSync(fp)) return null;
    return { data: fs.readFileSync(fp).toString('base64') };
  } catch {
    return null;
  }
});

ipcMain.handle('thumb-cache-put', async (event, { key, dataBase64 }) => {
  ensureThumbDir();
  try {
    fs.writeFileSync(path.join(THUMB_DIR, `${key}.png`), Buffer.from(dataBase64, 'base64'));
    return true;
  } catch {
    return false;
  }
});

/* ── Database IPC ── */

ipcMain.handle('db-get-lut', async (event, filePath) => {
  if (!db) return null;
  return db.getLutByPath(filePath);
});

ipcMain.handle('db-update-notes', async (event, { path, notes }) => {
  if (!db) return false;
  db.updateNotes(path, notes);
  return true;
});

ipcMain.handle('db-update-author', async (event, { path, author }) => {
  if (!db) return false;
  db.updateAuthor(path, author);
  return true;
});

ipcMain.handle('db-update-description', async (event, { path, description }) => {
  if (!db) return false;
  db.updateDescription(path, description);
  return true;
});

ipcMain.handle('db-search', async (event, query) => {
  if (!db) return [];
  return db.search(query);
});

ipcMain.handle('db-get-folder-files', async (event, folderPath) => {
  if (!db) return [];
  return db.getFolderFiles(folderPath);
});

ipcMain.handle('db-get-stats', async () => {
  if (!db) return { luts: 0, folders: 0 };
  return db.getAllStats();
});

ipcMain.handle('db-toggle-favorite', async (event, filePath) => {
  if (!db) return false;
  return db.toggleFavorite(filePath);
});

ipcMain.handle('db-get-favorites', async () => {
  if (!db) return [];
  return db.getFavorites();
});

ipcMain.handle('db-re-scan', async (event, dirPath) => {
  if (!db) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  return db.scanAndSync(dirPath, (scanned, added, removed, done) => {
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.send('scan-progress', { scanned, added, removed, done });
      }
    } catch {}
  });
});

ipcMain.handle('parse-lut-size', async (event, filePath) => {
  if (!db) return 0;
  return db.parseAndSaveLutSize(filePath);
});
