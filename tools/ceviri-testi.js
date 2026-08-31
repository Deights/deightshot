// Çeviri/açıklama motoru testi — EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
// Modülü Electron'suz, doğrudan çalıştırır.
//
//   node tools/ceviri-testi.js
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// --- sahte ctx: modül Electron'a bağımlı olmasın diye ---
const EXE = path.join(__dirname, '..', 'native', 'Shot88.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'shot88-native.exe');

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
const nativeCagir = (cmd, args, zaman) => {
  const i = id++;
  proc.stdin.write(JSON.stringify({ id: i, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bek.set(i, { res, rej });
    setTimeout(() => { if (bek.delete(i)) rej(new Error('zaman asimi')); }, zaman || 15000);
  });
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const ayarlar = { ceviriModel: '', ceviriBellekteKalsin: '5m' };
const komutlar = new Map();
const ctx = {
  native: { cagir: nativeCagir, calisiyorMu: () => true },
  on: () => {},
  komut: (ad, fn) => komutlar.set(ad, fn),
  overlaya: () => {},
  kare: () => null,
  ayarlar: { get: () => ayarlar, set: (p) => Object.assign(ayarlar, p) },
  log: (...a) => console.log('   [ceviri]', ...a),
};

// --- test metinleri ---
const ORNEKLER = [
  {
    baslik: 'Oyun ayar menüsü (gerçek kullanım senaryosu)',
    metin: 'Motion Blur\nAmbient Occlusion: SSAO\nV-Sync: Off\nField of View: 90',
    islem: 'acikla',
  },
  {
    baslik: 'Oyun içi diyalog',
    metin: 'You should have known better than to trust him. The Arasaka deal was never going to work out.',
    islem: 'cevir',
  },
  {
    baslik: 'Hata mesajı',
    metin: 'The remote certificate is invalid according to the validation procedure.',
    islem: 'cevir',
  },
  {
    baslik: 'HALÜSİNASYON TESTİ — model uydurmamalı',
    metin: '> Kill him\n> Let him go\n> Say nothing',
    islem: 'acikla',
  },
];

(async () => {
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  require('../modules/ceviri/main').init(ctx);

  console.log('=== motor durumu ===');
  const d = await komutlar.get('durum')({});
  if (!d.hazir) { console.log('HAZIR DEGIL:', d.sebep); process.exit(1); }
  console.log(`kurulu ${d.modeller.length} model, secilen: ${d.secili}`);
  d.modeller.slice(0, 4).forEach((m) => console.log(`   ${m.puan >= 0 ? '+' : ' '}${m.puan}  ${m.ad}  (${m.boyutGb} GB)`));

  for (const o of ORNEKLER) {
    console.log(`\n########## ${o.baslik}  [${o.islem}] ##########`);
    console.log('girdi :', JSON.stringify(o.metin.slice(0, 90)));
    try {
      const r = await komutlar.get(o.islem)({ metin: o.metin });
      console.log(`motor : ${r.cihaz} · ${r.model} · ${(r.ms / 1000).toFixed(1)} sn  [${r.gerekce}]`);
      console.log('cikti :');
      console.log(r.metin.split('\n').map((s) => '   ' + s).join('\n'));
    } catch (e) {
      console.log('HATA:', e.message);
    }
  }

  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch((e) => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
