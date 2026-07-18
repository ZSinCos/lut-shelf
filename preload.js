const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* File */
  selectDir: () => ipcRenderer.invoke('select-dir'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  saveLutDir: (dirPath) => ipcRenderer.invoke('save-lut-dir', dirPath),

  /* Scan */
  scanTree: (dirPath) => ipcRenderer.invoke('scan-tree', dirPath),
  quickCheck: (dirPath) => ipcRenderer.invoke('quick-check', dirPath),
  reScan: (dirPath) => ipcRenderer.invoke('db-re-scan', dirPath),

  /* RAW */
  extractRawPreview: (filePath) => ipcRenderer.invoke('extract-raw-preview', filePath),

  /* Thumbnail */
  thumbGetSource: () => ipcRenderer.invoke('thumb-get-source'),
  thumbSetSource: (filePath) => ipcRenderer.invoke('thumb-set-source', filePath),
  thumbCacheGet: (key) => ipcRenderer.invoke('thumb-cache-get', key),
  thumbCachePut: (key, dataBase64) => ipcRenderer.invoke('thumb-cache-put', { key, dataBase64 }),

  /* Database */
  dbGetLut: (filePath) => ipcRenderer.invoke('db-get-lut', filePath),
  dbUpdateNotes: (path, notes) => ipcRenderer.invoke('db-update-notes', { path, notes }),
  dbUpdateAuthor: (path, author) => ipcRenderer.invoke('db-update-author', { path, author }),
  dbUpdateDescription: (path, description) => ipcRenderer.invoke('db-update-description', { path, description }),
  dbSearch: (query) => ipcRenderer.invoke('db-search', query),
  dbGetFolderFiles: (folderPath) => ipcRenderer.invoke('db-get-folder-files', folderPath),
  toggleFavorite: (filePath) => ipcRenderer.invoke('db-toggle-favorite', filePath),
  getFavorites: () => ipcRenderer.invoke('db-get-favorites'),
  dbGetStats: () => ipcRenderer.invoke('db-get-stats'),

  /* Events */
  onAutoLoadLuts: (callback) => ipcRenderer.on('auto-load-luts', (_event, dir) => callback(dir)),
  onMenuLutDirSelected: (callback) => ipcRenderer.on('menu-lut-dir-selected', (_event, dir) => callback(dir)),
  onMenuRescan: (callback) => ipcRenderer.on('menu-rescan', () => callback()),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_event, data) => callback(data)),
  parseLutSize: (filePath) => ipcRenderer.invoke('parse-lut-size', filePath),
});
