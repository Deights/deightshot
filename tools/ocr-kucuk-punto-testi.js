// Küçük punto / sembol testi — EKRAN GEREKTİRMEZ (ekranı pasif yakalar),
// sentetik tuş üretmez.
//
// Soru: yapıştırılan metinde kalan hatalar (\ okunmuyor, → çöp,
// l/1 ve o/0 karışıyor, % kayboluyor) büyütmeyi artırarak düzeliyor mu?
// Sabit 1.5x yerine metin yüksekliğine göre uyarlanabilir ölçek mantıklı mı?
//
//   node tools/ocr-kucuk-punto-testi.js
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const EXE = path.join(__dirname, '..', 'native', 'DeightShot.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'deightshot-native.exe');

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
    setTimeout(() => { if (bekleyen.delete(id)) rej(new Error('zaman asimi')); }, 40000);
  });
};
const bekle = (ms) => new Promise(r => setTimeout(r, ms));

const ortanca = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Sembol saglıgı: bunlar ekranda geciyorsa dogru okunmali
const SEMBOLLER = ['\\', '→', '%', '(', ')', '{', '}', ';', '+'];

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  // KAYITLI test goruntusu kullaniliyor — canli ekran yakalamiyoruz.
  // Hem icerigi bilinen sabit bir kare (olcum tekrarlanabilir olsun),
  // hem de kullanicinin o an ekraninda ne varsa ona dokunmamis oluyoruz.
  const fs = require('fs');
  const dizin = path.join(process.env.TEMP, 'deightshot', 'gorsel-test');
  const kare = {
    path: process.argv[2] ||
      path.join(dizin, fs.readdirSync(dizin).filter(f => f.startsWith('ekran0'))[0]),
  };
  console.log(`kare: ${path.basename(kare.path)}\n`);

  // Sag taraf = sohbet govdesi + kod bloklari; kucuk punto ve bol sembol.
  const bolge = { x: 850, y: 150, w: 1050, h: 560 };
  console.log(`bolge (kucuk punto govde metni): ${JSON.stringify(bolge)}\n`);

  for (const s of [1, 1.5, 2, 2.5, 3]) {
    const r = await cagir('ocr', { path: kare.path, lang: 'tr', ...bolge, scale: s });
    const kelimeler = r.lines.flatMap(l => l.words);
    const yuk = ortanca(kelimeler.map(w => w.h));
    const sembol = SEMBOLLER.filter(sm => r.text.includes(sm));
    // l/1 ve o/0 karisikligi belirtisi: rakam iceren "kelime"lerin orani
    const karisik = kelimeler.filter(w => /[a-zA-Zçğıöşü][0-9]|[0-9][a-zA-Zçğıöşü]/.test(w.text)).length;

    console.log(`${String(s).padStart(4)}x : ${String(kelimeler.length).padStart(3)} kelime  ` +
                `ortanca yukseklik ${String(yuk).padStart(4)}px  ` +
                `sembol ${sembol.length}/${SEMBOLLER.length} [${sembol.join('')}]  ` +
                `harf-rakam karisik ${karisik}  ${r.ms}ms`);
  }

  console.log('\n--- ornek metin (1.5x vs en yuksek) ---');
  const a = await cagir('ocr', { path: kare.path, lang: 'tr', ...bolge, scale: 1.5 });
  const b = await cagir('ocr', { path: kare.path, lang: 'tr', ...bolge, scale: 3 });
  console.log('1.5x:', JSON.stringify(a.text.slice(0, 220)));
  console.log();
  console.log('  3x:', JSON.stringify(b.text.slice(0, 220)));

  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
