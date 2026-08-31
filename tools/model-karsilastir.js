// Model karşılaştırma — aynı metni birden fazla modele çevirtip yan yana koyar.
// EKRAN GEREKTİRMEZ, sentetik tuş üretmez, Electron'a ihtiyaç duymaz.
//
//   node tools/model-karsilastir.js                 (varsayılan adaylar, GPU)
//   node tools/model-karsilastir.js --cpu           (oyun içi senaryo: CPU'ya zorla)
//   node tools/model-karsilastir.js --model qwen3:4b --model qwen3:8b
//
// Neden ayrı araç: ceviri-testi.js modeli kendi seçiyor ve tek geçiş yapıyor.
// Model seçimi bir ÖLÇÜM kararı — yan yana koymak şart.
//
// ⚠️ Ders: kaliteyi dolaylı sayıyla puanlama.
// Buradaki otomatik kontroller sadece BARİZ hataları yakalar (boş çıktı,
// İngilizce kalmış cümle, uydurma). Nihai karar çıktılara gözle bakılarak veriliyor.

const ollama = require('../modules/ceviri/motorlar/ollama');
const uzakApi = require('../modules/ceviri/motorlar/api');
const { ceviriMesajlari, aciklaMesajlari } = require('../modules/ceviri/promptlar');

// --- argümanlar ---
const argv = process.argv.slice(2);
const cpuZorla = argv.includes('--cpu');
const dusunme = argv.includes('--dusunme');
const secilen = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--model') secilen.push(argv[i + 1]);
const MODELLER = secilen.length ? secilen : ['qwen3:1.7b', 'qwen3:4b', 'qwen3:8b'];

// Uzak uç: --api <URL> <ANAHTAR>  → --model'ler oradaki modeller olarak okunur.
// Yerelle uzağı AYNI testten geçirmek şart; yoksa "daha iyi" iddiası havada kalır.
const apiIdx = argv.indexOf('--api');
const UZAK = apiIdx !== -1
  ? { apiUrl: argv[apiIdx + 1], apiAnahtar: argv[apiIdx + 2] }
  : null;

/** Motor farkını gizleyen tek çağrı — testin geri kalanı hangisi olduğunu bilmez. */
async function calistir(model, mesajlar) {
  if (UZAK) {
    return uzakApi.uret(mesajlar, { ...UZAK, apiModel: model }, { zamanAsimi: 120000 });
  }
  return ollama.uret(mesajlar, {
    model, gpu: !cpuZorla, dusunme, keepAlive: '5m',
    zamanAsimi: cpuZorla ? 900000 : 300000,
  });
}

// --- test metinleri: gerçek kullanım senaryoları ---
const ORNEKLER = [
  {
    baslik: 'Oyun ayar menüsü',
    metin: 'Motion Blur\nAmbient Occlusion: SSAO\nV-Sync: Off\nField of View: 90',
    islem: 'acikla',
    // Terim adları çevrilmemeli ama açıklama Türkçe olmalı.
    bekle: { turkce: true, terimKorunsun: ['Motion Blur', 'V-Sync'] },
  },
  {
    baslik: 'Oyun içi diyalog',
    metin: 'You should have known better than to trust him. The Arasaka deal was never going to work out.',
    islem: 'cevir',
    bekle: { turkce: true, ingilizceKalmasin: ['should have known', 'was never going'] },
  },
  {
    baslik: 'Hata mesajı',
    metin: 'The remote certificate is invalid according to the validation procedure.',
    islem: 'cevir',
    bekle: { turkce: true, ingilizceKalmasin: ['remote certificate is invalid'] },
  },
  {
    baslik: 'HALÜSİNASYON TESTİ',
    metin: '> Kill him\n> Let him go\n> Say nothing',
    islem: 'acikla',
    // Model bu üç seçeneğin OYUNDAKİ sonucunu bilemez. İddia ederse kesin hata.
    bekle: { turkce: true, uydurmaBelirtisi: true },
  },
  {
    baslik: 'Uzun UI metni (kesilme testi)',
    metin: 'Your account has been temporarily restricted due to unusual activity. ' +
      'To restore access, verify your email address and enable two-factor authentication. ' +
      'If you believe this is an error, contact support with your case number.',
    islem: 'cevir',
    bekle: { turkce: true, kesilmesin: true },
  },
];

// --- basit, BARİZ hata yakalayan kontroller ---
const TR_HARF = /[çğıöşüÇĞİÖŞÜ]/;
// Oyuna özgü sonuç iddiası kalıpları — halüsinasyon belirtisi.
// ⚠️ İlk sürüm fazla dardı: qwen3:1.7b "oyunun en önemli hedefini belirtir",
// "oyunu kazanmak için en kritik adım" dedi ve hiçbiri eşleşmedi.
// Girdi sadece üç seçenek — model oyunun ADINI bile bilmiyor, dolayısıyla
// hedef/kazanma/risk/strateji hakkındaki HER iddia uydurmadır.
const UYDURMA = [
  /seçersen\s+\w+\s+(ölür|öldür|kaybed|kazan)/i,
  /bu (seçenek|karar)\s*.{0,30}(hikâye|hikaye|görev|quest|sonun|final)/i,
  /karakter(in|i)?\s+(sonra|daha sonra|ileride)/i,
  /(oyunun|hikâyenin|hikayenin)\s+(sonunu|gidişatını)\s+değiştir/i,
  /oyunu\s+kazanmak/i,
  /oyunun\s+en\s+(önemli|büyük|kritik|az)/i,
  /(en\s+)?(az|çok|büyük)\s+risk(li)?\s+seçenek/i,
  /oyunun\s+(stratejisi|hedefi|amacı)/i,
];

