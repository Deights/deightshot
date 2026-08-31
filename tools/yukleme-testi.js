// Ana süreç modülleri sorunsuz yükleniyor mu — uygulamanın TAMAMINI
// başlatmadan. Kurulu shot88 çalışırken `electron .` demek tekil örnek
// kilidine takılıp kurulu sürümde overlay açtırıyor; bu araç onu yapmaz.
//
//   npx electron tools/yukleme-testi.js
//
// Özellikle sınadığı şey: tray.js ↔ ayarlar-penceresi.js karşılıklı require.

const { app } = require('electron');
const path = require('path');

const KOK = path.join(__dirname, '..');
let kaldi = 0;

function dene(ad, fn) {
  try { fn(); console.log('  ✓ ' + ad); }
  catch (e) { kaldi++; console.log('  ✗ ' + ad + '\n      ' + e.message); }
}

app.whenReady().then(() => {
  console.log('=== ana süreç modülleri ===');

  let ayarlarPenceresi, tray;
  dene('settings yüklenir + init', () => {
    const s = require(path.join(KOK, 'src/main/settings'));
    s.init();
    // Yeni alanlar varsayılanda duruyor mu — ve uzak motor KAPALI mı.
    const a = s.get();
    if (a.uzakAcik !== false) throw new Error('uzakAcik varsayılanı false değil!');
    if (a.uzakNeZaman !== 'oyunda') throw new Error('uzakNeZaman varsayılanı yanlış');
    for (const k of ['deeplAnahtar', 'apiUrl', 'apiAnahtar', 'apiModel']) {
      if (a[k] !== '') throw new Error(`${k} varsayılanı boş değil`);
    }
  });

  dene('ayarlar-penceresi yüklenir', () => {
    ayarlarPenceresi = require(path.join(KOK, 'src/main/ayarlar-penceresi'));
    ayarlarPenceresi.init();
  });

  dene('tray yüklenir (karşılıklı require)', () => {
    tray = require(path.join(KOK, 'src/main/tray'));
    if (typeof tray.menuKur !== 'function') throw new Error('menuKur yok');
  });

  dene('ayarlar penceresi açılır ve kapanır', () => {
    const p = ayarlarPenceresi.ac();
    if (!p) throw new Error('pencere oluşmadı');
    // İkinci çağrı yeni pencere AÇMAMALI.
    if (ayarlarPenceresi.ac() !== p) throw new Error('ikinci çağrı yeni pencere açtı');
    ayarlarPenceresi.kapat();
  });

  dene('ceviri modülü yüklenir', () => {
    const ayarlar = { ...require(path.join(KOK, 'src/main/settings')).VARSAYILAN };
    const komutlar = new Map();
    require(path.join(KOK, 'modules/ceviri/main')).init({
      native: { cagir: async () => { throw new Error('yok'); } },
      on: () => {}, overlaya: () => {}, kare: () => null,
      komut: (ad, fn) => komutlar.set(ad, fn),
      ayarlar: { get: () => ayarlar, set: (p) => Object.assign(ayarlar, p) },
      log: () => {},
    });
    const gerekli = ['durum', 'plan', 'cevir', 'cevir-satir', 'acikla',
                     'uzak-durum', 'uzak-ayarla', 'api-sina', 'model-sec', 'bosalt'];
    const eksik = gerekli.filter((k) => !komutlar.has(k));
    if (eksik.length) throw new Error('eksik komut: ' + eksik.join(', '));
  });

  console.log(kaldi ? `\n${kaldi} hata` : '\nhepsi tamam');
  app.exit(kaldi ? 1 : 0);
});
