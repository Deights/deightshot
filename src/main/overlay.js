// Overlay pencereleri — her ekran için bir tane, ÖNCEDEN OLUŞTURULUR ve gizli bekler.
//
// Hız numarası (tasarım notundaki en önemli karar):
//   1. Pencere zaten var, sadece gizli  -> göstermek anlık
//   2. Ins'e basınca ŞEFFAF + karartma katmanı görünür. Altında gerçek canlı ekran
//      duruyor, kullanıcı karartılmış halini görüyor. 0ms gecikme.
//   3. Arka planda gerçek yakalama yapılır, hazır olunca donmuş kare sessizce geçer.
//
// Çok ekran: tek dev pencere DEĞİL, her ekran için ayrı pencere (DPI kayması olmasın).
const { BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const state = require('./state');
const settings = require('./settings');

const UI = path.join(__dirname, '..', 'ui', 'overlay', 'overlay.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'overlay-preload.js');

/** Electron ekranı -> fiziksel piksel dikdörtgeni (native frame'leriyle eşleştirmek için) */
function fizikselRect(display) {
  // dipToScreenRect DIP -> fiziksel çevirir; çok DPI'lı kurulumda elle çarpmaktan güvenli.
  try {
    return screen.dipToScreenRect(null, display.bounds);
  } catch {
    const sf = display.scaleFactor || 1;
    const b = display.bounds;
    return { x: Math.round(b.x * sf), y: Math.round(b.y * sf), width: Math.round(b.width * sf), height: Math.round(b.height * sf) };
  }
}

function pencereOlustur(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    title: 'shot88 overlay',
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' seviyesi oyun/tam ekran uygulamaların da üstünde durur.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(UI);

  win.displayId = display.id;
  win.dipBounds = { ...b };
  win.fiziksel = fizikselRect(display);

  // Kazara kapanmasın; gizlemek yeterli.
  win.on('close', (e) => {
    if (!state.kapaniyor) { e.preventDefault(); win.hide(); }
  });

  // Renderer hatalarını ana log'a taşı — yoksa overlay'de sessizce ölüyorlar.
  win.webContents.on('console-message', (e, seviye, mesaj, satir, kaynak) => {
    if (seviye >= 2) {
      const yer = kaynak ? `${kaynak.split(/[\\/]/).pop()}:${satir}` : '?';
      console.error(`[overlay:renderer] ${mesaj}  (${yer})`);
    }
  });

  return win;
}

function olustur() {
  yokEt();
  const displays = screen.getAllDisplays();
  state.overlayWindows = displays.map(pencereOlustur);
  console.log(`[overlay] ${state.overlayWindows.length} ekran için pencere hazırlandı (gizli)`);
  yakalamadanHaricTut();
}

/**
 * Overlay pencerelerini ekran yakalamadan hariç tut.
 *
 * Zorunlu: shot88 önce overlay'i gösterip SONRA yakalıyor (0ms açılış hissi).
 * Bu olmadan WGC kendi karartmamızı ve nişangâhımızı da yakalıyor, donmuş
 * karenin içine gömülü kalıyorlar — kullanımda "silik ikinci nişangâh" olarak
 * fark edildi, ekran iki kez kararınca da "hiç açılmadı" gibi görünüyordu.
 *
 * ⚠️ Bunu C# yardımcı sürecinden yapmak İMKÂNSIZ: SetWindowDisplayAffinity
 * başka sürecin penceresine uygulanamıyor (Win32 hata 5, erişim reddedildi).
 * Pencerenin sahibi süreçten çağrılmalı — yani buradan.
 * Electron'un setContentProtection'ı tam olarak bunu yapıyor
 * (Win10 2004+ üzerinde WDA_EXCLUDEFROMCAPTURE).
 */
function yakalamadanHaricTut() {
  // Hata ayıklama kapısı: overlay yakalamaya görünmez olduğu için kendi
  // ekran görüntüsünü alamıyoruz. SHOT88_NOPROTECT=1 ile geçici olarak kapatılır.
  if (process.env.SHOT88_NOPROTECT) {
    console.warn('[overlay] SHOT88_NOPROTECT=1 — yakalama koruması KAPALI (sadece hata ayıklama)');
    return;
  }

  let ok = 0;
  for (const w of state.overlayWindows) {
    if (w.isDestroyed()) continue;
    try { w.setContentProtection(true); ok++; }
    catch (e) { console.error(`[overlay] ekran ${w.displayId} hariç tutulamadı:`, e.message); }
  }
  console.log(`[overlay] yakalamadan hariç tutuldu: ${ok}/${state.overlayWindows.length}`);
}

function yokEt() {
  for (const w of state.overlayWindows) {
    try { if (!w.isDestroyed()) { w.removeAllListeners('close'); w.destroy(); } } catch {}
  }
  state.overlayWindows = [];
}

/** Aşama 1 — anında göster: sadece karartma, altında canlı ekran. */
function goster() {
  if (state.overlayAcik) return;
  state.overlayAcik = true;

  const s = settings.get();

  // İmlecin nerede olduğunu ÖNCEDEN bildir. Yoksa nişangâh ilk fare hareketine
  // kadar bir önceki oturumdan kalma yerde durup zıplıyor (kullanımda yakalandı).
  const nokta = screen.getCursorScreenPoint();
  const aktifDisplay = screen.getDisplayNearestPoint(nokta);

  for (const w of state.overlayWindows) {
    if (w.isDestroyed()) continue;

    // İmleç bu ekranda değilse nişangâh hiç gösterilmesin — ikinci monitörde
    // alakasız bir yerde artı işareti duruyordu.
    const imlec = w.displayId === aktifDisplay.id
      ? { x: nokta.x - w.dipBounds.x, y: nokta.y - w.dipBounds.y }
      : null;

    w.webContents.send('overlay:sifirla', {
      karartma: s.karartma,
      displayId: w.displayId,
      dipGenislik: w.dipBounds.width,
      dipYukseklik: w.dipBounds.height,
      imlec,
    });
    w.setBounds(w.dipBounds);
    w.showInactive();       // önce odak çalmadan göster
    w.setAlwaysOnTop(true, 'screen-saver');
  }

  // Odak BURADA verilmiyor — kararı capture.odakVer() veriyor, çünkü önce
  // "oyun açık mı" bilinmeli ve o kontrol overlay'i geciktirmemeli.
  state.odakAdayi = aktifDisplay.id;

  console.log(`[overlay] imleç ekran ${aktifDisplay.id} @ ${nokta.x},${nokta.y}`);
  for (const w of state.overlayWindows) {
    if (w.isDestroyed()) { console.log('  ! pencere yok edilmiş'); continue; }
    const b = w.getBounds();
    console.log(`  ekran ${w.displayId}: görünür=${w.isVisible()} odak=${w.isFocused()} ` +
                `konum=${b.x},${b.y} ${b.width}x${b.height} ` +
                `${w.displayId === aktifDisplay.id ? '<- imleç burada' : ''}`);
  }
}

/** Aşama 2 — donmuş kareler geldi, şeffaf katmanın yerine sessizce geçir. */
function kareleriYerlestir(frames) {
  for (const w of state.overlayWindows) {
    if (w.isDestroyed()) continue;
    const f = eslesenKare(w, frames);
    if (!f) {
      console.warn(`[overlay] ekran ${w.displayId} için kare eşleşmedi`);
      continue;
    }

    // PNG'yi BAYT olarak yolluyoruz, file:// URL olarak değil.
    // Sebep: file:// görseli canvas'ı "tainted" yapıyor ve çizim/blur
    // sonrası dışa aktarım (toBlob) güvenlik hatasıyla patlıyor.
    // Bayt -> blob URL aynı köken sayılıyor, canvas temiz kalıyor.
    let png;
    try {
      png = fs.readFileSync(f.path);
    } catch (e) {
      console.error(`[overlay] kare okunamadı (${f.path}):`, e.message);
      continue;
    }

    w.webContents.send('overlay:kare', {
      png,
      fizikselGenislik: f.width,
      fizikselYukseklik: f.height,
      dipGenislik: w.dipBounds.width,
      dipYukseklik: w.dipBounds.height,
    });
  }
}

/** Native fiziksel koordinat verir, Electron DIP. dipToScreenRect ile eşleştiriyoruz. */
function eslesenKare(win, frames) {
  const p = win.fiziksel;
  let enIyi = null;
  let enIyiFark = Infinity;
  for (const f of frames) {
    const fark = Math.abs(f.x - p.x) + Math.abs(f.y - p.y)
               + Math.abs(f.width - p.width) + Math.abs(f.height - p.height);
    if (fark < enIyiFark) { enIyiFark = fark; enIyi = f; }
  }
  // 4 kenarda toplam 8px'ten fazla sapma varsa eşleşme şüphelidir.
  return enIyiFark <= 8 ? enIyi : enIyi;
}

function gizle() {
  if (!state.overlayAcik) return;
  state.overlayAcik = false;
  for (const w of state.overlayWindows) {
    if (w.isDestroyed()) continue;
    // 🔴 GİZLİLİK: kareyi GİZLERKEN sil, gösterirken değil.
    // Eskiden temizlik `overlay:sifirla` ile gösterme anında yapılıyordu; IPC
    // asenkron olduğu için pencere görünür olduğunda renderer henüz eski kareyi
    // silmemiş oluyordu ve BİR ÖNCEKİ EKRAN GÖRÜNTÜSÜ ~1 sn boyunca ekranda
    // kalıyordu. Ölçüldü: yanında biri varken kabul edilemez.
    // Burada silince yarış yok — bir sonraki Ins'e kadar saniyeler/dakikalar var.
    w.webContents.send('overlay:temizle');
    w.hide();
  }
}

/** Ekran düzeni değişince pencereleri yeniden kur. */
function ekranlariIzle() {
  const yenile = () => {
    if (state.overlayAcik) gizle();
    console.log('[overlay] ekran düzeni değişti, pencereler yeniden kuruluyor');
    olustur();
  };
  screen.on('display-added', yenile);
  screen.on('display-removed', yenile);
  screen.on('display-metrics-changed', yenile);
}

/**
 * Odağı imlecin bulunduğu overlay'e ver.
 *
 * ⚠️ OYUN AÇIKKEN ÇAĞRILMAZ. Tasarım kuralı: "overlay odak çalmamalı, oyun
 * odakta kalsın (ses kısılması / alt-tab efekti olmasın)". Tam ekran oyunda
 * birebir ölçüldü — overlay açılınca oyun gidip geldi.
 * Klavye zaten globalShortcut'tan geliyor, fare odak olmadan da çalışıyor.
 */
function odakVer() {
  if (state.oyunAcik) return false;
  const w = state.overlayWindows.find((x) => x.displayId === state.odakAdayi);
  if (!w || w.isDestroyed()) return false;
  w.focus();
  // Windows bazen odağı vermiyor (foreground lock). Bir kez daha dene.
  setTimeout(() => {
    if (!w.isDestroyed() && state.overlayAcik && !state.oyunAcik) w.focus();
  }, 60);
  return true;
}

module.exports = { olustur, yokEt, goster, gizle, kareleriYerlestir, ekranlariIzle, odakVer };
