// OCR dil karşılaştırması — EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
//
// Soru: İngilizce ekran metnini Türkçe modelle okumak ne kadar bozuyor?
// Ve "otomatik dil seçimi" için basit bir kalite ölçütü işe yarıyor mu?
//
//   node tools/ocr-dil-karsilastir.js [png]
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const EXE = path.join(__dirname, '..', 'native', 'DeightShot.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'deightshot-native.exe');

const dizin = path.join(process.env.TEMP, 'deightshot', 'gorsel-test');
const PNG = process.argv[2] ||
  path.join(dizin, fs.readdirSync(dizin).filter(f => f.startsWith('ekran0'))[0]);

const proc = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = readline.createInterface({ input: proc.stdout });
let nextId = 1; const bekleyen = new Map(); let hazir = false;
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.evt === 'ready') { hazir = true; return; }
  if (m.evt) return;
  const p = bekleyen.get(m.id);
  if (p) { bekleyen.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); }
});
proc.stderr.on('data', () => {});
const cagir = (cmd, args) => {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bekleyen.set(id, { resolve: res, reject: rej });
    setTimeout(() => { if (bekleyen.delete(id)) rej(new Error('zaman asimi')); }, 25000);
  });
};
const bekle = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Kalite olcutu: yanlis dil modeli kelimeleri PARCALIYOR.
 * Uzun kelimeler iyi sinyal, tek-iki harflik parcalar kotu sinyal.
 */
function puan(kelimeler) {
  let uzun = 0, kirik = 0, harf = 0;
  for (const k of kelimeler) {
    const t = k.text;
    if (t.length >= 4) uzun++;
    if (t.length <= 2 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(t)) kirik++;
    harf += t.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '').length;
  }
  return { puan: uzun * 2 - kirik, uzun, kirik, harf, adet: kelimeler.length };
}

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');
  console.log('goruntu:', path.basename(PNG), '\n');

  const diller = (await cagir('ocr-langs')).languages;
  console.log('kurulu diller:', diller.join(', '), '\n');

  const bolge = { x: 0, y: 0, w: 1000, h: 700 };
  const sonuclar = [];

  for (const d of diller) {
    const r = await cagir('ocr', { path: PNG, lang: d, ...bolge });
    const kelimeler = r.lines.flatMap(l => l.words);
    const p = puan(kelimeler);
    sonuclar.push({ dil: d, ms: r.ms, ...p, metin: r.text });
    console.log(`--- ${d} --- ${r.ms} ms`);
    console.log(`   kelime=${p.adet}  uzun(>=4)=${p.uzun}  kirik(<=2)=${p.kirik}  puan=${p.puan}`);
    console.log(`   ${JSON.stringify(r.text.slice(0, 150))}`);
    console.log();
  }

  sonuclar.sort((a, b) => b.puan - a.puan);
  console.log('===== SIRALAMA =====');
  sonuclar.forEach((s, i) => console.log(`${i + 1}. ${s.dil}  puan=${s.puan}`));
  console.log(`\notomatik secim -> ${sonuclar[0].dil}`);

  // Farki somut goster
  if (sonuclar.length >= 2) {
    const [iyi, kotu] = sonuclar;
    const a = iyi.metin.split(/\s+/).slice(0, 25);
    const b = kotu.metin.split(/\s+/).slice(0, 25);
    console.log('\nkelime kelime fark (ilk 25):');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.log(`   ${iyi.dil}: ${JSON.stringify(a[i])}   <->   ${kotu.dil}: ${JSON.stringify(b[i])}`);
    }
  }

  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
