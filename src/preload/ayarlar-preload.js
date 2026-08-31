// Ayarlar penceresi preload — dar API. nodeIntegration kapalı, contextIsolation açık.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deightshot', {
  /** Eklenti çağrısı — overlay ile aynı kanal, aynı doğrulama. */
  modul: (mid, komut, veri) => ipcRenderer.invoke('modul:cagir', { mid, komut, veri }),
  kapat: () => ipcRenderer.send('ayarlar:kapat'),

  /** Kısayol tuşu atama */
  kisayolDurum: () => ipcRenderer.invoke('kisayol:durum'),
  kisayolKur: (veri) => ipcRenderer.invoke('kisayol:kur', veri),
});
