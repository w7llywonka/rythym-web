// The only way the game page talks to the app: a small, fixed set of calls (window.lineRushDesktop).
// The page never gets Node, the file system or the login cookie.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lineRushDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  setPref: (key, value) => ipcRenderer.invoke('desktop:set-pref', key, value),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
  screenshot: () => ipcRenderer.invoke('desktop:screenshot'),
  openFolder: which => ipcRenderer.invoke('desktop:open-folder', which),
  listSongs: () => ipcRenderer.invoke('desktop:list-songs'),
  readSong: name => ipcRenderer.invoke('desktop:read-song', name),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  readyToClose: () => ipcRenderer.invoke('desktop:ready-to-close'),
  activity: a => ipcRenderer.send('desktop:activity', a),
  onEvent: fn => {
    const listener = (_e, event) => fn(event);
    ipcRenderer.on('desktop:event', listener);
    return () => ipcRenderer.removeListener('desktop:event', listener);
  },
});
