const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
