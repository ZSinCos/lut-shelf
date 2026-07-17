const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectLutDir: () => ipcRenderer.invoke('select-lut-dir'),
  saveLutDir: (dirPath) => ipcRenderer.invoke('save-lut-dir', dirPath),
  scanLutDir: (dirPath) => ipcRenderer.invoke('scan-lut-dir', dirPath),
  readLutFile: (filePath) => ipcRenderer.invoke('read-lut-file', filePath),
  extractRawPreview: (filePath) => ipcRenderer.invoke('extract-raw-preview', filePath),
  onAutoLoadLuts: (callback) => {
    ipcRenderer.on('auto-load-luts', (event, dirPath) => callback(dirPath));
  },
  onMenuSelectLutDir: (callback) => {
    ipcRenderer.on('menu-lut-dir-selected', (event, dirPath) => callback(dirPath));
  },
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  /* Repo API (folder-based) */
  repoSelectDir: () => ipcRenderer.invoke('repo-select-dir'),
  repoGetDir: () => ipcRenderer.invoke('repo-get-dir'),
  repoScan: (relativePath) => ipcRenderer.invoke('repo-scan', relativePath),
  repoReadFile: (relativePath) => ipcRenderer.invoke('repo-read-file', relativePath),
  repoImportFiles: () => ipcRenderer.invoke('repo-import-files'),
  repoCreateFolder: (folderName) => ipcRenderer.invoke('repo-create-folder', folderName),
  repoDelete: (relativePath) => ipcRenderer.invoke('repo-delete', relativePath),
  repoRename: (oldPath, newName) => ipcRenderer.invoke('repo-rename', { oldPath, newName }),
  repoMoveFile: (fileRelPath, targetFolderRel) => ipcRenderer.invoke('repo-move-file', { fileRelPath, targetFolderRel }),
  repoLoadMeta: () => ipcRenderer.invoke('repo-load-meta'),
  repoSaveMeta: (meta) => ipcRenderer.invoke('repo-save-meta', meta),
  repoLoadOrder: () => ipcRenderer.invoke('repo-load-order'),
  repoSaveOrder: (order) => ipcRenderer.invoke('repo-save-order', order),
  /* Thumbnail API */
  thumbSetSource: (filePath) => ipcRenderer.invoke('thumb-set-source', filePath),
  thumbGetSource: () => ipcRenderer.invoke('thumb-get-source'),
  thumbCacheGet: (key) => ipcRenderer.invoke('thumb-cache-get', key),
  thumbCachePut: (key, dataBase64) => ipcRenderer.invoke('thumb-cache-put', { key, dataBase64 }),
});
