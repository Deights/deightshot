// OCR dil seçimi ölçümü — hangi dil hangi metinde ne kadar doğru,
// ve "otomatik seçim" sezgisi işe yarıyor mu.
//
//   npx electron tools/ocr-dil-secimi/uret.js   (önce görüntüleri üret)
//   node tools/ocr-dil-secimi/olc.js
//
// 🔴 Dolaylı puan YOK: çıktı bilinen metinle karakter karakter kıyaslanıyor.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const KOK = path.join(__dirname, '..', '..');
const EXE = path.join(KOK, 'native', 'DeightShot.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'deightshot-native.exe');
const GORUNTU = path.join(process.env.TEMP, 'deightshot', 'ocr-dil');
const ORNEKLER = require('./metinler');

// --- native köprüsü ---
const proc = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = readline.createInterface({ input: proc.stdout });
let id = 1; const bek = new Map(); let hazir = false;
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.evt === 'ready') { hazir = true; return; }
  if (m.evt) return;
  const p = bek.get(m.id);
  if (p) { bek.delete(m.id); m.ok ? p.res(m.data) : p.rej(new Error(m.error)); }
});
proc.stderr.on('data', () => {});
const cagir = (cmd, args, ms = 20000) => {
  const i = id++;
  proc.stdin.write(JSON.stringify({ id: i, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bek.set(i, { res, rej });
    setTimeout(() => { if (bek.delete(i)) rej(new Error('zaman asimi')); }, ms);
  });
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// --- karşılaştırma ---
const sadelestir = (s) => String(s).toLowerCase()
  .replace(/\s+/g, ' ').replace(/[.,:;!?]/g, '').trim();

/** Levenshtein — kısa metinlerde yeterince hızlı. */
function uzaklik(a, b) {
  const m = a.length, n = b.length;
  let onceki = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const simdi = [i];
    for (let j = 1; j <= n; j++) {
      simdi[j] = Math.min(onceki[j] + 1, simdi[j - 1] + 1,
        onceki[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    onceki = simdi;
  }
  return onceki[n];
}
const dogruluk = (beklenen, bulunan) => {
  const a = sadelestir(beklenen), b = sadelestir(bulunan);
  if (!a.length) return 0;
  return Math.max(0, 1 - uzaklik(a, b) / a.length);
};

// --- sınanacak sezgi ---
// Türkçeye ÖZGÜ harfler: İngilizce OCR bunları hiç üretemiyor.
// Sayıları yüksekse metin Türkçedir → tr sonucunu kullan.
const TR_OZGU = /[ğĞşŞıİ]/g;
function trOraniHesapla(metin) {
  const harf = (metin.match(/\p{L}/gu) || []).length;
  if (!harf) return 0;
  return ((metin.match(TR_OZGU) || []).length) / harf;
}

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  const diller = await cagir('ocr-langs', {}, 5000);
  console.log('kurulu OCR dilleri:', (diller.languages || []).join(', '));
  console.log('ölçek: 1.5 (ayardaki varsayılan)\n');

  const satirlar = [];
  for (const o of ORNEKLER) {
    const png = path.join(GORUNTU, o.ad + '.png');
    if (!fs.existsSync(png)) { console.log('EKSİK görüntü:', png); continue; }

    const sonuc = {};
    for (const lang of ['tr', 'en-US']) {
      try {
        const r = await cagir('ocr', { path: png, lang, scale: 1.5 });
        sonuc[lang] = { metin: r.text || '', d: dogruluk(o.metin, r.text || '') };
      } catch (e) {
        sonuc[lang] = { metin: '', d: 0, hata: e.message };
      }
    }

    const oran = trOraniHesapla(sonuc['tr'].metin);
    const secim = oran >= 0.02 ? 'tr' : 'en-US';
    satirlar.push({ ad: o.ad, dil: o.dil, sonuc, oran, secim });

    console.log(`### ${o.ad}  (gerçek dil: ${o.dil}, ${o.punto}px)`);
    console.log(`   tr    : %${(sonuc['tr'].d * 100).toFixed(1)}`);
    console.log(`   en-US : %${(sonuc['en-US'].d * 100).toFixed(1)}`);
    console.log(`   tr-özgü harf oranı: ${(oran * 100).toFixed(2)}%  ->  otomatik seçim: ${secim}`);
    const enIyi = sonuc['tr'].d >= sonuc['en-US'].d ? 'tr' : 'en-US';
    console.log(`   en iyi olan: ${enIyi}  ${secim === enIyi ? '✓ sezgi doğru' : '✗ SEZGİ YANILDI'}`);
    console.log(`   tr çıktı   : ${sonuc['tr'].metin.replace(/\n/g, ' | ').slice(0, 110)}`);
    console.log(`   en çıktı   : ${sonuc['en-US'].metin.replace(/\n/g, ' | ').slice(0, 110)}\n`);
  }

  // Özet
  console.log('='.repeat(70));
  console.log('ad'.padEnd(20) + 'tr'.padStart(8) + 'en-US'.padStart(8) +
              'seçim'.padStart(9) + 'doğru mu'.padStart(11));
  let yanlis = 0;
  for (const s of satirlar) {
    const enIyi = s.sonuc['tr'].d >= s.sonuc['en-US'].d ? 'tr' : 'en-US';
    const ok = s.secim === enIyi;
    if (!ok) yanlis++;
    console.log(s.ad.padEnd(20) +
      ('%' + (s.sonuc['tr'].d * 100).toFixed(0)).padStart(8) +
      ('%' + (s.sonuc['en-US'].d * 100).toFixed(0)).padStart(8) +
      s.secim.padStart(9) + (ok ? '✓' : '✗').padStart(11));
  }
  console.log(`\notomatik seçim ${satirlar.length - yanlis}/${satirlar.length} doğru`);

  proc.stdin.end();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
