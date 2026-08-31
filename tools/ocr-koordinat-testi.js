// OCR koordinat sistemi testi — EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
// Oyun oynanırken bile güvenle çalışır.
//
// Doğruladığı şey: native 'ocr' komutuna x/y/w/h verilince dönen kelime
// koordinatları KIRPILAN bölgeye mi göreli, yoksa tam görsele mi?
// modules/metin-secme/main.js kırpma-göreli varsayıyor; yanlışsa kelime
// kutuları tamamen kayar.
//
//   node tools/ocr-koordinat-testi.js [png-yolu]
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const EXE = path.join(__dirname, '..', 'native', 'DeightShot.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'deightshot-native.exe');

const PNG = process.argv[2] ||
  path.join(process.env.TEMP, 'deightshot', 'gorsel-test', fs.readdirSync(
    path.join(process.env.TEMP, 'deightshot', 'gorsel-test')).filter(f => f.startsWith('ekran0'))[0]);

if (!fs.existsSync(PNG)) { console.error('PNG bulunamadi:', PNG); process.exit(1); }
console.log('test goruntusu:', PNG);

const proc = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = readline.createInterface({ input: proc.stdout });
let nextId = 1;
const bekleyen = new Map();
let hazir = false;

rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.evt === 'ready') { hazir = true; return; }
  if (m.evt) return;
  const p = bekleyen.get(m.id);
  if (p) { bekleyen.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); }
});
proc.stderr.on('data', () => {});

function cagir(cmd, args) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bekleyen.set(id, { resolve: res, reject: rej });
    setTimeout(() => { if (bekleyen.delete(id)) rej(new Error(cmd + ' zaman asimi')); }, 25000);
  });
}
const bekle = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  // 1) Tam goruntu
  const tam = await cagir('ocr', { path: PNG, lang: 'en-US' });
  const tamKelime = tam.lines.flatMap(l => l.words);
  console.log(`\nTAM GORUNTU : ${tam.lines.length} satir, ${tamKelime.length} kelime, ${tam.ms} ms`);

  // Sag yarida, asagida bir kelime sec (kirpma farkinin belli olmasi icin)
  const aday = tamKelime
    .filter(w => w.x > 700 && w.y > 300 && w.text.length >= 4)
    .sort((a, b) => b.y - a.y)[0] || tamKelime[tamKelime.length - 1];

  console.log(`secilen kelime: "${aday.text}" tam goruntude x=${Math.round(aday.x)} y=${Math.round(aday.y)}`);

  // 2) O kelimeyi iceren bir bolgeyi kirp
  const kx = Math.max(0, Math.round(aday.x - 60));
  const ky = Math.max(0, Math.round(aday.y - 40));
  const kw = 500, kh = 220;
  console.log(`kirpma bolgesi : x=${kx} y=${ky} w=${kw} h=${kh}`);

  const kirp = await cagir('ocr', { path: PNG, lang: 'en-US', x: kx, y: ky, w: kw, h: kh });
  const kirpKelime = kirp.lines.flatMap(l => l.words);
  console.log(`KIRPILMIS   : ${kirp.lines.length} satir, ${kirpKelime.length} kelime, ${kirp.ms} ms`);

  const esles = kirpKelime.find(w => w.text === aday.text);
  if (!esles) {
    console.log('\n!! Ayni kelime kirpilmis sonucta bulunamadi — bolgeyi kaydirmayi dene.');
    console.log('   kirpilmis ilk kelimeler:', kirpKelime.slice(0, 8).map(w => w.text).join(' | '));
  } else {
    const kirpmaGoreliX = Math.round(esles.x);
    const beklenenKirpmaGoreli = Math.round(aday.x - kx);
    const beklenenMutlak = Math.round(aday.x);

    console.log(`\nayni kelime kirpilmista: x=${kirpmaGoreliX} y=${Math.round(esles.y)}`);
    console.log(`  kirpma-goreli olsaydi  -> x ~ ${beklenenKirpmaGoreli}`);
    console.log(`  mutlak olsaydi         -> x ~ ${beklenenMutlak}`);

    const goreliFark = Math.abs(kirpmaGoreliX - beklenenKirpmaGoreli);
    const mutlakFark = Math.abs(kirpmaGoreliX - beklenenMutlak);

    console.log('\n===== SONUC =====');
    if (goreliFark < mutlakFark) {
      console.log(`KIRPMA-GORELI (sapma ${goreliFark}px)`);
      console.log('-> modules/metin-secme/main.js varsayimi DOGRU:  x = secim.x + w.x / olcek');
    } else {
      console.log(`MUTLAK / TAM GORUNTU GORELI (sapma ${mutlakFark}px)`);
      console.log('!! modules/metin-secme/main.js YANLIS — offset eklenmemeli: x = w.x / olcek');
    }
  }

  // 3) Hiz kiyasi — tasarim notundaki "bolge OCR'i cok daha hizli" iddiasi
  console.log(`\nhiz: tam ${tam.ms} ms  vs  bolge ${kirp.ms} ms`);

  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
