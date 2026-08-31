// Paylaşılan uygulama durumu — çekirdek modüller buradan haberleşir, döngüsel require olmaz.
const { EventEmitter } = require('events');

const state = {
  /** @type {import('electron').BrowserWindow[]} her ekran için bir overlay penceresi */
  overlayWindows: [],

  /** overlay şu an açık mı */
  overlayAcik: false,

  /** o anki yakalama oturumu: { frames: [...], baslangic: number } */
  oturum: null,

  /** tray ikonu (GC yememesi için referans tutulur) */
  tray: null,

  /**
   * Overlay açılırken tam ekran bir uygulama (oyun) ön plandaydı.
   * Odak çalmamak ve ağır modeli çalıştırmamak için kullanılıyor.
   */
  oyunAcik: false,
  oyunAdi: '',

  /**
   * Kurulu Windows OCR dilleri. Açılışta bir kez okunuyor.
   * Tepsi menüsü senkron kurulduğu için burada önbelleklenmesi şart —
   * eskiden tr/en-US elle yazılmıştı, yeni dil paketi kurulunca görünmüyordu.
   */
  ocrDilleri: [],

  events: new EventEmitter(),

  /** tüm overlay pencerelerine mesaj yolla */
  sendOverlays(channel, ...args) {
    for (const w of state.overlayWindows) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
    }
  },
};

state.events.setMaxListeners(50);
module.exports = state;
