// Yakalama akışının orkestrasyonu.
//
//   Ins'e bas ──► overlay ANINDA açılır (karartma, 0ms)
//        │
//        └─► paralelde native'den kareler istenir ──► gelince donmuş kare geçer
//
//   basılı tut > eşik ──► seçim otomatik "tüm ekran" olur
//   seçim + Ctrl+C     ──► kırp, panoya kopyala
//   seçim + Ctrl+S     ──► kırp, diske kaydet
const { ipcMain, clipboard, nativeImage, shell, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');

const state = require('./state');
const settings = require('./settings');
const native = require('./native');
const overlay = require('./overlay');

let sonKareler = null;

/** Seçim hangi ekranda yapıldı — global kısayol o pencereye gitsin diye. */
let secimliDisplayId = null;

/**
 * Metin modu hangi ekranda açık (yoksa null).
 * Gerekli çünkü Ctrl+C globalShortcut ile yakalanıyor ve tuş renderer'a hiç
 * ulaşmıyor — ana süreç metin modunda olduğumuzu bilmezse görseli kopyalıyor.
 */
let metinModuDisplayId = null;

function init() {
  state.events.on('kisayol-basildi', ac);
  state.events.on('esik-asildi', () => {
    if (state.overlayAcik) state.sendOverlays('overlay:tum-ekran');
  });

  ipcMain.on('overlay:iptal', () => kapat());
  ipcMain.on('overlay:tus', (e, eylem) => eylemYolla(eylem));

  // Sadece METİN kopyala (OCR modülünden gelir) — görsel değil.
  ipcMain.handle('overlay:metin-kopyala', (e, metin) => {
    const m = String(metin || '').trim();
    if (!m) return { ok: false, error: 'metin boş' };
    clipboard.writeText(m);
    console.log(`[yakala] metin panoya kopyalandı (${m.length} karakter)`);
    kapat();
    return { ok: true, uzunluk: m.length };
  });
  ipcMain.on('overlay:secim-durum', (e, bilgi) => {
    secimliDisplayId = bilgi && bilgi.var ? bilgi.displayId : null;
  });

  ipcMain.on('overlay:metin-modu', (e, b) => {
    metinModuDisplayId = b && b.acik ? b.displayId : null;
  });

  // Nişangâh sahipliği — aynı anda tek ekranda dursun.
  ipcMain.on('overlay:nisan-bende', (e, displayId) => {
    for (const w of state.overlayWindows) {
      if (w.isDestroyed() || w.displayId === displayId) continue;
      w.webContents.send('overlay:eylem', 'nisan-gizle');
    }
  });
  ipcMain.handle('overlay:kopyala', (e, secim) => tamamla(secim, 'kopyala'));
  ipcMain.handle('overlay:kaydet', (e, secim) => tamamla(secim, 'kaydet'));
}

// --- global kısayollar ---
// Overlay penceresi odağı alamazsa (Windows foreground lock) renderer'daki
// keydown hiç tetiklenmiyordu ve Esc ölüyordu. Bunlar odaktan bağımsız çalışır.
const KISAYOLLAR = [
  ['Escape', 'iptal'],
  ['CommandOrControl+C', 'kopyala'],
  ['CommandOrControl+S', 'kaydet'],
  ['CommandOrControl+A', 'tum-ekran'],
];

function kisayollariBagla() {
  for (const [tus, eylem] of KISAYOLLAR) {
    try {
      const ok = globalShortcut.register(tus, () => eylemYolla(eylem));
      if (!ok) console.warn(`[yakala] '${tus}' bağlanamadı (başka uygulama tutuyor olabilir) ` +
                            `— overlay odaktaysa yine de çalışır`);
    } catch (e) {
      console.warn(`[yakala] '${tus}' bağlanamadı:`, e.message);
    }
  }
}

function kisayollariCoz() {
  for (const [tus] of KISAYOLLAR) {
    try { globalShortcut.unregister(tus); } catch {}
  }
}

// Aynı tuş hem globalShortcut'tan hem renderer'dan gelebilir; ikisi de iş
// yaparsa Esc önce seçimi temizleyip sonra overlay'i kapatıyor. 150ms içinde
// gelen aynı eylemi yok say.
let sonEylem = null;
let sonEylemT = 0;

function eylemYolla(eylem) {
  if (!state.overlayAcik) return;

  const simdi = Date.now();
  if (eylem === sonEylem && simdi - sonEylemT < 150) return;
  sonEylem = eylem;
  sonEylemT = simdi;

  if (eylem === 'iptal') {
    // Seçim varsa önce onu temizle; seçim yoksa overlay'den çık.
    if (secimliDisplayId !== null) {
      const hedef = state.overlayWindows.find((w) => w.displayId === secimliDisplayId);
      if (hedef && !hedef.isDestroyed()) { hedef.webContents.send('overlay:eylem', 'temizle'); return; }
    }
    kapat();
    return;
  }

  // METİN MODU: Ctrl+C görseli değil metni kopyalar, Ctrl+A tüm kelimeleri seçer.
  if (metinModuDisplayId !== null) {
    const mw = state.overlayWindows.find((w) => w.displayId === metinModuDisplayId);
    if (mw && !mw.isDestroyed()) {
      if (eylem === 'kopyala') { mw.webContents.send('overlay:eylem', 'metin-kopyala'); return; }
      if (eylem === 'tum-ekran') { mw.webContents.send('overlay:eylem', 'metin-tumunu-sec'); return; }
    }
  }

  if (eylem === 'tum-ekran') { state.sendOverlays('overlay:tum-ekran'); return; }

  // Kopyala/kaydet: seçim hangi penceredeyse ona söyle.
  const hedef = state.overlayWindows.find((w) => w.displayId === secimliDisplayId);
  if (hedef && !hedef.isDestroyed()) hedef.webContents.send('overlay:eylem', eylem);
}

async function ac() {
  if (state.overlayAcik) {
    console.warn('[yakala] ac() çağrıldı ama overlay ZATEN AÇIK sayılıyor — ' +
                 'görünmüyorsa bayrak takılı kalmış demektir');
    return;
  }

  const t0 = Date.now();
  secimliDisplayId = null;
  metinModuDisplayId = null;

  state.oyunAcik = false;
  state.oyunAdi = '';

  // ⏱ Oyun içi takılma araştırması (kullanımda çıktı: SS alırken, çeviri sırasında
  // ve KAPARKEN ufak donmalar). Nerede zaman gittiğini tahminle değil ölçümle
  // bulalım — bu proje bir kez dolaylı sayılarla yanılmıştı.
  const tGoster = Date.now();
  overlay.goster();                      // 0ms — kullanıcı anında görüyor
  const gosterMs = Date.now() - tGoster;
  kisayollariBagla();
  console.log(`[yakala] overlay açıldı (+${Date.now() - t0}ms · goster ${gosterMs}ms)`);

  // Oyun açık mı? Odak kararı buna bağlı. Overlay'i GECİKTİRMEMELİ,
  // o yüzden gösterdikten hemen SONRA soruluyor.
  // Oyun açıksa odak hiç verilmez (alt-tab efekti oluyor, tam ekran oyunda ölçüldü).
  const onPlanSozu = native.cagir('foreground', {}, 1500)
    .then((f) => {
      state.oyunAcik = !!(f && f.tamEkranUygulamaVar);
      state.oyunAdi = (f && f.onPlanUygulama) || '';
    })
    .catch(() => {});

  if (!native.calisiyorMu()) {
    console.error('[yakala] native süreci yok — donmuş kare gelmeyecek, karartma modunda kalınıyor');
    return;
  }

  try {
    const tYakala = Date.now();
    const veri = await native.cagir('capture-all', {}, 10000);
    const yakalaMs = Date.now() - tYakala;
    sonKareler = veri.frames;
    if (!state.overlayAcik) return;      // kullanıcı bu arada Esc'e basmış olabilir
    const tYerlestir = Date.now();
    overlay.kareleriYerlestir(veri.frames);
    console.log(`[yakala] kareler yerleşti (+${Date.now() - t0}ms · ` +
      `WGC ${yakalaMs}ms/${veri.frames.length} ekran · yerlestir ${Date.now() - tYerlestir}ms)`);
  } catch (e) {
    console.error('[yakala] kare alınamadı:', e.message);
  }

  // 🔴 ODAK EN SONA ALINDI.
  //
  // Eskiden kare çekilmeden ÖNCE odak alınıyordu. Odağı kaybeden uygulama
  // buna tepki verirse (gizlenmek, arkaya düşmek, içeriği saklamak) biz o
  // tepkiden SONRASINI yakalıyorduk. Bir sohbet uygulamasında ölçüldü: "ss almaya
  // bastığım an kendini alta atıyor".
  //
  // Odak zaten zorunlu değil: klavye globalShortcut'tan geliyor, fare
  // odaksız çalışıyor (bkz overlay.odakVer yorumu). Sadece metin aracıyla
  // yazı yazarken gerekiyor, o da bu noktadan sonra.
  await onPlanSozu;
  if (!state.overlayAcik) return;
  const verildi = overlay.odakVer();
  console.log(state.oyunAcik
    ? `[yakala] tam ekran uygulama açık (${state.oyunAdi}) — odak çalınmadı`
    : `[yakala] odak ${verildi ? 'verildi' : 'verilemedi'} (+${Date.now() - t0}ms, kare sonrası)`);
}

function kapat() {
  const t0 = Date.now();
  kisayollariCoz();
  secimliDisplayId = null;
  metinModuDisplayId = null;
  overlay.gizle();
  // Kapanış da ölçülüyor: kapanışta da takılma ölçüldü. Tam ekran özel
  // moddaki bir oyunun üstünden pencere kalkarken Windows mod geçişi yapıyor;
  // buradaki süre KISA çıkarsa suç bizde değil, o geçişte demektir.
  console.log(`[yakala] overlay kapandı (${Date.now() - t0}ms)`);
}

/**
 * Seçimi panoya kopyalar ya da diske kaydeder.
 *
 * Normal yol: renderer kare + çizimleri birleştirip hazır PNG yollar (`veri.png`).
 * Yedek yol: PNG yoksa (duman testi) kareden dikdörtgen kırpılır.
 *
 * @param {{png?:Uint8Array, displayId?:number, x?:number, y?:number, w?:number,
 *          h?:number, dipGenislik?:number, dipYukseklik?:number}} veri
 */
async function tamamla(veri, islem) {
  try {
    const gorsel = veri && veri.png ? pngdenGorsel(veri.png) : karedenKirp(veri);
    const boyut = gorsel.getSize();
    if (!boyut.width || !boyut.height) throw new Error('görsel boş');

    kapat();

    if (islem === 'kopyala') {
      clipboard.writeImage(gorsel);
      console.log(`[yakala] panoya kopyalandı ${boyut.width}x${boyut.height}`);
      return { ok: true, islem, ...boyut };
    }

    const s = settings.get();
    fs.mkdirSync(s.kayitKlasoru, { recursive: true });
    const hedef = path.join(s.kayitKlasoru, `deightshot-${damga()}.png`);
    fs.writeFileSync(hedef, gorsel.toPNG());
    console.log(`[yakala] kaydedildi: ${hedef} (${boyut.width}x${boyut.height})`);
    shell.showItemInFolder(hedef);
    return { ok: true, islem, path: hedef, ...boyut };
  } catch (e) {
    console.error('[yakala] tamamlanamadı:', e.message);
    kapat();
    return { ok: false, error: e.message };
  }
}

function pngdenGorsel(png) {
  const buf = Buffer.isBuffer(png) ? png : Buffer.from(png);
  const g = nativeImage.createFromBuffer(buf);
  if (g.isEmpty()) throw new Error('renderer’dan gelen PNG çözülemedi');
  return g;
}

/** Yedek yol — çizimler olmadan, doğrudan kareden kırpar. */
function karedenKirp(secim) {
  const kare = kareBul(secim.displayId);
  if (!kare) throw new Error('seçimin ekranı için kare bulunamadı');

  // DIP -> FİZİKSEL. Ölçek farkı olan monitörlerde bu çevrim şart.
  const olcekX = kare.width / secim.dipGenislik;
  const olcekY = kare.height / secim.dipYukseklik;

  const rect = {
    x: Math.max(0, Math.round(secim.x * olcekX)),
    y: Math.max(0, Math.round(secim.y * olcekY)),
    width: Math.round(secim.w * olcekX),
    height: Math.round(secim.h * olcekY),
  };
  rect.width = Math.min(rect.width, kare.width - rect.x);
  rect.height = Math.min(rect.height, kare.height - rect.y);
  if (rect.width < 1 || rect.height < 1) throw new Error('seçim çok küçük');

  const tam = nativeImage.createFromPath(kare.path);
  if (tam.isEmpty()) throw new Error('kare okunamadı: ' + kare.path);
  return tam.crop(rect);
}

function kareBul(displayId) {
  if (!sonKareler) return null;
  const win = state.overlayWindows.find((w) => w.displayId === displayId);
  if (!win) return null;
  const p = win.fiziksel;
  let enIyi = null, enIyiFark = Infinity;
  for (const f of sonKareler) {
    const fark = Math.abs(f.x - p.x) + Math.abs(f.y - p.y)
               + Math.abs(f.width - p.width) + Math.abs(f.height - p.height);
    if (fark < enIyiFark) { enIyiFark = fark; enIyi = f; }
  }
  return enIyi;
}

function damga() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// `tamamla` duman testinden de çağrılabilsin diye dışa veriliyor.
// `kareBul` modüllere (OCR) o ekranın güncel karesini vermek için lazım.
module.exports = {
  init, ac, kapat, tamamla, kareBul,
  // Duman testi globalShortcut'ı taklit edebilsin diye (sentetik tuş üretmeden).
  testEylem: eylemYolla,
};
