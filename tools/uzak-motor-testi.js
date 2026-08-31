// Uzak motor testi — DeepL ve OpenAI-uyumlu API ucu.
// EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
//
//   node tools/uzak-motor-testi.js                 (sadece anahtarsız kontroller)
//   node tools/uzak-motor-testi.js --deepl <ANAHTAR>
//   node tools/uzak-motor-testi.js --api <URL> <ANAHTAR> <MODEL>
//
// 🔴 Anahtar verilmezse HİÇBİR AĞ İSTEĞİ YAPILMAZ. Anahtar verilirse örnek
// metin gerçekten dışarı gider — bilerek çalıştır.

const deepl = require('../modules/ceviri/motorlar/deepl');
const api = require('../modules/ceviri/motorlar/api');
const ollamaMotor = require('../modules/ceviri/motorlar/ollama');
const { satirCeviriMesajlari } = require('../modules/ceviri/promptlar');

const argv = process.argv.slice(2);
const al = (bayrak, n) => {
  const i = argv.indexOf(bayrak);
  return i === -1 ? null : argv.slice(i + 1, i + 1 + n);
};

let gecti = 0, kaldi = 0;
const esit = (ad, bulunan, beklenen) => {
  const a = JSON.stringify(bulunan), b = JSON.stringify(beklenen);
  if (a === b) { gecti++; console.log(`  ✓ ${ad}`); }
  else { kaldi++; console.log(`  ✗ ${ad}\n      beklenen: ${b}\n      bulunan : ${a}`); }
};

const SATIRLAR = [
  'You should have known better than to trust him.',
  'The Arasaka deal was never going to work out.',
  'Get out of here before they find you.',
  'Motion Blur',
];

