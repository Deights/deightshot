// Bilinen metinlerden test PNG'leri üretir. EKRAN YAKALAMAZ — sadece
// Electron penceresinin içini çeker, sahne yapay.
//
//   npx electron tools/ocr-dil-secimi/uret.js
//
// ⚠️ Önceki sürüm her örnek için `loadURL('data:...')` kullanıyordu ve
// döngüde takılıyordu. Gerçek dosyaya yazıp `loadFile` ile yüklemek güvenilir.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const CIKTI = path.join(process.env.TEMP, 'deightshot', 'ocr-dil');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const ORNEKLER = require('./metinler');

const kacir = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

app.whenReady().then(async () => {
  fs.mkdirSync(CIKTI, { recursive: true });

  const p = new BrowserWindow({
    width: 1100, height: 360, useContentSize: true, show: false,
    backgroundColor: '#101014',
  });

  for (const o of ORNEKLER) {
    // Oyun arayüzüne benzer: koyu zemin, açık yazı.
    const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#101014">
<div style="padding:22px 26px;font:${o.punto}px/1.55 'Segoe UI',system-ui,sans-serif;
            color:#e9ecf2;white-space:pre-wrap;letter-spacing:.2px">${kacir(o.metin)}</div>
</body>`;
    const htmlYol = path.join(CIKTI, o.ad + '.html');
    fs.writeFileSync(htmlYol, html, 'utf8');

    await p.loadFile(htmlYol);
    await bekle(300);
    await p.capturePage();                 // gizli pencerede ilk kare bayat olabiliyor
    await bekle(120);
    const g = await p.capturePage();
    fs.writeFileSync(path.join(CIKTI, o.ad + '.png'), g.toPNG());
    console.log('yazildi:', o.ad + '.png');
  }

  app.quit();
});
