// shot88 overlay'ini gerçek tuşlarla tetikle, ekranı yakala, sonra kapat.
// Amaç: araç çubuğunu gözle doğrulamak.
//
// Uygulama SHOT88_NOPROTECT=1 ile başlatılmış olmalı — yoksa overlay
// yakalamaya görünmez ve boş masaüstü çekeriz.
//
//   node tools/gorsel-test.js
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const EXE = path.join(__dirname, '..', 'native', 'Shot88.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'shot88-native.exe');
const CIKTI = path.join(process.env.TEMP, 'shot88', 'gorsel-test');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Yakalama icin AYRI bir native ornegi (shot88'in kendi surecinden bagimsiz)
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
    setTimeout(() => { if (bekleyen.delete(id)) rej(new Error(cmd + ' zaman asimi')); }, 20000);
  });
}

const bas = async (tus, sure = 80) => {
  uIOhook.keyToggle(tus, 'down');
  await bekle(sure);
  uIOhook.keyToggle(tus, 'up');
};

(async () => {
  uIOhook.start();
  for (let i = 0; i < 60 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('yakalayici hazir olmadi');
  console.log('yakalayici hazir');

  console.log('Ins (kisa) -> overlay acilmali');
  await bas(UiohookKey.Insert, 140);
  await bekle(1300);      // donmus kare yerlessin

  console.log('Ctrl+A -> tum ekran secimi, arac cubuklari cikmali');
  uIOhook.keyToggle(UiohookKey.Ctrl, 'down');
  await bas(UiohookKey.A, 70);
  uIOhook.keyToggle(UiohookKey.Ctrl, 'up');
  await bekle(700);

  const r = await cagir('capture-all', { dir: CIKTI });
  console.log('YAKALANDI:', r.frames.map((f) => f.path).join('\n           '));

  console.log('temizlik: Esc x2');
  await bas(UiohookKey.Escape, 60);
  await bekle(250);
  await bas(UiohookKey.Escape, 60);

  await bekle(400);
  uIOhook.stop();
  proc.stdin.end();
  setTimeout(() => process.exit(0), 400);
})().catch((e) => {
  console.error('HATA:', e.message);
  try { uIOhook.stop(); } catch {}
  try { proc.kill(); } catch {}
  process.exit(1);
});
