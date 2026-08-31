// Altyazı dışa aktarım testi: kopyalanan görüntüde çeviri görünüyor mu.
//
//   npx electron tools/altyazi-onizleme/disa-aktarim-testi.js
//
// 🔴 Gerçek kodu sınar: `altyaziyiTuvaleCiz` fonksiyonunun kaynağı doğrudan
// src/ui/overlay/overlay.js'ten okunup sahneye enjekte ediliyor. Kopyasını
// yazsaydık overlay.js değiştiğinde test yalan söylemeye başlardı.
//
// Çıktı: %TEMP%\shot88\altyazi-onizleme\disa-aktarim.png

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const KOK = path.join(__dirname, '..', '..');
const CIKTI = path.join(process.env.TEMP, 'shot88', 'altyazi-onizleme');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** overlay.js'ten bir fonksiyonun kaynağını süslü parantez sayarak çıkar. */
function fonksiyonuAl(kaynak, ad) {
  const bas = kaynak.indexOf(`function ${ad}(`);
  if (bas === -1) throw new Error(`${ad} bulunamadı`);
  let derinlik = 0, i = kaynak.indexOf('{', bas);
  const govdeBas = i;
  for (; i < kaynak.length; i++) {
    if (kaynak[i] === '{') derinlik++;
    else if (kaynak[i] === '}') { derinlik--; if (derinlik === 0) break; }
  }
  if (derinlik !== 0) throw new Error(`${ad} kapanmıyor`);
  return kaynak.slice(bas, i + 1) + `\n// govde ${govdeBas}..${i}`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(CIKTI, { recursive: true });

  const overlayJs = fs.readFileSync(
    path.join(KOK, 'src', 'ui', 'overlay', 'overlay.js'), 'utf8');
  const kod = [
    fonksiyonuAl(overlayJs, 'yuvarlakYol'),
    fonksiyonuAl(overlayJs, 'altyaziyiTuvaleCiz'),
  ].join('\n\n');

  const p = new BrowserWindow({
    width: 1180, height: 620, useContentSize: true, show: false,
    backgroundColor: '#0b0d12',
  });
  await p.loadFile(path.join(__dirname, 'onizleme.html'));
  await bekle(400);

  const sonuc = await p.webContents.executeJavaScript(`(() => {
    ${kod}

    // Fonksiyonun beklediği global'ler (overlay.js'te modül kapsamında duruyor)
    const elCevKat = document.getElementById('ceviriKat');
    const cevSatirlar = [1];      // "altyazı var" demek için yeterli
    const olcek = 1;

    // Sahnenin tamamını dışa aktarıyormuşuz gibi davran.
    const out = document.createElement('canvas');
    out.width = innerWidth; out.height = innerHeight;
    const octx = out.getContext('2d');

    // Zemin: gerçek akışta donmuş kare geliyor, burada sahneyi taklit et.
    octx.fillStyle = '#0e1420';
    octx.fillRect(0, 0, out.width, out.height);

    // Kaynak satırları da çiz ki altyazı neyin altında, gözle görülsün.
    octx.fillStyle = '#dfe4ee';
    for (const e of document.querySelectorAll('.kaynak')) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      octx.font = s.fontWeight + ' ' + s.fontSize + ' "Segoe UI", sans-serif';
      octx.textBaseline = 'middle';
      octx.fillText(e.textContent, r.left, r.top + r.height / 2);
    }

    altyaziyiTuvaleCiz(octx, 0, 0);

    // Ekrandaki DOM kutularını gizle: PNG'de görünen ne varsa TUVALDEN gelmiş
    // olsun, yoksa test kendini kandırır.
    elCevKat.style.visibility = 'hidden';
    document.querySelector('.sahne').style.visibility = 'hidden';
    document.body.style.margin = '0';
    const img = document.createElement('img');
    img.src = out.toDataURL();
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
    document.body.appendChild(img);

    return { kutu: elCevKat.querySelectorAll('.cev-satir').length };
  })()`);

  console.log('tuvale cizilen altyazi kutusu:', sonuc.kutu);
  await bekle(500);
  await p.capturePage();
  await bekle(150);
  const g = await p.capturePage();
  const yol = path.join(CIKTI, 'disa-aktarim.png');
  fs.writeFileSync(yol, g.toPNG());
  console.log('yazildi:', yol);

  app.quit();
});
