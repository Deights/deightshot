// Global kısayol — iki motor, biri tercih edilen:
//
//   1) NATIVE hook (C# / WH_KEYBOARD_LL)  <- tercih edilen
//      Tuşu YUTABİLİYOR: Ins'e basınca editörde OVR modu açılmıyor.
//   2) uiohook-napi                        <- yedek
//      Yutamıyor (kütüphanede bastırma API'si yok), ama native yoksa
//      kısayol hiç çalışmasın diye burada duruyor.
//
// ⚠️ ÖLÇÜLMÜŞ TUZAK:
// Windows tuş basılı tutulunca ~43ms'de bir otomatik tekrar keydown gönderiyor
// (2 saniyede 49 tane). Her keydown'da sayacı sıfırlayan naif kod yazılırsa
// eşik hiç dolmaz ve "basılı tut = tam ekran" sessizce hiç çalışmaz.
// Native tarafta korumalı (Hotkey.cs), uiohook tarafında aşağıdaki Map koruyor.
const state = require('./state');
const settings = require('./settings');
const native = require('./native');

// uiohook keycode -> Windows sanal tuş kodu.
// Liste artık tuslar.js'te — ayar penceresi de aynı kaynağı kullanıyor,
// iki yerde ayrı tablo tutulup biri unutulmasın.
const VK = require('./tuslar').vkTablosu();

let motor = null;         // 'native' | 'uiohook' | null
let uIOhook = null;
let esikTimer = null;
let basimT0 = 0;

// --- ortak: basma/bırakma -> çekirdek olayları ---

function basildi() {
  console.log(`[kısayol] BASILDI (motor: ${motor})`);
  clearTimeout(esikTimer);
  basimT0 = Date.now();
  esikTimer = setTimeout(() => {
    state.events.emit('esik-asildi');
  }, settings.get().basiliTutmaMs);
  state.events.emit('kisayol-basildi');
}

function birakildi(bilgi) {
  clearTimeout(esikTimer);
  esikTimer = null;
  state.events.emit('kisayol-birakildi', {
    sure: (bilgi && bilgi.heldMs) || Date.now() - basimT0,
    tekrar: (bilgi && bilgi.repeats) || 0,
  });
}

// --- 1) native hook ---

async function nativeDene() {
  if (!native.calisiyorMu()) return false;

  const s = settings.get();
  const vk = VK[s.kisayolKeycode];
  if (!vk) {
    console.warn(`[kısayol] keycode ${s.kisayolKeycode} için sanal tuş eşlemesi yok, uiohook'a düşülüyor`);
    return false;
  }

  try {
    const r = await native.cagir('hotkey-start', { vk, swallow: s.tusuYut !== false });
    native.olaylar.on('hotkey', (m) => {
      if (m.state === 'down') basildi();
      else if (m.state === 'up') birakildi(m);
    });
    motor = 'native';
    console.log(`[kısayol] native hook: ${s.kisayolAd} (vk 0x${vk.toString(16)}), ` +
                `yutma=${r.swallow ? 'AÇIK — tuş başka uygulamaya gitmez' : 'kapalı'}, eşik ${s.basiliTutmaMs}ms`);
    return true;
  } catch (e) {
    console.error('[kısayol] native hook kurulamadı:', e.message);
    return false;
  }
}

// --- 2) uiohook yedeği ---

const basili = new Map();

function uiohookDene() {
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (e) {
    console.error('[kısayol] uiohook-napi yüklenemedi:', e.message);
    return false;
  }

  uIOhook.on('keydown', (e) => {
    if (e.keycode !== settings.get().kisayolKeycode) return;
    if (basili.has(e.keycode)) { basili.get(e.keycode).tekrar++; return; }  // otomatik tekrar
    basili.set(e.keycode, { tekrar: 0 });
    basildi();
  });

  uIOhook.on('keyup', (e) => {
    if (e.keycode !== settings.get().kisayolKeycode) return;
    const k = basili.get(e.keycode);
    if (!k) return;
    basili.delete(e.keycode);
    birakildi({ repeats: k.tekrar });
  });

  try {
    uIOhook.start();
    motor = 'uiohook';
    console.warn('[kısayol] uiohook yedeği kullanılıyor — tuş YUTULAMIYOR, ' +
                 'editörde OVR modu açılabilir');
    return true;
  } catch (e) {
    console.error('[kısayol] uiohook başlatılamadı:', e.message);
    return false;
  }
}

async function init() {
  if (await nativeDene()) return true;
  return uiohookDene();
}

async function durdur() {
  clearTimeout(esikTimer);
  basili.clear();
  if (motor === 'native') {
    native.olaylar.removeAllListeners('hotkey');
    await native.cagir('hotkey-stop', {}, 2000).catch(() => {});
  } else if (motor === 'uiohook' && uIOhook) {
    try { uIOhook.stop(); } catch {}
  }
  motor = null;
}

const aktifMotor = () => motor;

module.exports = { init, durdur, aktifMotor };
