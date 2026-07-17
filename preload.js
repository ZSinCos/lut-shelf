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
});
