// Önizleme penceresindeki .cev-satir kutularının HESAPLANMIŞ stilini döker.
// Amaç: "kutu neden saydam görünüyor" gibi soruları tahminle değil ölçümle
// cevaplamak. Ekran yakalamaz.
//
//   npx electron tools/altyazi-onizleme/denetle.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const p = new BrowserWindow({ width: 1180, height: 620, useContentSize: true, show: false });
  await p.loadFile(path.join(__dirname, 'onizleme.html'));
  await new Promise((r) => setTimeout(r, 400));

  const r = await p.webContents.executeJavaScript(`(() => {
    const kutular = [...document.querySelectorAll('.cev-satir')];
    const oku = (e) => {
      const s = getComputedStyle(e);
      return {
        metin: e.textContent.slice(0, 22),
        arka: s.backgroundColor, renk: s.color, opaklik: s.opacity,
        punto: s.fontSize, kenar: s.borderLeftWidth + ' ' + s.borderLeftColor,
        zIndex: getComputedStyle(document.getElementById('ceviriKat')).zIndex,
      };
    };
    // Kaynak satırlarla dikey çakışma var mı — "altında" kipinin asıl sınavı.
    const kaynaklar = [...document.querySelectorAll('.kaynak')].map((e) => e.getBoundingClientRect());
    const cakisma = [];
    kutular.forEach((k, i) => {
      const a = k.getBoundingClientRect();
      kaynaklar.forEach((b, j) => {
        if (i === j) return;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          cakisma.push(k.textContent.slice(0, 20) + '  ⨯  ' + document.querySelectorAll('.kaynak')[j].textContent.slice(0, 20));
        }
      });
    });
    return { ornek: kutular.slice(0, 3).map(oku), cakismaSayisi: cakisma.length, cakisma };
  })()`);

  console.log(JSON.stringify(r, null, 2));
  app.quit();
});
