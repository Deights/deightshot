// Çeviri ayarları penceresini açar, İÇİNİ çeker, kapatır.
// Masaüstünü yakalamaz, sentetik tuş üretmez.
//
//   npx electron tools/ayarlar-onizleme.js
//
// shot88'in tamamını başlatmadan sadece pencereyi kurar; modül çağrıları için
// `modul:cagir` kanalını gerçek ceviri modülüne bağlar.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const KOK = path.join(__dirname, '..');
const CIKTI = path.join(process.env.TEMP, 'shot88', 'ayarlar-onizleme');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// --- sahte çekirdek: gerçek ceviri modülünü Electron'un tamamı olmadan koş ---
const ayarlar = { ...require('../src/main/settings').VARSAYILAN };
const komutlar = new Map();
const ctx = {
  native: { cagir: async () => { throw new Error('native yok (önizleme)'); } },
  on: () => {}, overlaya: () => {}, kare: () => null,
  komut: (ad, fn) => komutlar.set(ad, fn),
  ayarlar: { get: () => ayarlar, set: (p) => Object.assign(ayarlar, p) },
  log: (...a) => console.log('   [ceviri]', ...a),
};
require('../modules/ceviri/main').init(ctx);

ipcMain.handle('modul:cagir', async (_e, { komut, veri }) => {
  const fn = komutlar.get(komut);
  if (!fn) return { ok: false, error: 'bilinmeyen komut: ' + komut };
  try { return { ok: true, data: await fn(veri || {}) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.on('ayarlar:kapat', () => {});

// Kısayol bölümü gerçek IPC'ye bağlı — pencerenin kendi init'ini çalıştır,
// yoksa önizleme "handler yok" hatası verip o bölümü boş gösterir.
require('../src/main/settings').init();
require('../src/main/ayarlar-penceresi').init();

async function cek(p, ad) {
  // Gizli pencerede capturePage bir önceki kareyi döndürebiliyor — iki kez al.
  await p.capturePage();
  await bekle(150);
  const g = await p.capturePage();
  fs.writeFileSync(path.join(CIKTI, ad + '.png'), g.toPNG());
  console.log('yazildi:', path.join(CIKTI, ad + '.png'));
}

app.whenReady().then(async () => {
  fs.mkdirSync(CIKTI, { recursive: true });

  const p = new BrowserWindow({
    width: 620, height: 760, useContentSize: true, show: false,
    backgroundColor: '#141417',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(KOK, 'src', 'preload', 'ayarlar-preload.js'),
    },
  });

  p.webContents.on('console-message', (_e, seviye, mesaj) => {
    if (seviye >= 2) console.log('   [renderer]', mesaj);
  });

  await p.loadFile(path.join(KOK, 'src', 'ui', 'ayarlar', 'ayarlar.html'));
  await bekle(1200);                    // Ollama sorgusu dönsün
  await cek(p, 'kapali');

  // Uzak motor açık hali — asıl bakılacak durum.
  await p.webContents.executeJavaScript(
    `document.getElementById('uzakAcik').click()`);
  await bekle(400);
  await cek(p, 'acik');

  // Alt kısmı da gör — pencere kısa olduğu için kaydırma gerekiyor.
  await p.setContentSize(620, 1180);
  await bekle(300);
  await cek(p, 'tamamı');

  app.quit();
});
