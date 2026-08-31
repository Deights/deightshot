// Altyazı (satır içi çeviri) görsel önizlemesi.
//
//   npx electron tools/altyazi-onizleme
//
// 🔴 Neden ayrı bir Electron penceresi: tools/gorsel-test.js gerçek EKRANI
// yakalıyor ve bir kez özel/kişisel içerik kazara kaydedilmişti.
// Burada sadece PENCERENİN İÇİ çekiliyor — masaüstü hiç görüntülenmiyor,
// sentetik tuş da üretilmiyor. Sahne yapay, gerçek ekran görüntüsü değil.
//
// Çıktı: %TEMP%\deightshot\altyazi-onizleme\{alt,ustu}.png

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const CIKTI = path.join(process.env.TEMP, 'deightshot', 'altyazi-onizleme');
const GEN = 1180, YUK = 620;

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ Gizli pencerede capturePage() BİR ÖNCEKİ kareyi döndürebiliyor. Ölçüm
// yaparken bu sessizce yanlış sonuç verdi (stil değişikliği görünmedi sandık).
// İki kez yakalayıp ikincisini alıyoruz.
async function cek(pencere, ad) {
  await pencere.capturePage();
  await bekle(120);
  const g = await pencere.capturePage();
  const yol = path.join(CIKTI, ad + '.png');
  fs.writeFileSync(yol, g.toPNG());
  console.log('yazildi:', yol);
}

app.whenReady().then(async () => {
  fs.mkdirSync(CIKTI, { recursive: true });

  const p = new BrowserWindow({
    width: GEN, height: YUK, useContentSize: true,
    show: false,                     // kullanıcının ekranına hiç düşmesin
    backgroundColor: '#0b0d12',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  await p.loadFile(path.join(__dirname, 'onizleme.html'));
  await bekle(400);                  // font yüklensin, yerleşim otursun

  console.log('otomatik secilen kip:',
    await p.webContents.executeJavaScript('otomatikKip() ? "ustunde" : "altinda"'));

  await p.webContents.executeJavaScript('ciz(false)');
  await bekle(250);
  await cek(p, 'alt');

  await p.webContents.executeJavaScript('ciz(true)');
  await bekle(250);
  await cek(p, 'ustu');

  app.quit();
});
