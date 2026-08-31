// OCR ön işleme (büyütme) testi — EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
//
// Soru: Tasarım notundaki "OCR'dan önce 2x büyüt" önerisi gerçekten
// kaliteyi artırıyor mu, yoksa sadece yavaşlatıyor mu?
//
//   node tools/ocr-olcek-testi.js [png]
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const EXE = path.join(__dirname, '..', 'native', 'Shot88.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'shot88-native.exe');
const dizin = path.join(process.env.TEMP, 'shot88', 'gorsel-test');
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
    setTimeout(() => { if (bekleyen.delete(id)) rej(new Error('zaman asimi')); }, 30000);
  });
};
const bekle = (ms) => new Promise(r => setTimeout(r, ms));

// Ekranda GERCEKTEN yazan, dogrulugunu bildigimiz kelimeler.
// Kac tanesini dogru okuyabildigine bakacagiz — puan degil, gercek isabet.
//
// ⚠️ BU LISTE MAKINEYE OZELDIR. Test, o an ekranda ne varsa onu yakalayip
//    burada yazan kelimeleri ariyor. Baska bir ekranda calistirirsan once
//    bu listeyi KENDI ekranindaki metne gore guncelle — yoksa test
//    "0 isabet" der ve OCR bozuk sanirsin. Hatanin sebebi OCR degil, liste.
//
//    Asagidakiler bu deponun kendi dosya/klasor adlari: hangi ekranda
//    olursan ol projeyi acmissan gorunurler, o yuzden notr baslangic.
const BEKLENEN = [
  'shot88', 'assets', 'modules', 'native', 'spike', 'tools',
  'package.json', 'main.js', 'src', 'README',
];

function isabet(metin) {
  const d = metin.replace(/\s+/g, ' ');
  const bulunan = BEKLENEN.filter(b => d.includes(b));
  return { adet: bulunan.length, toplam: BEKLENEN.length, kacirilan: BEKLENEN.filter(b => !d.includes(b)) };
}

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');
  console.log('goruntu:', path.basename(PNG));
  console.log('olcut: ekranda oldugunu bildigimiz', BEKLENEN.length, 'ifadeden kaci dogru okundu\n');

  const bolge = { x: 0, y: 0, w: 1000, h: 700 };

  for (const dil of ['en-US', 'tr']) {
    console.log(`########## ${dil} ##########`);
    for (const s of [1, 1.5, 2, 3]) {
      const r = await cagir('ocr', { path: PNG, lang: dil, ...bolge, scale: s });
      const i = isabet(r.text);
      const kelime = r.lines.reduce((a, l) => a + l.words.length, 0);
      console.log(`  ${s}x : ${String(i.adet).padStart(2)}/${i.toplam} dogru  |  ${kelime} kelime  |  ${r.ms} ms`);
      if (s === 2) console.log(`        kacirilan: ${i.kacirilan.join(', ') || '(yok)'}`);
    }
    console.log();
  }

  // Koordinatlarin buyutmeden sonra da dogru donduguna bak
  console.log('=== koordinat tutarliligi (buyutme sonrasi geri olcekleme) ===');
  const a1 = await cagir('ocr', { path: PNG, lang: 'en-US', ...bolge, scale: 1 });
  const a2 = await cagir('ocr', { path: PNG, lang: 'en-US', ...bolge, scale: 2 });
  const k1 = a1.lines.flatMap(l => l.words).find(w => w.text === 'Explorer');
  const k2 = a2.lines.flatMap(l => l.words).find(w => w.text === 'Explorer');
  if (k1 && k2) {
    const dx = Math.abs(k1.x - k2.x), dy = Math.abs(k1.y - k2.y);
    console.log(`  "Explorer"  1x: x=${k1.x.toFixed(1)} y=${k1.y.toFixed(1)}   2x: x=${k2.x.toFixed(1)} y=${k2.y.toFixed(1)}`);
    console.log(`  sapma: ${dx.toFixed(1)}px / ${dy.toFixed(1)}px  -> ${(dx < 4 && dy < 4) ? 'TUTARLI' : 'KAYMA VAR!'}`);
  } else {
    console.log('  karsilastirma yapilamadi (kelime bulunamadi)');
  }

  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch(e => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
