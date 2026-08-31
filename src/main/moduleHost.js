// Modül sistemi — modules/<klasör>/module.json + main.js yapısındaki eklentileri yükler.
// Desen bilinçli olarak basit tutuldu: modules/<klasör>/module.json + main.js,
// ikinci bir mimari icat edilmedi.
//
// Çekirdek (yakalama/overlay/çizim) burada DEĞİL. Eklenti olacaklar:
// OCR metin seçme, sözlük, çeviri, açıkla.
//
// Modül ↔ renderer köprüsü:
//   renderer  →  window.shot88.modul(mid, komut, veri)  →  ctx.komut(ad, fn)
//   modül     →  ctx.overlaya(displayId, tip, veri)     →  'modul:olay'
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, '..', '..', 'modules');

const yuklu = [];                 // {manifest, instance}
const komutlar = new Map();       // "mid:ad" -> fn

function ctxKur(manifest, cekirdek) {
  const mid = manifest.id;
  return {
    manifest,

    // Native yardımcı sürecine erişim (OCR burada)
    native: {
      cagir: (cmd, args, zamanAsimi) => cekirdek.native.cagir(cmd, args, zamanAsimi),
      calisiyorMu: () => cekirdek.native.calisiyorMu(),
    },

    // Çekirdek olayları: 'kisayol-basildi', 'esik-asildi', 'kisayol-birakildi'
    on: (olay, fn) => cekirdek.state.events.on(olay, fn),

    /** Renderer'dan çağrılabilir komut tanımla. Dönen değer renderer'a gider. */
    komut(ad, fn) { komutlar.set(mid + ':' + ad, fn); },

    /** Belirli bir ekranın overlay'ine olay yolla. */
    overlaya(displayId, tip, veri) {
      const w = cekirdek.state.overlayWindows.find((x) => x.displayId === displayId);
      if (w && !w.isDestroyed()) w.webContents.send('modul:olay', { mid, tip, veri });
    },

    /** O ekranın güncel donmuş karesi: {path, width, height, x, y} */
    kare: (displayId) => cekirdek.kareBul(displayId),

    /**
     * Overlay AÇILIRKEN tam ekran bir uygulama (oyun) ön planda mıydı.
     *
     * 🔴 Bunu modül kendi ölçemez: overlay ekranı kapladıktan sonra "ön plandaki
     * uygulama" artık shot88'in kendisi. Ölçüm yakalama anında yapılıyor
     * (capture.js), burada sadece okunuyor.
     */
    oyunDurumu: () => ({
      acik: !!cekirdek.state.oyunAcik,
      ad: cekirdek.state.oyunAdi || '',
    }),

    ayarlar: {
      get: () => cekirdek.settings.get(),
      set: (patch) => cekirdek.settings.set(patch),
    },

    log: (...a) => console.log(`[${mid}]`, ...a),
  };
}

function load(cekirdek) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }

  for (const d of dirs) {
    const dir = path.join(MODULES_DIR, d.name);
    const manifestYolu = path.join(dir, 'module.json');
    if (!fs.existsSync(manifestYolu)) continue;   // README gibi klasörler atlanır

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestYolu, 'utf8'));
      if (manifest.enabled === false) {
        yuklu.push({ manifest, instance: null });
        continue;
      }
      const instance = require(path.join(dir, manifest.main || 'main.js'));
      if (typeof instance.init === 'function') instance.init(ctxKur(manifest, cekirdek));
      yuklu.push({ manifest, instance });
      console.log('[modüller] yüklendi:', manifest.id);
    } catch (e) {
      console.error('[modüller] yüklenemedi:', d.name, e.message);
      yuklu.push({ manifest: { id: d.name, error: e.message }, instance: null });
    }
  }

  // Renderer -> modül komutu
  ipcMain.handle('modul:cagir', async (e, { mid, komut, veri }) => {
    const fn = komutlar.get(mid + ':' + komut);
    if (!fn) return { ok: false, error: `bilinmeyen modül komutu: ${mid}:${komut}` };
    try {
      const data = await fn(veri || {});
      return { ok: true, data };
    } catch (err) {
      console.error(`[${mid}] ${komut} hatası:`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

const listele = () => yuklu.map((m) => ({ ...m.manifest, aktif: m.instance !== null }));
const varMi = (id) => yuklu.some((m) => m.manifest.id === id && m.instance);

module.exports = { load, listele, varMi };
