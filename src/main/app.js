// shot88 — ana süreç önyükleme.
// Uygulama penceresiz çalışır: tray'de durur, Ins'e basınca overlay açılır.
const { app, BrowserWindow } = require('electron');

const state = require('./state');
const settings = require('./settings');
const native = require('./native');
const overlay = require('./overlay');
const capture = require('./capture');
const hotkeys = require('./hotkeys');
const tray = require('./tray');
const autostart = require('./autostart');
const moduleHost = require('./moduleHost');
const ayarlarPenceresi = require('./ayarlar-penceresi');

// Tek örnek: ikinci kez açılırsa mevcut örneğe bölge seçimi yaptır.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => capture.ac());
  basla();
}

function basla() {
  // Tray uygulaması — pencere kapanınca çıkma.
  app.on('window-all-closed', (e) => e && e.preventDefault && e.preventDefault());

  app.whenReady().then(async () => {
    settings.init();

    // Native süreci hemen başlasın: D3D cihazı ısınsın, ilk Ins'te
    // 300ms gecikme olmasın (ölçüldü).
    if (native.baslat()) {
      // Kısayol hook'u native tarafta kurulacağı için hazır olmasını bekliyoruz.
      // Gelmezse uiohook yedeğine düşülür — açılış takılmasın diye 4sn sınır.
      await Promise.race([
        native.hazirSozu,
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    }

    overlay.olustur();
    overlay.ekranlariIzle();

    capture.init();
    autostart.esitle();     // ayar dosyası ile Windows kaydını hizala
    ayarlarPenceresi.init();
    tray.init();

    const hookOk = await hotkeys.init();
    if (!hookOk) {
      console.error('[app] klavye hook’u yok — kısayol çalışmayacak, tray menüsünden kullan');
    }
    tray.menuKur();

    // Modüllere çekirdek yetenekleri veriliyor. `kareBul` olmadan OCR modülü
    // hangi kareyi okuyacağını bilemez (bu unutulmuştu, duman testi yakaladı).
    moduleHost.load({ state, settings, native, kareBul: capture.kareBul });

    // Kurulu OCR dillerini bir kez oku — tepsi menüsü ve dil değiştirici
    // buradan besleniyor. Yeni dil paketi kurulunca uygulama yeniden
    // başlatıldığında kendiliğinden listeye düşer.
    native.cagir('ocr-langs', {}, 5000)
      .then((d) => {
        state.ocrDilleri = d.languages || [];
        console.log('[ocr] kurulu diller:', state.ocrDilleri.join(', ') || '(yok)');
        tray.menuKur();
      })
      .catch((e) => console.warn('[ocr] dil listesi okunamadı:', e.message));

    console.log('[app] shot88 hazır. Tray’de bekliyor.');

    // Otomatik duman testi: SMOKE88=1 → tetikle, sonra kapat.
    if (process.env.SMOKE88) smokeTesti();
  });

  app.on('before-quit', () => {
    state.kapaniyor = true;
    // Hook mutlaka kaldırılmalı — kalırsa Ins sistem genelinde yutulmaya devam eder.
    hotkeys.durdur();
    native.durdur();
  });
}

// --- duman testi -------------------------------------------------
// Elle Ins'e basmadan uçtan uca akışı doğrular.
async function smokeTesti() {
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[smoke]', ...a);

  try {
    log('native ping...');
    log('ping:', JSON.stringify(await native.cagir('ping')));

    log('overlay açılıyor (kısayol simülasyonu)');
    state.events.emit('kisayol-basildi');
    await bekle(1500);

    log('overlay açık mı:', state.overlayAcik);
    log('pencere sayısı:', state.overlayWindows.length);
    for (const w of state.overlayWindows) {
      log(`  ekran ${w.displayId} görünür=${w.isVisible()} dip=${w.dipBounds.width}x${w.dipBounds.height} fiziksel=${w.fiziksel.width}x${w.fiziksel.height}`);
    }

    log('tüm ekran modu (eşik aşıldı simülasyonu)');
    state.events.emit('esik-asildi');
    await bekle(600);

    // Overlay arayüzünü GÖZLE doğrulamak için pencerenin kendi render'ını al.
    // Ekran yakalama ile alınamıyor: overlay bilerek yakalamaya görünmez
    // (setContentProtection). capturePage pencerenin içeriğini doğrudan verir.
    try {
      const fs = require('fs');
      const path = require('path');
      const dizin = path.join(require('os').tmpdir(), 'shot88', 'arayuz');
      fs.mkdirSync(dizin, { recursive: true });
      for (const w of state.overlayWindows) {
        if (w.isDestroyed()) continue;
        const g = await w.webContents.capturePage();
        const p = path.join(dizin, `overlay-ekran${w.displayId}.png`);
        fs.writeFileSync(p, g.toPNG());
        log(`arayüz görüntüsü: ${p}`);
      }
    } catch (e) {
      log('arayüz görüntüsü alınamadı: ' + e.message);
    }

    // --- çizim + mozaik + kompozit dışa aktarım testi ---
    // Fareyle sürükleyemediğimiz için şekilleri doğrudan renderer'a enjekte
    // edip gerçek dışa aktarım yolunu (kare + tuval birleştirme) çalıştırıyoruz.
    try {
      const w0 = state.overlayWindows[0];
      const sonuc = await w0.webContents.executeJavaScript(`(async () => {
        secim = { x: 120, y: 120, w: 900, h: 500 };
        sekiller = [
          { tip:'kutu',   renk:'#ff3b30', kal:4, x1:180, y1:180, x2:520, y2:340 },
          { tip:'ok',     renk:'#ffcc00', kal:5, x1:560, y1:520, x2:820, y2:250 },
          { tip:'cizgi',  renk:'#34c759', kal:3, x1:200, y1:420, x2:520, y2:420 },
          { tip:'daire',  renk:'#0a84ff', kal:4, x1:620, y1:180, x2:820, y2:330 },
          { tip:'kalem',  renk:'#ffffff', kal:4, noktalar:[{x:220,y:470},{x:280,y:500},{x:340,y:460},{x:400,y:505}] },
          { tip:'vurgu',  renk:'#ffcc00', kal:5, noktalar:[{x:600,y:560},{x:900,y:560}] },
          // Mozaik okunur metnin üstüne — redaksiyon gerçekten çalışıyor mu görelim
          { tip:'mozaik', renk:'#000',    kal:1, x1:60,  y1:250, x2:215, y2:430 },
          { tip:'metin',  renk:'#ffffff', kal:4, punto:26, x:640, y:400, satirlar:['shot88 testi'] },
        ];
        tuvalCiz();
        ciz();
        const png = await kompozitPng();
        return { sekil: sekiller.length, bayt: png.length, kareVar: !!kareBitmap, olcek };
      })()`);
      log(`çizim testi: ${sonuc.sekil} şekil, kompozit PNG ${Math.round(sonuc.bayt / 1024)} KB, ` +
          `kare=${sonuc.kareVar} ölçek=${sonuc.olcek}`);

      await bekle(300);
      const g = await w0.webContents.capturePage();
      const p2 = require('path').join(require('os').tmpdir(), 'shot88', 'arayuz', 'overlay-cizimli.png');
      require('fs').writeFileSync(p2, g.toPNG());
      log(`çizimli arayüz görüntüsü: ${p2}`);
    } catch (e) {
      log('çizim testi BAŞARISIZ: ' + e.message);
    }

    // --- metin seçme (OCR) testi ---
    // Sentetik tuş/fare kullanmadan renderer mantığını doğrudan çalıştırıyoruz.
    try {
      const w0 = state.overlayWindows[0];
      const m = await w0.webContents.executeJavaScript(`(async () => {
        // Ekranın metin dolu bir bölgesini seç
        sekiller = [];
        secim = { x: 0, y: 0, w: Math.min(1000, dipGenislik), h: Math.min(700, dipYukseklik) };
        tuvalCiz(); ciz();

        ocrTetikle();
        const t0 = Date.now();
        await metinModunaGir();
        const acilis = Date.now() - t0;

        if (!metinModu) return { hata: 'metin moduna girilemedi', kelime: kelimeler.length };

        // İlk satırı seç (üç tık davranışı)
        satiriSec(0);
        const satirMetni = seciliMetin();
        const satirAdet = kelimeSecim ? kelimeSecim.b - kelimeSecim.a + 1 : 0;

        // Hepsini seç (Ctrl+A davranışı)
        araligiKur(0, kelimeler.length - 1);
        const tumMetin = seciliMetin();

        // Kelime kutusu hizası: ilk kelimenin merkezinden geri bul
        const k0 = kelimeler[0];
        const bulunan = kelimeBul(k0.x + k0.w / 2, k0.y + k0.h / 2);

        return {
          kelime: kelimeler.length,
          acilisMs: acilis,
          ilkKelime: k0.metin,
          ilkKutu: { x: Math.round(k0.x), y: Math.round(k0.y), w: Math.round(k0.w), h: Math.round(k0.h) },
          isabet: bulunan === 0,
          satirAdet,
          satirMetni: satirMetni.slice(0, 80),
          satirSayisi: (tumMetin.match(/\\n/g) || []).length + 1,
          toplamKarakter: tumMetin.length,
          ornek: tumMetin.slice(0, 160),
        };
      })()`);

      if (m.hata) {
        log(`METİN TESTİ BAŞARISIZ: ${m.hata} (kelime=${m.kelime})`);
      } else {
        log(`metin modu: ${m.kelime} kelime, açılış ${m.acilisMs} ms`);
        log(`  ilk kelime "${m.ilkKelime}" @ ${JSON.stringify(m.ilkKutu)} — isabet testi: ${m.isabet ? 'GEÇTİ' : 'KALDI'}`);
        log(`  satır seçimi: ${m.satirAdet} kelime -> "${m.satirMetni}"`);
        log(`  tümü: ${m.toplamKarakter} karakter, ${m.satirSayisi} satır`);
        log(`  örnek: ${JSON.stringify(m.ornek)}`);
      }

      await bekle(300);
      const g2 = await w0.webContents.capturePage();
      const p3 = require('path').join(require('os').tmpdir(), 'shot88', 'arayuz', 'overlay-metin.png');
      require('fs').writeFileSync(p3, g2.toPNG());
      log(`metin modu görüntüsü: ${p3}`);

      // Görsel moda geri dön ki kopyalama testi bozulmasın
      await w0.webContents.executeJavaScript('metinModundanCik(); secim = { x:40, y:40, w:400, h:200 }; ciz();');
    } catch (e) {
      log('metin testi HATA: ' + e.message);
    }

    log('birincil ekranda 400x200 bölge panoya kopyalanıyor');
    const w0 = state.overlayWindows[0];
    const sonuc = await capture.tamamla({
      displayId: w0.displayId,
      x: 40, y: 40, w: 400, h: 200,
      dipGenislik: w0.dipBounds.width,
      dipYukseklik: w0.dipBounds.height,
    }, 'kopyala');
    log('kopyalama sonucu:', JSON.stringify(sonuc));

    const { clipboard } = require('electron');
    const pano = clipboard.readImage();
    log('panodaki görsel:', pano.isEmpty() ? 'BOŞ (hata)' : `${pano.getSize().width}x${pano.getSize().height}`);

    await bekle(300);
    log('overlay kapandı mı:', !state.overlayAcik);

    // --- REGRESYON: metin modunda Ctrl+C GÖRSELİ değil METNİ kopyalamalı ---
    // Bu bir kez kırıldı: Ctrl+C globalShortcut'tan geliyor, ana süreç metin
    // modunda olduğumuzu bilmediği için görseli kopyalıyordu (kullanımda yakalandı).
    let metinKopyaOk = false;
    try {
      await capture.ac();
      await bekle(1200);
      const w1 = state.overlayWindows[0];
      await w1.webContents.executeJavaScript(`(async () => {
        secim = { x: 0, y: 0, w: Math.min(1000, dipGenislik), h: Math.min(700, dipYukseklik) };
        ciz(); ocrTetikle();
        await metinModunaGir();
        if (metinModu) araligiKur(0, Math.min(4, kelimeler.length - 1));
        return metinModu;
      })()`);
      await bekle(200);

      clipboard.clear();
      capture.testEylem('kopyala');        // globalShortcut ile BİREBİR aynı yol
      await bekle(700);

      const metin = clipboard.readText();
      const gorselP = clipboard.readImage();
      metinKopyaOk = !!metin.trim() && gorselP.isEmpty();
      log(`metin kopyalama -> metin: ${JSON.stringify(metin.slice(0, 60))}`);
      log(`                   görsel: ${gorselP.isEmpty() ? 'yok (doğru)' : 'VAR (YANLIŞ)'}`);
      log(metinKopyaOk ? '  metin modu kopyalama: GEÇTİ' : '  metin modu kopyalama: KALDI');
    } catch (e) {
      log('metin kopyalama testi HATA: ' + e.message);
    }

    // --- AI paneli: çeviri/açıklama arayüzü render oluyor mu ---
    if (process.env.SMOKE88_AI) {
      try {
        await capture.ac();
        await bekle(1200);
        const w2 = state.overlayWindows[0];
        const ai = await w2.webContents.executeJavaScript(`(async () => {
          secim = { x: 0, y: 0, w: Math.min(1000, dipGenislik), h: Math.min(700, dipYukseklik) };
          ciz(); ocrTetikle();
          await metinModunaGir();
          if (!metinModu) return { hata: 'metin moduna girilemedi' };
          araligiKur(0, Math.min(30, kelimeler.length - 1));
          await aiCalistir('acikla');
          return { acik: aiAcik, bilgi: aiBilgi.textContent, uzunluk: (aiSonuc || '').length };
        })()`);
        log('AI paneli: ' + JSON.stringify(ai));

        const g3 = await w2.webContents.capturePage();
        const p4 = require('path').join(require('os').tmpdir(), 'shot88', 'arayuz', 'overlay-ai.png');
        require('fs').mkdirSync(require('path').dirname(p4), { recursive: true });
        require('fs').writeFileSync(p4, g3.toPNG());
        log(`AI paneli görüntüsü: ${p4}`);
        capture.kapat();
      } catch (e) {
        log('AI paneli testi HATA: ' + e.message);
      }
    }

    log(!pano.isEmpty() && metinKopyaOk ? 'TAMAM' : 'BAŞARISIZ');
  } catch (e) {
    console.error('[smoke] HATA:', e.message);
  } finally {
    setTimeout(() => { state.kapaniyor = true; app.quit(); }, 800);
  }
}
