// DeightShot spike — uiohook-napi ile "basili tutma" tespiti
//
//   node hook.js           -> otomatik test (sentetik F13 basisi, elle mudahale gerekmez)
//   node hook.js --manual  -> 20 sn boyunca gercek tus basislerini dinler (Ins dene)

const { uIOhook, UiohookKey } = require('uiohook-napi');

const MANUAL = process.argv.includes('--manual');
const ESIK_MS = 700;              // tasarim notundaki 600-800ms araligi

// Otomatik testte yan etkisi olmayan tus (Ins overtype'i acardi).
// Manuel testte gercek hedef tus: Ins.
const TEST_KEY = MANUAL ? UiohookKey.Insert : UiohookKey.F13;

// Sure (manuel test icin): --sure 40
const sureArg = process.argv.indexOf('--sure');
const DINLEME_SN = sureArg > -1 ? parseInt(process.argv[sureArg + 1], 10) : 30;

// GIZLILIK: manuel modda SADECE test tusunu dinle.
// Boylece 88'in yazdigi hicbir sey (baska keycode dahil) loglanmaz.
function ilgiliMi(keycode) {
  return keycode === TEST_KEY;
}

const log = (...a) => console.log(...a);

// --- DeightShot'in gercek mantigi: tek akis, iki sonuc ---
const basili = new Map();   // keycode -> { t0, timer, tekrar }
const sonuclar = [];

function onKeyDown(e) {
  if (!ilgiliMi(e.keycode)) return;   // baska tuslara hic bakma

  // Windows tus basili tutulunca OTOMATIK TEKRAR keydown uretir.
  // Gercek uygulamada bunlari yok saymak sart, yoksa timer surekli sifirlanir.
  const mevcut = basili.get(e.keycode);
  if (mevcut) { mevcut.tekrar++; return; }

  const kayit = { t0: Date.now(), tekrar: 0, timer: null };
  kayit.timer = setTimeout(() => {
    kayit.tetiklendi = true;
    log(`  [${ms(kayit.t0)}] ESIK ASILDI keycode=${e.keycode} -> TAM EKRAN (halka doldu)`);
  }, ESIK_MS);

  basili.set(e.keycode, kayit);
  log(`  [0ms] keydown  keycode=${e.keycode} -> overlay ANINDA acilir (bolge secimi)`);
}

function onKeyUp(e) {
  if (!ilgiliMi(e.keycode)) return;

  const kayit = basili.get(e.keycode);
  if (!kayit) return;
  clearTimeout(kayit.timer);
  basili.delete(e.keycode);

  const sure = Date.now() - kayit.t0;
  const mod = kayit.tetiklendi ? 'TAM EKRAN' : 'BOLGE SECIMI';
  log(`  [${sure}ms] keyup    keycode=${e.keycode} -> sonuc: ${mod}   (otomatik tekrar: ${kayit.tekrar})`);

  // Otomatik testte sadece kendi test tusumuzu say — makinede gercek
  // klavye trafigi varsa sonuca karismasin.
  if (MANUAL || e.keycode === TEST_KEY) sonuclar.push({ sure, mod, tekrar: kayit.tekrar });
}

const ms = (t0) => Date.now() - t0 + 'ms';

uIOhook.on('keydown', onKeyDown);
uIOhook.on('keyup', onKeyUp);

log('== DeightShot spike : klavye hook ==');
log(`esik: ${ESIK_MS}ms`);

let hookOk = false;
try {
  uIOhook.start();
  hookOk = true;
  log('hook baslatildi: OK');
} catch (err) {
  log('hook BASLATILAMADI: ' + err.message);
  process.exit(1);
}

if (MANUAL) {
  log(`\n>>> ${DINLEME_SN} saniye DINLIYORUM — sadece Ins tusunu goruyorum, baska hicbir tus loglanmaz.`);
  log('>>> 1) Ins tusuna KISA bas ve birak');
  log('>>> 2) sonra Ins tusunu UZUN (1-2 sn) basili tut ve birak');
  log('');

  setTimeout(() => {
    uIOhook.stop();
    log('\n===== MANUEL TEST SONUCU =====');

    // Sure dolarken tus hala basiliysa bunu soyle — sessizce kaybolmasin.
    for (const [kc, k] of basili) {
      clearTimeout(k.timer);
      log(`! sure dolarken tus HALA BASILI (keycode ${kc}): ${Date.now() - k.t0}ms, ` +
          `otomatik tekrar: ${k.tekrar}, esik asildi mi: ${k.tetiklendi ? 'EVET' : 'hayir'}`);
      if (k.tetiklendi) sonuclar.push({ sure: Date.now() - k.t0, mod: 'TAM EKRAN (birakilmadi)', tekrar: k.tekrar });
    }

    if (sonuclar.length === 0) {
      log('Hic Ins basisi gorulmedi. (hook calisiyor ama tusa basilmadi)');
      process.exit(2);
    }
    sonuclar.forEach((s, i) =>
      log(`${i + 1}. basis: ${s.sure}ms -> ${s.mod}   | otomatik tekrar keydown: ${s.tekrar}`));

    const uzunlar = sonuclar.filter(s => s.tekrar > 0);
    log('');
    log('--- kritik soru: uzun basista otomatik tekrar geldi mi? ---');
    if (uzunlar.length > 0) {
      log(`EVET — Windows otomatik tekrar uretiyor (en fazla ${Math.max(...uzunlar.map(s => s.tekrar))} tekrar).`);
      log('Kodda bunlari yok sayan onlem CALISIYOR: timer sifirlanmadi, mod dogru belirlendi.');
    } else {
      log('HAYIR — bu basislarda otomatik tekrar gorulmedi.');
      log('(Ins gibi tuslarda Windows tekrar uretmiyor olabilir; onlem yine de zararsiz duruyor.)');
    }
    process.exit(0);
  }, DINLEME_SN * 1000);
} else {
  (async () => {
    const bekle = (n) => new Promise(r => setTimeout(r, n));
    await bekle(400);

    log(`\n--- test 1: KISA basis (~120ms) ---`);
    uIOhook.keyToggle(TEST_KEY, 'down');
    await bekle(120);
    uIOhook.keyToggle(TEST_KEY, 'up');
    await bekle(400);

    log(`\n--- test 2: UZUN basis (~1000ms) ---`);
    uIOhook.keyToggle(TEST_KEY, 'down');
    await bekle(1000);
    uIOhook.keyToggle(TEST_KEY, 'up');
    await bekle(400);

    uIOhook.stop();

    log('\n===== SONUC =====');
    if (sonuclar.length < 2) {
      log(`BASARISIZ — beklenen 2 olay, gelen ${sonuclar.length}.`);
      log('(sentetik tuslar hook tarafindan gorulmedi; --manual ile gercek tusla dene)');
      process.exit(2);
    }
    const [kisa, uzun] = sonuclar;
    const ok = kisa.mod === 'BOLGE SECIMI' && uzun.mod === 'TAM EKRAN';
    log(`kisa basis : ${kisa.sure}ms -> ${kisa.mod}`);
    log(`uzun basis : ${uzun.sure}ms -> ${uzun.mod}`);
    log(ok ? 'GECTI: basili tutma suresi guvenilir sekilde olculuyor.'
           : 'KALDI: mod ayrimi beklendigi gibi calismadi.');
    process.exit(ok ? 0 : 3);
  })();
}
