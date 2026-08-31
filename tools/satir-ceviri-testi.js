// Satır içi (altyazı) çeviri testi — EKRAN GEREKTİRMEZ, sentetik tuş üretmez.
//
//   node tools/satir-ceviri-testi.js                  (varsayılan model)
//   node tools/satir-ceviri-testi.js --model qwen3:4b
//
// İki ayrı şeyi test eder:
//   1) satirCeviriAyristir() — model çıktısını satırlara bölme (modelsiz, anında)
//   2) gerçek model — çıktı satır sayısı girdiyle tutuyor mu
//
// 🔴 Neden ayrı test: hizalama tutmazsa çeviriler YANLIŞ satırın altına düşer.
// Sessiz bir hata — ekranda düzgün görünür ama yanlış bilgi verir. Bu yüzden
// modül hizalamayı doğrulayıp tutmazsa altyazıyı hiç basmıyor.

const ollama = require('../modules/ceviri/motorlar/ollama');
const uzakApi = require('../modules/ceviri/motorlar/api');
const { satirCeviriMesajlari, satirCeviriAyristir } = require('../modules/ceviri/promptlar');

const argv = process.argv.slice(2);
const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : undefined;

// Uzak uç: --api <URL> <ANAHTAR>. Hizalama sınavı yerelde de uzakta da AYNI.
const apiIdx = argv.indexOf('--api');
const UZAK = apiIdx !== -1 ? { apiUrl: argv[apiIdx + 1], apiAnahtar: argv[apiIdx + 2] } : null;
// Düşünme: notlarda blok çeviride 12 kat yavaşlattığı ölçülmüştü. Altyazı
// modunda çıktı kısa olduğu için takas değişmiş olabilir — ölçmeden bilinmez.
const dusunme = argv.includes('--dusunme');

// ⚠️ ÖLÇÜLDÜ: llama-3.3-70b "That ship has sailed." için
// "O gemi ALREADY limandan ayrıldı." dedi — Türkçe cümlenin ortasına İngilizce
// kelime sıkıştırdı. Gözle bakmasan fark etmezsin, o yüzden dedektör şart.
// Liste dar tutuldu: yalnızca Türkçede karşılığı olan, teknik olmayan kelimeler.
const INGILIZCE_SIZINTI = new RegExp(
  '\\b(' + [
    'already', 'because', 'however', 'therefore', 'actually', 'basically',
    'the', 'and', 'but', 'with', 'from', 'that', 'this', 'your', 'you',
    'should', 'would', 'could', 'never', 'always', 'before', 'after',
  ].join('|') + ')\\b', 'i');

function sizintiVarMi(t) {
  // Tırnak içindeki kaynak metin alıntısı olabilir — onları çıkar.
  const temiz = String(t).replace(/["'“”][^"'“”]*["'“”]/g, ' ');
  const m = INGILIZCE_SIZINTI.exec(temiz);
  return m ? m[1] : null;
}

let gecti = 0, kaldi = 0;
function esit(ad, bulunan, beklenen) {
  const a = JSON.stringify(bulunan), b = JSON.stringify(beklenen);
  if (a === b) { gecti++; console.log(`  ✓ ${ad}`); }
  else { kaldi++; console.log(`  ✗ ${ad}\n      beklenen: ${b}\n      bulunan : ${a}`); }
}

console.log('=== 1) ayrıştırıcı (modelsiz) ===');

esit('düz numaralı çıktı',
  satirCeviriAyristir('1|Bir\n2|İki\n3|Üç', 3), ['Bir', 'İki', 'Üç']);

esit('araya boş satır girmiş',
  satirCeviriAyristir('1|Bir\n\n2|İki\n\n3|Üç', 3), ['Bir', 'İki', 'Üç']);

esit('ayraç olarak ":" kullanmış',
  satirCeviriAyristir('1: Bir\n2: İki', 2), ['Bir', 'İki']);

esit('sıra karışmış ama numaralar doğru',
  satirCeviriAyristir('2|İki\n1|Bir', 2), ['Bir', 'İki']);

// 🔴 En tehlikeli durum: model bir satırı atlıyor. Kabul EDİLMEMELİ.
esit('satır eksik -> null (yanlış hizalama yerine reddet)',
  satirCeviriAyristir('1|Bir\n3|Üç', 3), null);

