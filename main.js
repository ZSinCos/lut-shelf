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
