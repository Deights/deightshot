// Overlay preload — renderer'a yalnızca ihtiyacı olan dar API'yi verir.
// nodeIntegration kapalı, contextIsolation açık.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shot88', {
  /** ana süreçten gelen olaylar */
  on(kanal, fn) {
    // 'overlay:eylem' içinde kopyala/kaydet/temizle/nisan-gizle geliyor
    const izinli = ['overlay:sifirla', 'overlay:kare', 'overlay:tum-ekran', 'overlay:eylem',
                    'overlay:temizle'];
    if (!izinli.includes(kanal)) return;
    ipcRenderer.on(kanal, (_e, veri) => fn(veri));
  },

  iptal: () => ipcRenderer.send('overlay:iptal'),

  /** Tuş kararları tek elden ana süreçte veriliyor (globalShortcut ile çiftlenmesin). */
  tus: (eylem) => ipcRenderer.send('overlay:tus', eylem),

  /** Seçim var mı — global kısayolun hangi pencereye gideceğini ana süreç bilsin. */
  secimDurum: (displayId, varMi) =>
    ipcRenderer.send('overlay:secim-durum', { displayId, var: varMi }),

  /** Nişangâh bu ekranda — diğer ekranlardaki sönsün. */
  nisanBende: (displayId) => ipcRenderer.send('overlay:nisan-bende', displayId),

  /** Metin modundayız — Ctrl+C görseli değil METNİ kopyalasın. */
  metinModuDurum: (displayId, acik) =>
    ipcRenderer.send('overlay:metin-modu', { displayId, acik }),

  kopyala: (secim) => ipcRenderer.invoke('overlay:kopyala', secim),
  kaydet: (secim) => ipcRenderer.invoke('overlay:kaydet', secim),

  /** Sadece metni panoya yaz (OCR sonucu) — görsel değil. */
  metniKopyala: (metin) => ipcRenderer.invoke('overlay:metin-kopyala', metin),

  /** Eklenti çağrısı: modul('metin-secme', 'al', {...}) */
  modul: (mid, komut, veri) => ipcRenderer.invoke('modul:cagir', { mid, komut, veri }),

  /** Eklentiden gelen olaylar */
  modulOlay(fn) {
    ipcRenderer.on('modul:olay', (_e, veri) => fn(veri));
  },
});