esit('numarasız ama sayı tutuyor -> sırayla eşle',
  satirCeviriAyristir('Bir\nİki\nÜç', 3), ['Bir', 'İki', 'Üç']);

esit('numarasız ve sayı tutmuyor -> null',
  satirCeviriAyristir('Bir\nİki', 3), null);

esit('model giriş cümlesi eklemiş',
  satirCeviriAyristir('İşte çeviri:\n1|Bir\n2|İki', 2), ['Bir', 'İki']);

esit('boş çıktı -> null',
  satirCeviriAyristir('', 2), null);

esit('aynı numarayı iki kez yazmış -> eksik sayılır, null',
  satirCeviriAyristir('1|Bir\n1|Başka\n2|İki', 3), null);

console.log(`\n${gecti} geçti, ${kaldi} kaldı\n`);

// --- 2) gerçek model ---
const ORNEKLER = [
  {
    baslik: 'Oyun ayar menüsü (kısa satırlar)',
    satirlar: ['Motion Blur', 'Ambient Occlusion: SSAO', 'V-Sync: Off', 'Field of View: 90'],
  },
  {
    baslik: 'Diyalog (uzun satırlar)',
    satirlar: [
      'You should have known better than to trust him.',
      'The Arasaka deal was never going to work out.',
      'Get out of here before they find you.',
    ],
  },
  {
    baslik: 'Kopuk arayüz metni (OCR gerçekliği)',
    satirlar: ['ACCOUNT', 'Restricted', '2FA required', 'Case #4471', 'Contact support'],
  },
  {
    // ⚠️ Bu deyimlerin HİÇBİRİ prompt'ta örnek olarak geçmiyor. Prompt'a örnek
    // yazınca o cümle ezberlenebiliyor; iyileşmenin genel olduğunu ancak
    // görülmemiş deyimlerle doğrularız.
    baslik: 'TAZE DEYİMLER (prompt\'ta geçmiyor)',
    satirlar: [
      "Don't push your luck.",
      'He threw me under the bus.',
      "We're in over our heads.",
      'That ship has sailed.',
      'Keep your head down out there.',
    ],
  },
];

(async () => {
  console.log(`=== 2) gerçek model === (düşünme: ${dusunme ? 'AÇIK' : 'kapalı'})`);
  for (const o of ORNEKLER) {
    process.stdout.write(`\n--- ${o.baslik} (${o.satirlar.length} satır) ... `);
    try {
      const mesajlar = satirCeviriMesajlari(o.satirlar, 'tr');
      const r = UZAK
        ? await uzakApi.uret(mesajlar, { ...UZAK, apiModel: model }, { zamanAsimi: 120000 })
        : await ollama.uret(mesajlar, {
            model, gpu: true, dusunme, keepAlive: '5m', zamanAsimi: 300000,
          });
      const ayri = satirCeviriAyristir(r.metin, o.satirlar.length);
      console.log(`${(r.ms / 1000).toFixed(1)} sn · ${r.model}`);
      if (!ayri) {
        kaldi++;
        console.log('   ✗ HİZALAMA TUTMADI — altyazı basılmaz, panele düşülür');
        console.log(r.metin.split('\n').map((s) => '     ham: ' + s).join('\n'));
        continue;
      }
      gecti++;
      o.satirlar.forEach((k, i) => {
        const s = sizintiVarMi(ayri[i]);
        console.log(`   ${String(i + 1).padStart(2)}. ${k}`);
        console.log(`       → ${ayri[i]}${s ? `   🔴 İNGİLİZCE SIZINTI: "${s}"` : ''}`);
        if (s) kaldi++;
      });
    } catch (e) {
      kaldi++;
      console.log('HATA\n   ✗ ' + e.message);
    }
  }

  console.log(`\nTOPLAM: ${gecti} geçti, ${kaldi} kaldı`);
  // process.exit() burada libuv'u açık soketle yakalayıp assertion attırıyordu.
  // Çıkış kodunu işaretle, node kendi kapansın.
  process.exitCode = kaldi ? 1 : 0;
})();
