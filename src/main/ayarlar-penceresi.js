// Çeviri ayarları penceresi.
//
// Neden ayrı pencere: API anahtarı yapıştırmak form işi, tepsi menüsüne
// sığmıyor. `ayarlar.json`'a elle yazdırmak da "en basitini ve
// çirkinini yapma" kuralına giriyor. Ayrıca uzak motor anahtarı
// gizlilik kararı — hak ettiği yerde, açıklamasıyla birlikte duruyor.

const { BrowserWindow, ipcMain, nativeImage } = require('electron');
const settings = require('./settings');
const hotkeys = require('./hotkeys');
const tuslar = require('./tuslar');
const path = require('path');

let pencere = null;

function ac() {
  // Zaten açıksa öne getir — ikinci pencere açma.
  if (pencere && !pencere.isDestroyed()) {
    if (pencere.isMinimized()) pencere.restore();
    pencere.focus();
    return pencere;
  }

  pencere = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 520,
    minHeight: 520,
    show: false,
    title: 'DeightShot — Ayarlar',
    backgroundColor: '#141417',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(
      path.join(__dirname, '..', '..', 'assets', 'tray-32.png')),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', 'preload', 'ayarlar-preload.js'),
    },
  });

  pencere.loadFile(path.join(__dirname, '..', 'ui', 'ayarlar', 'ayarlar.html'));
  pencere.once('ready-to-show', () => pencere.show());
  pencere.on('closed', () => {
    pencere = null;
    // Tepsi menüsündeki "⚠ uzak motor AÇIK" etiketi tazelensin.
    // Lazy require: tray bu dosyayı zaten çağırıyor, tepede istesek döngü olur.
    try { require('./tray').menuKur(); } catch { /* tray henüz yoksa boş geç */ }
  });

  return pencere;
}

function kapat() {
  if (pencere && !pencere.isDestroyed()) pencere.close();
}

function init() {
  ipcMain.on('ayarlar:kapat', () => kapat());

  /** Kısayol durumu + atanabilir tuşlar. */
  ipcMain.handle('kisayol:durum', () => {
    const s = settings.get();
    return {
      keycode: s.kisayolKeycode,
      ad: s.kisayolAd,
      basiliTutmaMs: s.basiliTutmaMs,
      tusuYut: s.tusuYut !== false,
      motor: hotkeys.aktifMotor(),
      tuslar: tuslar.TUSLAR.map((t) => ({ code: t.code, ad: t.ad })),
      cakisma: tuslar.CAKISMA,
    };
  });

  /**
   * Kısayolu değiştir ve hook'u YENİDEN KUR.
   * Ayarı yazıp motoru yeniden başlatmazsak yeni tuş bir sonraki açılışa
   * kadar çalışmaz — kullanıcı "bozuk" sanar.
   */
  ipcMain.handle('kisayol:kur', async (_e, veri) => {
    const y = {};
    if (veri.code) {
      const t = tuslar.domKoduBul(veri.code);
      if (!t) throw new Error(`bu tuş atanamıyor: ${veri.code}`);
      y.kisayolKeycode = t.uiohook;
      y.kisayolAd = t.ad;
    }
    if (typeof veri.basiliTutmaMs === 'number') y.basiliTutmaMs = veri.basiliTutmaMs;
    if (typeof veri.tusuYut === 'boolean') y.tusuYut = veri.tusuYut;
    settings.set(y);

    await hotkeys.durdur();
    const ok = await hotkeys.init();

    // Tepsi menüsünde tuş adı yazıyor, tazelensin.
    try { require('./tray').menuKur(); } catch { /* tray yoksa boş geç */ }

    const s = settings.get();
    return { tamam: ok, ad: s.kisayolAd, motor: hotkeys.aktifMotor() };
  });
}

module.exports = { init, ac, kapat };
