const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('closureCompanion', {
  onCursor: (callback) => ipcRenderer.on('closure:cursor', (_event, point) => callback(point)),
  setInteractive: (target, controls) => ipcRenderer.send('closure:interactive', target === true, controls === true),
  getRuntimeSettings: () => ipcRenderer.invoke('closure:runtime-settings'),
  setRuntimeSetting: (key, enabled) => ipcRenderer.invoke('closure:set-runtime-setting', key, enabled),
  themeAction: (action) => ipcRenderer.invoke('closure:theme-action', action),
  quit: () => ipcRenderer.send('closure:quit'),
})