(async () => {
  console.log('=== 1) ağ gerektirmeyen kontroller ===');

  // Adres tamamlama — kullanıcı ucu eksik yapıştırırsa çalışsın.
  esit('api ucu tamamlanıyor',
    api.ucDuzelt('https://api.groq.com/openai/v1'),
    'https://api.groq.com/openai/v1/chat/completions');
  esit('şema yoksa https eklenir',
    api.ucDuzelt('api.groq.com/openai/v1'),
    'https://api.groq.com/openai/v1/chat/completions');
  esit('tam adres olduğu gibi kalır',
    api.ucDuzelt('https://x.dev/v1/chat/completions'),
    'https://x.dev/v1/chat/completions');
  esit('sondaki eğik çizgi sorun değil',
    api.ucDuzelt('https://x.dev/v1/'),
    'https://x.dev/v1/chat/completions');
  esit('boş adres boş kalır', api.ucDuzelt(''), '');

  // 🔴 GİZLİLİK: yapılandırılmamışken hazır DEMEMELİ.
  esit('anahtarsız api hazır değil',
    (await api.hazirMi({})).hazir, false);
  esit('anahtarsız deepl hazır değil',
    (await deepl.hazirMi({})).hazir, false);
  esit('url var anahtar yoksa hazır değil',
    (await api.hazirMi({ apiUrl: 'https://x.dev/v1' })).hazir, false);
  esit('model yoksa hazır değil',
    (await api.hazirMi({ apiUrl: 'https://x.dev/v1', apiAnahtar: 'k' })).hazir, false);
  esit('hepsi varsa hazır',
    (await api.hazirMi({ apiUrl: 'https://x.dev/v1', apiAnahtar: 'k', apiModel: 'm' })).hazir, true);

  // 🔴 GİZLİLİK YÖNLENDİRMESİ — metin ne zaman dışarı çıkıyor.
  // Bu testin geçmesi "sıfır telemetri" sözünün tek somut güvencesi.
  console.log('\n--- yönlendirme (metin dışarı çıkıyor mu) ---');
  const ceviri = require('../modules/ceviri/main');

  async function hangiMotor(ayarUstu, gpuBos, islem = 'cevir', oyunVar = false, yerelYok = false) {
    const ayarlar = {
      ceviriModel: 'sahte:8b', ceviriBellekteKalsin: '5m',
      uzakAcik: false, uzakNeZaman: 'oyunda',
      deeplAnahtar: '', apiUrl: '', apiAnahtar: '', apiModel: '',
      ...ayarUstu,
    };
    const komutlar = new Map();
    ceviri.init({
      // Kaynak ölçümünü taklit et: gpuBos ise bol VRAM, değilse dar.
      // ⚠️ Sayılar tartışmasız olmalı: 7000 MB kullanılınca test Ollama'nın
      // AÇIK olup olmamasına bağlı hale geliyordu (kapalıyken model boyutu
      // varsayılana düşüp eşiği aşıyor). 20 GB her modelden büyük.
      native: { cagir: async () => ({
        vramAlinabilirMb: gpuBos ? 20000 : 100, cpuYuzde: 20,
        tamEkranUygulamaVar: !gpuBos, onPlanUygulama: gpuBos ? '' : 'Oyun.exe',
      }) },
      on: () => {}, overlaya: () => {}, kare: () => null,
      oyunDurumu: () => ({ acik: oyunVar, ad: oyunVar ? 'Oyun.exe' : '' }),
      komut: (ad, fn) => komutlar.set(ad, fn),
      ayarlar: { get: () => ayarlar, set: (p) => Object.assign(ayarlar, p) },
      log: () => {},
    });
    // Yerel motoru "kapalı" gösterebilmek için hazirMi geçici olarak sarılıyor.
    // Ölçüldü: Ollama kapalıyken uzak motor açık olmasına rağmen
    // "Ollama çalışmıyor" hatası alıyordu.
    const gercekHazirMi = ollamaMotor.hazirMi;
    if (yerelYok) {
      ollamaMotor.hazirMi = async () => ({ hazir: false, sebep: 'Ollama çalışmıyor (test)' });
    }
    try {
      const p = await komutlar.get('plan')({ islem });
      return p.uzak ? p.motor : 'yerel';
    } catch {
      return 'yerel';        // hata = dışarı çıkmadı
    } finally {
      ollamaMotor.hazirMi = gercekHazirMi;
    }
  }

  const D = { deeplAnahtar: 'x:fx' };
  const A = { apiUrl: 'https://x.dev/v1', apiAnahtar: 'k', apiModel: 'm' };

  esit('kapalı + GPU boş        -> yerel',
    await hangiMotor({ ...D, ...A }, true), 'yerel');
  esit('kapalı + GPU dolu       -> yerel (anahtarlar dolu olsa bile)',
    await hangiMotor({ ...D, ...A }, false), 'yerel');
  esit('açık/oyunda + GPU boş   -> yerel',
    await hangiMotor({ uzakAcik: true, ...D, ...A }, true), 'yerel');
  esit('açık/oyunda + GPU dolu  -> deepl',
    await hangiMotor({ uzakAcik: true, ...D, ...A }, false), 'deepl');
  esit('açık/hep + GPU boş      -> deepl',
    await hangiMotor({ uzakAcik: true, uzakNeZaman: 'hep', ...D, ...A }, true), 'deepl');
  esit('açıkla + deepl var      -> api (deepl açıklayamaz)',
    await hangiMotor({ uzakAcik: true, uzakNeZaman: 'hep', ...D, ...A }, true, 'acikla'), 'api');
  esit('açık ama anahtar yok    -> yerel',
    await hangiMotor({ uzakAcik: true, uzakNeZaman: 'hep' }, false), 'yerel');
  esit('açık + sadece api       -> api',
    await hangiMotor({ uzakAcik: true, uzakNeZaman: 'hep', ...A }, false), 'api');

  // 🔴 Oyunda ölçülen hata: VRAM "yetiyor" göründü, yerelde kaldı,
  // çeviri ~20 sn sürdü. Oyun ön plandaysa uzak motor DEVREYE GİRMELİ.
  esit('açık/oyunda + OYUN VAR + GPU bol -> api  (regresyon)',
    await hangiMotor({ uzakAcik: true, ...A }, true, 'cevir', true), 'api');
  esit('kapalı + OYUN VAR -> yerel (izin yoksa yine çıkmaz)',
    await hangiMotor({ ...A }, true, 'cevir', true), 'yerel');

  // 🔴 Ölçüldü: Ollama kapalı, uzak motor AÇIK ve çalışır durumda,
  // ama "sadece oyunda" ayarı yüzünden "Ollama çalışmıyor" hatası alıyordu.
  // "Yereli tercih et" demek, yerel ÖLÜYKEN de bekle demek değil.
  esit('açık/oyunda + YEREL YOK -> api  (regresyon)',
    await hangiMotor({ uzakAcik: true, ...A }, true, 'cevir', false, true), 'api');
  esit('açık/oyunda + YEREL YOK + deepl -> deepl',
    await hangiMotor({ uzakAcik: true, ...D, ...A }, true, 'cevir', false, true), 'deepl');
  esit('KAPALI + YEREL YOK -> yerel (izin yoksa yine çıkmaz)',
    await hangiMotor({ ...A }, true, 'cevir', false, true), 'yerel');

  console.log(`\n${gecti} geçti, ${kaldi} kaldı\n`);

  // --- 2) DeepL (anahtar verildiyse) ---
  const dArg = al('--deepl', 1);
  if (dArg && dArg[0]) {
    console.log('=== 2) DeepL (gerçek istek) ===');
    const ayar = { deeplAnahtar: dArg[0] };
    const h = await deepl.hazirMi(ayar);
    if (!h.hazir) {
      console.log('  ✗ hazır değil:', h.sebep);
      kaldi++;
    } else {
      console.log(`  ✓ bağlandı · ${h.ucretsiz ? 'ÜCRETSİZ' : 'ücretli'} katman`);
      console.log(`    kota: ${h.kullanilan.toLocaleString()} / ${h.limit.toLocaleString()} karakter` +
        ` (kalan ${h.kalan.toLocaleString()})`);
      try {
        const r = await deepl.satirCevir(SATIRLAR, ayar, { hedef: 'tr' });
        console.log(`  ✓ ${SATIRLAR.length} satır · ${r.ms} ms · ${r.karakter} karakter · kaynak dil ${r.kaynakDil}`);
        SATIRLAR.forEach((s, i) => {
          console.log(`     ${s}`);
          console.log(`       → ${r.satirlar[i]}`);
        });
        // Hizalama DeepL'de yapısal olarak garanti — yine de doğrula.
        esit('satır sayısı korundu', r.satirlar.length, SATIRLAR.length);
        gecti++;
      } catch (e) { console.log('  ✗ çeviri hatası:', e.message); kaldi++; }
    }
  } else {
    console.log('=== 2) DeepL — atlandı (--deepl <ANAHTAR> ver) ===');
  }

  // --- 3) API ucu (anahtar verildiyse) ---
  const aArg = al('--api', 3);
  if (aArg && aArg[0] && aArg[1] && aArg[2]) {
    console.log('\n=== 3) API ucu (gerçek istek) ===');
    const ayar = { apiUrl: aArg[0], apiAnahtar: aArg[1], apiModel: aArg[2] };
    try {
      const r = await api.uret(satirCeviriMesajlari(SATIRLAR, 'tr'), ayar, {});
      console.log(`  ✓ ${r.model} · ${r.ms} ms${r.token ? ` · ${r.token} token` : ''}`);
      console.log(r.metin.split('\n').map((s) => '     │ ' + s).join('\n'));
      gecti++;
    } catch (e) { console.log('  ✗', e.message); kaldi++; }
  } else {
    console.log('\n=== 3) API ucu — atlandı (--api <URL> <ANAHTAR> <MODEL> ver) ===');
  }

  console.log(`\nTOPLAM: ${gecti} geçti, ${kaldi} kaldı`);
  process.exitCode = kaldi ? 1 : 0;
})();
