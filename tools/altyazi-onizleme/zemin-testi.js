// "Kutu zemini gerçekten basılıyor mu" sorusunu PİKSELDEN cevaplar.
// Hesaplanan stile güvenmiyoruz: getComputedStyle doğru değeri döndürürken
// ekranda başka bir şey görünebiliyor (yığın sırası, karışım kipi, vs).
//
//   npx electron tools/altyazi-onizleme/zemin-testi.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const p = new BrowserWindow({ width: 1180, height: 620, useContentSize: true, show: false });
  await p.loadFile(path.join(__dirname, 'onizleme.html'));
  await new Promise((r) => setTimeout(r, 400));

  // Kutuyu apaçık bir renge boya. Ekranda o renk çıkmıyorsa zemin basılmıyordur.
  const kutu = await p.webContents.executeJavaScript(`(() => {
    const k = document.querySelector('.cev-satir');
    k.style.background = 'rgb(255, 0, 255)';
    const r = k.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await new Promise((r) => setTimeout(r, 120));

  const g = await p.capturePage();
  const bit = g.toBitmap();                    // BGRA, CİHAZ pikseli
  const boy = g.getSize();                     // DIP
  // ⚠️ getSize() DIP döner, toBitmap() cihaz pikseli. 125% ölçekli ekranda
  // DIP genişliğiyle indekslersek her satır kayar ve bambaşka bir piksel okuruz.
  const olcek = Math.sqrt(bit.length / 4 / (boy.width * boy.height));
  const en = Math.round(boy.width * olcek);
  const x = Math.round(kutu.x * olcek), y = Math.round(kutu.y * olcek);
  const i = (y * en + x) * 4;
  const renk = { r: bit[i + 2], g: bit[i + 1], b: bit[i] };
  console.log(`bitmap ${en}px genis · olcek ${olcek.toFixed(2)}`);

  const macenta = renk.r > 200 && renk.b > 200 && renk.g < 80;
  console.log(`nokta (${kutu.x},${kutu.y}) rengi:`, JSON.stringify(renk));
  console.log(macenta
    ? '✓ zemin BASILIYOR — kutu görünür, sorun başka yerde'
    : '✗ zemin BASILMIYOR — kutunun üstünü başka bir katman örtüyor');

  // KONTROL: bilinen bir rengi bilinen bir yere bas ve aynı yolla oku.
  // Bu tutmuyorsa yukarıdaki sonuç değil, ÖLÇÜM ARACI bozuktur.
  await p.webContents.executeJavaScript(
    `document.body.style.background = 'rgb(0,255,0)';
     document.querySelector('.sahne').style.display = 'none';`);
  await new Promise((r) => setTimeout(r, 120));
  const g2 = await p.capturePage();
  const b2 = g2.toBitmap();
  const j = (y * en + x) * 4;
  const k = { r: b2[j + 2], g: b2[j + 1], b: b2[j] };
  console.log('kontrol (aynı noktada yeşil bekleniyor):', JSON.stringify(k),
    k.g > 200 && k.r < 80 ? '✓ ölçüm aracı sağlam' : '✗ ÖLÇÜM ARACI BOZUK — üstteki sonuca güvenme');

  app.quit();
});
