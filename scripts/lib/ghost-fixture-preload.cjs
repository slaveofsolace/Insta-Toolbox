const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixtureGhostTransport', {
  get: (key, fallback) => ipcRenderer.sendSync('fixture-ghost:get', key, fallback),
  set: (key, value) => ipcRenderer.sendSync('fixture-ghost:set', key, value),
  open: (url, options) => ipcRenderer.invoke('fixture-ghost:open', url, options),
  close: id => ipcRenderer.invoke('fixture-ghost:close', id),
  listen(callback) {
    const listener = (_event, key, previous, next) => callback(key, previous, next);
    ipcRenderer.on('fixture-ghost:changed', listener);
  },
});