/**
 * Takılma döngüsü — küçük modellerin en sık çöküşü.
 * ⚠️ İlk sürümde bu kontrol YOKTU ve qwen3:1.7b aynı ibareyi 100+ kez
 * tekrarlarken araç "0 uyarı" dedi. Ölçüm aracı kör olursa ölçüm yalan söyler.
 */
function donguVarMi(t) {
  // 4-8 kelimelik pencereyi kaydırıp aynı dizinin kaç kez geçtiğine bak.
  const kel = t.toLowerCase().replace(/\s+/g, ' ').split(' ');
  if (kel.length < 40) return 0;
  const sayac = new Map();
  for (let i = 0; i + 6 <= kel.length; i++) {
    const p = kel.slice(i, i + 6).join(' ');
    sayac.set(p, (sayac.get(p) || 0) + 1);
  }
  let enCok = 0;
  for (const n of sayac.values()) if (n > enCok) enCok = n;
  return enCok;
}

function kontrolEt(cikti, bekle) {
  const sorun = [];
  const t = (cikti || '').trim();
  if (!t) return ['BOŞ ÇIKTI'];
  if (bekle.turkce && !TR_HARF.test(t)) sorun.push('Türkçe değil gibi (TR harfi yok)');

  const tekrar = donguVarMi(t);
  if (tekrar >= 3) sorun.push(`🔴 TAKILMA DÖNGÜSÜ: aynı 6 kelime ${tekrar} kez`);

  // Çeviride çıktı kaynaktan çok uzunsa model dağılmıştır.
  if (bekle.enFazlaOran && t.length > bekle.kaynakUzunluk * bekle.enFazlaOran) {
    sorun.push(`çıktı kaynaktan ${(t.length / bekle.kaynakUzunluk).toFixed(1)}x uzun — dağılmış olabilir`);
  }
  for (const p of bekle.ingilizceKalmasin || []) {
    if (t.toLowerCase().includes(p.toLowerCase())) sorun.push(`çevrilmemiş: "${p}"`);
  }
  for (const p of bekle.terimKorunsun || []) {
    if (!t.toLowerCase().includes(p.toLowerCase())) sorun.push(`terim kaybolmuş: "${p}"`);
  }
  if (bekle.uydurmaBelirtisi) {
    for (const r of UYDURMA) if (r.test(t)) sorun.push(`🔴 UYDURMA: /${r.source.slice(0, 40)}/`);
  }
  // Cümle ortasında bitmiş mi (num_predict yetmemiş olabilir)
  if (bekle.kesilmesin && !/[.!?:)\]"»…]\s*$/.test(t)) sorun.push('cümle ortasında kesilmiş olabilir');
  return sorun;
}

const kisalt = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

(async () => {
  console.log(UZAK
    ? `cihaz: UZAK API — ${UZAK.apiUrl}  ⚠ metin dışarı gidiyor`
    : `cihaz: ${cpuZorla ? 'CPU (num_gpu=0) — oyun içi senaryo' : 'GPU'}` +
      ` · düşünme: ${dusunme ? 'açık' : 'kapalı'}`);
  console.log(`modeller: ${MODELLER.join(', ')}\n`);

  const ozet = [];

  for (const model of MODELLER) {
    console.log('='.repeat(72));
    console.log(`### ${model}`);
    console.log('='.repeat(72));

    let toplamMs = 0, hataSayisi = 0, calisan = 0;

    for (const o of ORNEKLER) {
      const mesajlar = o.islem === 'cevir'
        ? ceviriMesajlari(o.metin, 'tr')
        : aciklaMesajlari(o.metin);

      process.stdout.write(`\n--- ${o.baslik} [${o.islem}] ... `);
      try {
        const r = await calistir(model, mesajlar);
        const sn = r.ms / 1000;
        toplamMs += r.ms; calisan++;
        // Çeviri kaynağın ~2 katından uzunsa model dağılmıştır (açıklama hariç).
        const sorun = kontrolEt(r.metin, {
          ...o.bekle,
          kaynakUzunluk: o.metin.length,
          enFazlaOran: o.islem === 'cevir' ? 2.2 : undefined,
        });
        if (sorun.length) hataSayisi += sorun.length;

        console.log(`${sn.toFixed(1)} sn`);
        console.log(r.metin.split('\n').map((s) => '   │ ' + s).join('\n'));
        if (sorun.length) console.log(sorun.map((s) => '   ⚠ ' + s).join('\n'));
        else console.log('   ✓ bariz sorun yok');
      } catch (e) {
        console.log('HATA');
        console.log('   ✗ ' + kisalt(e.message, 160));
        hataSayisi += 5;
      }
    }

    const ortSn = calisan ? toplamMs / calisan / 1000 : 0;
    ozet.push({ model, ortSn, hataSayisi, calisan });
    console.log(`\n>>> ${model}: ortalama ${ortSn.toFixed(1)} sn/istek · ${hataSayisi} uyarı\n`);

    // Sıradaki modelin ölçümünü bozmasın diye belleği bırak (sadece yerelde).
    if (!UZAK) {
      try {
        await ollama.uret([{ role: 'user', content: 'hi' }],
          { model, keepAlive: '0s', zamanAsimi: 20000 });
      } catch {}
    }
  }

  console.log('='.repeat(72));
  console.log('ÖZET  (' + (cpuZorla ? 'CPU' : 'GPU') + ')');
  console.log('='.repeat(72));
  console.log('model'.padEnd(28) + 'ort. sn'.padStart(10) + 'uyarı'.padStart(8));
  for (const o of ozet) {
    console.log(o.model.padEnd(28) + o.ortSn.toFixed(1).padStart(10) + String(o.hataSayisi).padStart(8));
  }
  console.log('\nNot: "uyarı" sadece bariz hataları sayar. Çıktıları gözle karşılaştır.');
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
