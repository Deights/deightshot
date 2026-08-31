// ÇOK DİLLİ OCR seçimi ölçümü.
//
//   npx electron tools/ocr-dil-secimi/uret.js   (önce görüntüleri üret)
//   node tools/ocr-dil-secimi/coklu-olc.js
//
// 🔴 SINANAN HİPOTEZ:
// Her OCR motoru yalnızca kendi alfabesinin karakterlerini üretebilir.
// Latin motoru '游戏' ya da 'Настройки' YAZAMAZ — karakter kümesinde yok.
// Dolayısıyla bütün motorları çalıştırıp "çıktısında kendi imza alfabesini
// üreten hangisi" diye bakmak, dili GÜVENİLİR biçimde belirlemeli.
//
// Bu bir varsayım. Aşağıda bilinen metinle karakter karakter doğrulanıyor;
// tutmazsa otomatiğe bağlanmaz.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

const KOK = path.join(__dirname, '..', '..');
const EXE = path.join(KOK, 'native', 'Shot88.Native', 'bin', 'Release',
  'net10.0-windows10.0.22621.0', 'shot88-native.exe');
const GORUNTU = path.join(process.env.TEMP, 'shot88', 'ocr-dil');
const ORNEKLER = require('./metinler');

// --- native köprüsü ---
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
const cagir = (cmd, args, ms = 25000) => {
  const i = id++;
  proc.stdin.write(JSON.stringify({ id: i, cmd, args: args || {} }) + '\n');
  return new Promise((res, rej) => {
    bek.set(i, { res, rej });
    setTimeout(() => { if (bek.delete(i)) rej(new Error('zaman asimi')); }, ms);
  });
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// --- doğruluk ---
const sadelestir = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/[.,:;!?]/g, '');
function uzaklik(a, b) {
  const m = a.length, n = b.length;
  let onceki = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const simdi = [i];
    for (let j = 1; j <= n; j++) {
      simdi[j] = Math.min(onceki[j] + 1, simdi[j - 1] + 1,
        onceki[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    onceki = simdi;
  }
  return onceki[n];
}
const dogruluk = (bek_, bul) => {
  const a = sadelestir(bek_), b = sadelestir(bul);
  if (!a.length) return 0;
  return Math.max(0, 1 - uzaklik(a, b) / a.length);
};

// --- İMZA ALFABELERİ ---
// Her dilin YALNIZCA o motorun üretebileceği karakterleri.
const IMZA = [
  { dil: 'ja', re: /[぀-ゟ゠-ヿ]/g, ad: 'Kana' },       // Hiragana/Katakana
  { dil: 'zh', re: /[一-鿿]/g,              ad: 'Han' },         // Çince/Japonca ortak
  { dil: 'ru', re: /[Ѐ-ӿ]/g,              ad: 'Kiril' },
  { dil: 'tr', re: /[ğĞşŞıİ]/g,                     ad: 'TR harf' },
];

/** Metindeki imza karakterlerinin harflere oranı. */
function imzaOranlari(metin) {
  const harf = (String(metin).match(/[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const o = {};
  for (const s of IMZA) o[s.dil] = harf ? (String(metin).match(s.re) || []).length / harf : 0;
  return { harf, oran: o };
}

/**
 * Bütün motor çıktılarına bakıp dili seç. Latin ise null döner —
 * çağıran taraf mevcut tr↔en mantığına düşer.
 *
 * 🔴 EŞİK 0.40, ölçümle belirlendi:
 *   gerçek Rusça  -> ru motoru %100 Kiril
 *   gerçek Çince  -> zh motoru %100 Han
 *   gerçek Japonca-> ja motoru %59 Kana
 *   YANLIŞ POZİTİF: Türkçe metni ru motoruyla okuyunca %26 Kiril uyduruyor
 *     ("Görüş Alanı" -> "G6rtj5 Alam ауапт"). 0.15 eşiği buna kanıyordu.
 * %26 ile %59 arasında geniş boşluk var; 0.40 ikisini de güvenle ayırıyor.
 *
 * Sıra ÖNEMLİ: Kana varsa Japonca. Japonca Han da kullanır, tersi olmaz —
 * zh motoru Japonca metinde %95 Han üretiyor ama Kana üretemiyor.
 */
const ESIK = 0.40;

function dilSec(sonuclar) {
  const puan = {};
  for (const [dilKodu, r] of Object.entries(sonuclar)) {
    if (!r || !r.metin) continue;
    puan[dilKodu] = imzaOranlari(r.metin);
  }
  const bak = (kisaltma) => {
    for (const [dilKodu, p] of Object.entries(puan)) {
      if (dilKodu.startsWith(kisaltma) && p.oran[kisaltma] >= ESIK) return dilKodu;
    }
    return null;
  };
  // Latin diller (tr/en) burada AYRILMIYOR — imzaları zayıf, ayrı mantık var.
  return bak('ja') || bak('zh') || bak('ru') || null;
}

(async () => {
  for (let i = 0; i < 80 && !hazir; i++) await bekle(100);
  if (!hazir) throw new Error('native hazir olmadi');

  const d = await cagir('ocr-langs', {}, 8000);
  const MOTORLAR = d.languages || [];
  console.log('kurulu OCR motorları:', MOTORLAR.join(', '));
  console.log('sınanan hipotez: her motor yalnızca kendi alfabesini üretebilir\n');

  let dogru = 0, toplam = 0;
  for (const o of ORNEKLER) {
    const png = path.join(GORUNTU, o.ad + '.png');
    if (!fs.existsSync(png)) { console.log('EKSİK görüntü:', o.ad); continue; }

    const sonuclar = {};
    let sure = 0;
    for (const lang of MOTORLAR) {
      try {
        const r = await cagir('ocr', { path: png, lang, scale: 1.5 });
        sonuclar[lang] = { metin: r.text || '', d: dogruluk(o.metin, r.text || '') };
        sure += r.ms || 0;
      } catch { sonuclar[lang] = { metin: '', d: 0 }; }
    }

    const secilen = dilSec(sonuclar);
    const enIyi = Object.entries(sonuclar).sort((a, b) => b[1].d - a[1].d)[0];

    // ⚠️ Latin metinde DOĞRU cevap null'dır: bu fonksiyon sadece Latin-dışı
    // scriptleri ayırıyor, tr↔en ayrımı ayrı mantıkta (ölçüldü, 5/5).
    // İlk sürüm null'ı hata sayıyordu ve hipotez tutmamış gibi görünüyordu.
    const latinMi = ['tr', 'en', 'karisik'].includes(o.dil);
    const ok = latinMi
      ? secilen === null
      : (secilen !== null && secilen.startsWith(o.dil)
         && sonuclar[secilen].d >= enIyi[1].d - 0.05);
    toplam++; if (ok) dogru++;

    console.log(`### ${o.ad}  (gerçek: ${o.dil}, ${o.punto}px, ${MOTORLAR.length} motor ${sure} ms)`);
    for (const [lang, r] of Object.entries(sonuclar)) {
      const im = imzaOranlari(r.metin).oran;
      const imYazi = Object.entries(im).filter(([, v]) => v > 0.02)
        .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`).join(' ') || '—';
      console.log(`   ${lang.padEnd(7)} %${(r.d * 100).toFixed(0).padStart(3)}  imza[${imYazi}]  ${r.metin.replace(/\n/g, ' ').slice(0, 46)}`);
    }
    console.log(`   -> seçim: ${secilen || '(yok, Latin varsayılır)'}  · en iyi: ${enIyi[0]} %${(enIyi[1].d * 100).toFixed(0)}  ${ok ? '✓' : '✗ YANILDI'}\n`);
  }

  console.log('='.repeat(60));
  console.log(`imza tabanlı seçim: ${dogru}/${toplam} doğru`);
  console.log(dogru === toplam
    ? '✓ hipotez tuttu — otomatiğe bağlanabilir'
    : '✗ hipotez tutmadı — otomatiğe BAĞLAMA');

  proc.stdin.end();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('HATA:', e.message); try { proc.kill(); } catch {} process.exit(1); });
