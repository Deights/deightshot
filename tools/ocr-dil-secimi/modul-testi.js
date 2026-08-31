// metin-secme modülünün OTOMATİK DİL seçimini üretim yolundan sınar.
// coklu-olc.js algoritmayı ölçüyor; bu, modülün onu doğru kullandığını.
//
//   node tools/ocr-dil-secimi/modul-testi.js
//
// Ekran gerektirmez, sentetik tuş üretmez.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const KOK = path.join(__dirname, '..', '..');
const EXE = path.join(KOK, 'native', 'DeightShot.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'deightshot-native.exe');
const GORUNTU = path.join(process.env.TEMP, 'deightshot', 'ocr-dil');
const ORNEKLER = require('./metinler');

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
const cagir = (cmd, args, ms = 25000) => {
  const i = id++;
  proc.stdin.write(JSON.stringify({ id: i, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bek.set(i, { res, rej });
    setTimeout(() => { if (bek.delete(i)) rej(new Error('zaman asimi')); }, ms);
  });
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Beklenen motor: örneğin diline göre. Latin olanlar tr/en-US'ten biri.
const BEKLENEN = {
  tr: (k) => k === 'tr',
  en: (k) => k === 'en-US',
  ru: (k) => k.toLowerCase().startsWith('ru'),
  zh: (k) => k.toLowerCase().startsWith('zh'),
  ja: (k) => k.toLowerCase().startsWith('ja'),
  karisik: (k) => k === 'tr' || k === 'en-US',
};

(async () => {
  for (let i = 0; i < 80 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  let aktifPng = null;
  const komutlar = new Map();
  const kayitlar = [];
  require(path.join(KOK, 'modules', 'metin-secme', 'main')).init({
    native: { cagir, calisiyorMu: () => true },
    on: () => {}, overlaya: () => {},
    // Modül kareyi buradan alıyor — test görüntüsünü veriyoruz.
    kare: () => ({ path: aktifPng, width: 1100, height: 360, x: 0, y: 0 }),
    komut: (ad, fn) => komutlar.set(ad, fn),
    ayarlar: { get: () => ({ ocrDil: 'oto', ocrOlcek: 1.5 }), set: () => {} },
    log: (...a) => kayitlar.push(a.join(' ')),
  });

  let gecti = 0, kaldi = 0;
  for (const o of ORNEKLER) {
    aktifPng = path.join(GORUNTU, o.ad + '.png');
    if (!fs.existsSync(aktifPng)) { console.log('EKSİK:', o.ad); continue; }

    kayitlar.length = 0;
    const t0 = Date.now();
    // Her örnek ayrı bölge sayılsın ki önbellek karışmasın.
    const r = await komutlar.get('al')({
      displayId: kayitlar.length + Math.random(), x: 0, y: 0, w: 1100, h: 360, olcek: 1,
    });
    const ms = Date.now() - t0;

    const ok = BEKLENEN[o.dil](r.dil);
    if (ok) gecti++; else kaldi++;
    const sec = kayitlar.find((k) => k.startsWith('dil otomatik')) || '(log yok)';
    console.log(`${ok ? '✓' : '✗'} ${o.ad.padEnd(17)} -> ${String(r.dil).padEnd(11)} ` +
      `${String(ms + 'ms').padStart(6)}  ${r.kelimeler.length} kelime`);
    console.log(`     ${sec}`);
    if (!ok) console.log(`     çıktı: ${(r.metin || '').replace(/\n/g, ' ').slice(0, 70)}`);
  }

  console.log(`\nTOPLAM: ${gecti} geçti, ${kaldi} kaldı`);
  proc.stdin.end();
  process.exitCode = kaldi ? 1 : 0;
  setTimeout(() => process.exit(kaldi ? 1 : 0), 300);
})().catch((e) => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
