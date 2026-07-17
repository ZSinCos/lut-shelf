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
  /* Repo API */
  repoList: () => ipcRenderer.invoke('repo-list'),
  repoImportDialog: () => ipcRenderer.invoke('repo-import-dialog'),
  repoGroups: () => ipcRenderer.invoke('repo-groups'),
  repoImportFile: (filePath) => ipcRenderer.invoke('repo-import-file', filePath),
  repoReadFile: (id) => ipcRenderer.invoke('repo-read-file', id),
  repoUpdateLut: (lutData) => ipcRenderer.invoke('repo-update-lut', lutData),
  repoDeleteLut: (id) => ipcRenderer.invoke('repo-delete-lut', id),
  repoSaveGroup: (group) => ipcRenderer.invoke('repo-save-group', group),
  repoDeleteGroup: (groupId) => ipcRenderer.invoke('repo-delete-group', groupId),
});
