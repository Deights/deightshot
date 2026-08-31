// Kaynak ölçümü testi — ekran gerektirmez, sentetik tuş üretmez.
// Çeviri motorunun nerede çalışacağına karar verecek ölçümleri gösterir.
//
//   node tools/kaynak-testi.js [tekrar]
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const EXE = path.join(__dirname, '..', 'native', 'Shot88.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'shot88-native.exe');

const TEKRAR = Number(process.argv[2] || 4);

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

const cagir = (cmd, args) => {
  const i = id++;
  proc.stdin.write(JSON.stringify({ id: i, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bek.set(i, { res, rej });
    setTimeout(() => { if (bek.delete(i)) rej(new Error('zaman asimi')); }, 15000);
  });
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Karar politikası — "oyun var mı" değil, "şu an neresi boş".
 * Rekabetçi oyunlar CPU'ya yüklenir ve GPU'yu boş bırakır; orada GPU doğru
 * seçimdir. Cyberpunk gibi oyunlarda tam tersi.
 */
function karar(r) {
  const vramYeter = r.vramAlinabilirMb >= 3000;   // 4B int4 model ~2.5 GB + pay
  const cpuMusait = r.cpuYuzde < 55;
  const ramYeter = r.ramBosMb >= 4000;

  if (vramYeter) return { motor: 'GPU', tahmin: '~1 sn', gerekce: `${r.vramAlinabilirMb} MB alınabilir VRAM` };
  if (cpuMusait && ramYeter) return { motor: 'CPU', tahmin: '5-10 sn', gerekce: `VRAM dar (${r.vramAlinabilirMb} MB), CPU müsait (%${r.cpuYuzde})` };
  if (ramYeter) return { motor: 'CPU (düşük öncelik)', tahmin: '10-20 sn', gerekce: 'hem VRAM hem CPU sıkışık' };
  return { motor: 'API / küçük model', tahmin: '~300 ms', gerekce: 'yerel kaynak yok' };
}

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  for (let n = 0; n < TEKRAR; n++) {
    const r = await cagir('resources');
    const k = karar(r);
    console.log(
      `VRAM kart ${r.vramToplamMb} MB · bütçemiz ${String(r.vramButceMb).padStart(4)} · ` +
      `kendi kullanımımız ${String(r.vramSurecKullanimMb).padStart(4)} · ` +
      `ALINABİLİR ${String(r.vramAlinabilirMb).padStart(4)} MB`);
    console.log(
      `   CPU %${String(r.cpuYuzde).padStart(5)} (${r.cekirdekSayisi}ç)  |  ` +
      `RAM boş ${String(r.ramBosMb).padStart(5)} MB  |  ` +
      `tam ekran: ${r.tamEkranUygulamaVar ? 'EVET' : 'hayır'} (${r.onPlanUygulama})`);
    if (r.vramHatasi) console.log(`   !! VRAM okunamadı: ${r.vramHatasi}`);
    console.log(`   -> karar: ${k.motor}  ${k.tahmin}   [${k.gerekce}]`);
    if (n < TEKRAR - 1) await bekle(1000);
  }

  proc.stdin.end();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
