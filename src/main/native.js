// deightshot-native köprüsü — C# yardımcı sürecini başlatır, satır-JSON ile konuşur.
//
// Neden ayrı süreç: WGC ve Windows.Media.Ocr C#'ta birinci sınıf. Ayrıca OCR
// ayrı süreçte olunca Electron'un UI iş parçacığı hiç kilitlenmiyor.
const { spawn } = require('child_process');
const readline = require('readline');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

/** Native'den gelen olaylar: 'ready', 'hotkey' */
const olaylar = new EventEmitter();

const KOK = path.join(__dirname, '..', '..');
const TFM = 'net10.0-windows10.0.22621.0';

// Geliştirmede bin/Release, paketlendiğinde resources/native altında aranır.
const ADAYLAR = [
  path.join(KOK, 'native', 'DeightShot.Native', 'bin', 'Release', TFM, 'deightshot-native.exe'),
  path.join(KOK, 'native', 'DeightShot.Native', 'bin', 'Debug', TFM, 'deightshot-native.exe'),
  path.join(process.resourcesPath || KOK, 'native', 'deightshot-native.exe'),
];

let proc = null;
let rl = null;
let sonrakiId = 1;
const bekleyen = new Map();
let hazirCozucu = null;
const hazirSozu = new Promise((r) => { hazirCozucu = r; });

function exeYolu() {
  for (const p of ADAYLAR) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function baslat() {
  const exe = exeYolu();
  if (!exe) {
    console.error('[native] deightshot-native.exe bulunamadı. Önce derle:');
    console.error('[native]   npm run native:build');
    return false;
  }

  proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  rl = readline.createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('[native] JSON ayrıştırılamadı:', line.slice(0, 200));
      return;
    }

    if (msg.evt) {
      if (msg.evt === 'ready') {
        console.log(`[native] hazır (pid ${msg.pid}, v${msg.version})`);
        hazirCozucu(true);
      }
      olaylar.emit(msg.evt, msg);
      return;
    }

    const p = bekleyen.get(msg.id);
    if (!p) return;
    bekleyen.delete(msg.id);
    clearTimeout(p.zamanlayici);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || 'bilinmeyen native hatası'));
  });

  // Native'in logları stderr'den gelir — stdout protokol için ayrılmıştır.
  proc.stderr.on('data', (d) => {
    /* ⚠️ process.stderr borusu KOPUK olabilir. Uygulama konsolsuz
       baslatildiginda, ya da baslatan surec kapandiginda, bu write
       EPIPE firlatir; yakalanmadigi icin Electron "A JavaScript error
       occurred in the main process" penceresini acar ve uygulama
       kullanilamaz hale gelir. 31 Agu 2026'da yasandi: uygulama
       baska bir surecten baslatildi, o surec kapandi, log yazilamadi
       ve uygulama komple durdu.
       Log yazamamak uygulamayi durdurmamali. */
    try { process.stderr.write(d.toString()); } catch { /* log yazilamadi */ }
  });

  proc.on('exit', (code) => {
    console.error(`[native] süreç kapandı (kod ${code})`);
    for (const [, p] of bekleyen) p.reject(new Error('native süreci kapandı'));
    bekleyen.clear();
    proc = null;
  });

  return true;
}

function cagir(cmd, args, zamanAsimiMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!proc) return reject(new Error('native süreci çalışmıyor'));
    const id = sonrakiId++;
    const zamanlayici = setTimeout(() => {
      bekleyen.delete(id);
      reject(new Error(`native '${cmd}' zaman aşımı (${zamanAsimiMs}ms)`));
    }, zamanAsimiMs);
    bekleyen.set(id, { resolve, reject, zamanlayici });
    proc.stdin.write(JSON.stringify({ id, cmd, args: args || {} }) + '\n');
  });
}

function durdur() {
  if (proc) {
    try { proc.stdin.end(); } catch {}
    setTimeout(() => { try { proc && proc.kill(); } catch {} }, 500);
  }
}

const calisiyorMu = () => proc !== null;

module.exports = { baslat, cagir, durdur, hazirSozu, calisiyorMu, exeYolu, olaylar };
