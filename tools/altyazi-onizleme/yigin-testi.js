// Hangi katman kimin üstünde — yığınlama (stacking) denetimi.
//   npx electron tools/altyazi-onizleme/yigin-testi.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const p = new BrowserWindow({ width: 1180, height: 620, useContentSize: true, show: false });
  await p.loadFile(path.join(__dirname, 'onizleme.html'));
  await new Promise((r) => setTimeout(r, 400));

  const r = await p.webContents.executeJavaScript(`(() => {
    const oku = (sec) => {
      const e = document.querySelector(sec);
      if (!e) return { sec, yok: true };
      const s = getComputedStyle(e);
      return { sec, position: s.position, zIndex: s.zIndex, isolation: s.isolation,
               transform: s.transform, filter: s.filter, opacity: s.opacity,
               mixBlendMode: s.mixBlendMode, ebeveyn: e.parentElement.tagName };
    };
    // En üstteki eleman kim — tarayıcıya sor, tahmin etme.
    const k = document.querySelector('.cev-satir').getBoundingClientRect();
    const nokta = document.elementFromPoint(Math.round(k.left + k.width/2), Math.round(k.top + k.height/2));
    return {
      katmanlar: [oku('.sahne'), oku('#ceviriKat'), oku('.cev-satir'), oku('.menu')],
      noktadakiEleman: nokta ? (nokta.className || nokta.tagName) : null,
    };
  })()`);

  console.log(JSON.stringify(r, null, 2));
  app.quit();
});
