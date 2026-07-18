const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDir: () => ipcRenderer.invoke('select-dir'),
  scanTree: (dirPath) => ipcRenderer.invoke('scan-tree', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  extractRawPreview: (filePath) => ipcRenderer.invoke('extract-raw-preview', filePath),
  thumbGetSource: () => ipcRenderer.invoke('thumb-get-source'),
  thumbSetSource: (filePath) => ipcRenderer.invoke('thumb-set-source', filePath),
  thumbCacheGet: (key) => ipcRenderer.invoke('thumb-cache-get', key),
  thumbCachePut: (key, dataBase64) => ipcRenderer.invoke('thumb-cache-put', { key, dataBase64 }),
  onAutoLoadLuts: (callback) => ipcRenderer.on('auto-load-luts', (_event, dir) => callback(dir)),
  onMenuLutDirSelected: (callback) => ipcRenderer.on('menu-lut-dir-selected', (_event, dir) => callback(dir)),
});
