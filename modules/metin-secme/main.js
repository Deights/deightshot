// metin-secme — OCR ile metin seçme/kopyalama.
//
// Bu, DeightShot'i Lightshot'tan ayıran asıl özellik. Çekirdeğe değil modüle
// yazılıyor (tasarım kuralı: yakalama/overlay çekirdek, OCR/sözlük/çeviri eklenti).
//
// Akış:
//   seçim bitti  -> renderer 'oku' der -> burada OCR başlar, sonuç ÖNBELLEĞE alınır
//   çift tık     -> renderer 'al' der  -> hazırsa anında döner (bekleme hissi olmaz)
//
// Ölçüldü: bölge OCR'ı ~6 ms, tam ekran ~100 ms.
// Yani kullanıcı çift tıklayana kadar zaten hazır oluyor.

/** Anahtar: "displayId:x:y:w:h" -> Promise<sonuç> */
const onbellek = new Map();
let ctx = null;

/** Kurulu OCR dilleri — bir kez sorulup saklanıyor. */
let dilListesi = null;
async function dilleriAl() {
  if (dilListesi) return dilListesi;
  try {
    const d = await ctx.native.cagir('ocr-langs', {}, 5000);
    dilListesi = d.languages || [];
  } catch {
    dilListesi = ['tr', 'en-US'];      // en kötü ihtimalde bilinen ikili
  }
  return dilListesi;
}

function anahtar(a, dil, olcekOn) {
  return `${a.displayId}:${a.x}:${a.y}:${a.w}:${a.h}:${dil}:${olcekOn}`;
}

/**
 * OCR'ı başlatır ve sözünü önbelleğe koyar. Aynı bölge tekrar istenirse
 * ikinci kez OCR çalıştırmaz.
 * @param {{displayId:number,x:number,y:number,w:number,h:number,olcek:number,lang?:string}} a
 *        Koordinatlar DIP; `olcek` ile fiziksele çevriliyor.
 */
/**
 * 🔴 OTOMATİK DİL SEÇİMİ — ölçümle doğrulandı (16 Ağu 2026).
 *
 * Tek sabit dil iki senaryoyu birden çözmüyor:
 *   Türkçe metin: tr %99-100 · en-US %76-88   (en-US ğ/ş/ı üretemiyor,
 *                 "beğenmediğim" -> "beöenmediöim" oluyor — ölçüldü)
 *   İngilizce metin: tr %99-100 · en-US %100  (neredeyse fark yok)
 *
 * Yani asimetrik: yanlış dil Türkçede yıkıcı, İngilizcede zararsız.
 * Bu yüzden ÖNCE tr ile okunuyor; çıktıda Türkçeye özgü harf varsa metin
 * Türkçedir, iş biter. Yoksa en-US ile bir kez daha okunuyor.
 * Türkçe metin: 1 geçiş · İngilizce metin: 2 geçiş (bölge OCR'ı ~6 ms).
 *
 * Ölçüm aracı: tools/ocr-dil-secimi/ — 5 örnekte 5/5 doğru seçim.
 */
const TR_OZGU = /[ğĞşŞıİ]/g;

/** Türkçeye özgü harflerin tüm harflere oranı. */
function trOrani(metin) {
  const harf = (String(metin).match(/\p{L}/gu) || []).length;
  if (!harf) return 0;
  return (String(metin).match(TR_OZGU) || []).length / harf;
}

// Bu eşiğin altı "Türkçe değil" sayılıyor. %2 = 100 harfte 2 tane ğ/ş/ı.
// Ölçümde Türkçe örnekler %5-19, İngilizce örnekler %0 çıktı — arada geniş
// boşluk var, eşik hassas değil.
const TR_ESIK = 0.02;

// 🔴 LATİN-DIŞI SCRIPT TESPİTİ — ölçüldü 8/8 (tools/ocr-dil-secimi/coklu-olc.js)
//
// Dayandığı gerçek: her Windows OCR motoru YALNIZCA kendi alfabesini
// üretebiliyor. Latin motoru '游戏' ya da 'Настройки' yazamaz; Çince metni
// okumaya çalışınca ya boş döner ya çöp Latin harf üretir.
// Dolayısıyla "çıktısında kendi imza alfabesini üreten motor hangisiyse o
// doğrudur" kuralı güvenilir.
//
// EŞİK 0.40 ölçümle belirlendi:
//   gerçek Rusça   -> ru motoru %100 Kiril
//   gerçek Çince   -> zh motoru %100 Han
//   gerçek Japonca -> ja motoru  %59 Kana
//   🔴 YANLIŞ POZİTİF: Türkçe metni ru motoruyla okuyunca %26 Kiril UYDURUYOR
//      ("Görüş Alanı" -> "G6rtj5 Alam ауапт"). 0.15 eşiği buna kanıyordu.
//   %26 ile %59 arasında geniş boşluk var.
//
// SIRA ÖNEMLİ: önce Kana. Japonca Han da kullanır, tersi olmaz — zh motoru
// Japonca metinde %95 Han üretiyor ama Kana üretemiyor.
const IMZALAR = [
  { on: 'ja', re: /[぀-ゟ゠-ヿ]/g },   // Hiragana + Katakana
  { on: 'zh', re: /[一-鿿]/g },                 // Han
  { on: 'ru', re: /[Ѐ-ӿ]/g },                 // Kiril
];
const IMZA_ESIK = 0.40;

/** Metnin harf sayısı (Han/Kana dahil — \p{L} onları da kapsıyor). */
const harfSayisi = (t) => (String(t).match(/\p{L}/gu) || []).length;

/**
 * Dili kendisi seçerek okur.
 *
 * İki aşama:
 *   1) Latin-DIŞI motorlar (ja/zh/ru) — imza alfabesi üreten varsa o kazanır.
 *      Kısa devre yok: Rusça metni tr motoruyla okuyunca %12 Türkçe harf
 *      uyduruyor, yani "önce tr dene" kestirmesi Rusça'yı Türkçe sanıyordu.
 *   2) Hepsi Latin ise -> tr, Türkçeye özgü harf yoksa en-US.
 *
 * Maliyet: Latin metinde kurulu motor sayısı kadar geçiş. Bölge OCR'ı ~6 ms
 * olduğu için pratikte fark edilmiyor; seçim biter bitmez arka planda başlıyor.
 */
async function otomatikOku(istek) {
  const t0 = Date.now();
  const kurulu = await dilleriAl();

  // --- 1) Latin-dışı scriptler ---
  for (const imza of IMZALAR) {
    const motor = kurulu.find((k) => k.toLowerCase().startsWith(imza.on));
    if (!motor) continue;
    let r;
    try { r = await ctx.native.cagir('ocr', { ...istek, lang: motor }, 15000); }
    catch { continue; }

    const harf = harfSayisi(r.text || '');
    if (!harf) continue;
    const oran = ((r.text || '').match(imza.re) || []).length / harf;
    if (oran >= IMZA_ESIK) {
      ctx.log(`dil otomatik: ${motor} (%${(oran * 100).toFixed(0)} ${imza.on} imzası, ${Date.now() - t0} ms)`);
      return r;
    }
  }

  // --- 2) Latin: tr mi en mi ---
  let trSonuc = null;
  try {
    trSonuc = await ctx.native.cagir('ocr', { ...istek, lang: 'tr' }, 15000);
    const o = trOrani(trSonuc.text || '');
    if (o >= TR_ESIK) {
      ctx.log(`dil otomatik: tr (%${(o * 100).toFixed(1)} TR harf, ${Date.now() - t0} ms)`);
      return trSonuc;
    }
  } catch (e) {
    ctx.log('tr okunamadı: ' + e.message);
  }

  try {
    const enSonuc = await ctx.native.cagir('ocr', { ...istek, lang: 'en-US' }, 15000);
    ctx.log(`dil otomatik: en-US (Latin, TR harf yok, ${Date.now() - t0} ms)`);
    return enSonuc;
  } catch (e) {
    if (trSonuc) {
      ctx.log('en-US okunamadı, tr sonucu kullanılıyor: ' + e.message);
      return trSonuc;
    }
    throw e;
  }
}

function baslat(a) {
  const ayar = ctx.ayarlar.get();
  // Dil: çağrı belirtmişse o (metin modundaki değiştirici), yoksa ayardaki.
  const dil = a.lang !== undefined ? a.lang : (ayar.ocrDil || '');
  // OCR öncesi büyütme — ölçüldü, 1.5x belirgin daha doğru okuyor.
  const olcekOn = a.olcekOn || ayar.ocrOlcek || 1;

  const k = anahtar(a, dil, olcekOn);
  if (onbellek.has(k)) return onbellek.get(k);

  const kare = ctx.kare(a.displayId);
  if (!kare) return Promise.reject(new Error('bu ekran için kare yok'));

  const o = a.olcek || 1;
  const istek = {
    path: kare.path,
    lang: dil,
    scale: olcekOn,
    x: Math.max(0, Math.round(a.x * o)),
    y: Math.max(0, Math.round(a.y * o)),
    w: Math.round(a.w * o),
    h: Math.round(a.h * o),
  };

  const oku = dil === 'oto'
    ? otomatikOku(istek)
    : ctx.native.cagir('ocr', istek, 15000);

  const soz = oku
    .then((r) => {
      // Koordinatlar KIRPILAN bölgeye göreli geliyor. Renderer DIP bekliyor:
      // pencere içi konum = seçim başlangıcı + (fiziksel offset / ölçek)
      const kelimeler = [];
      r.lines.forEach((satir, si) => {
        satir.words.forEach((w, wi) => {
          kelimeler.push({
            metin: w.text,
            satir: si,
            sira: wi,
            x: a.x + w.x / o,
            y: a.y + w.y / o,
            w: w.w / o,
            h: w.h / o,
          });
        });
      });

      const sonuc = {
        dil: r.language,
        ms: r.ms,
        satirlar: r.lines.map((l) => l.text),
        kelimeler,
        metin: r.text,
      };
      ctx.log(`OCR bitti: ${kelimeler.length} kelime, ${r.ms} ms, dil=${r.language}`);
      return sonuc;
    })
    .catch((e) => {
      onbellek.delete(k);              // başarısızsa tekrar denenebilsin
      ctx.log('OCR başarısız: ' + e.message);
      throw e;
    });

  onbellek.set(k, soz);
  return soz;
}

function init(_ctx) {
  ctx = _ctx;

  // Yeni yakalama başlayınca önceki OCR sonuçları geçersiz — kare değişti.
  ctx.on('kisayol-basildi', () => onbellek.clear());

  /** Seçim biter bitmez çağrılır. Sonucu BEKLEMEZ, sadece tetikler. */
  ctx.komut('oku', (a) => {
    baslat(a).catch(() => {});         // hatayı burada yut, 'al' sırasında bildirilecek
    return { baslatildi: true };
  });

  /** Çift tıkta çağrılır. Hazırsa anında, değilse bitince döner. */
  ctx.komut('al', async (a) => baslat(a));

  /** Kullanılabilir OCR dilleri (ayar arayüzü için). */
  ctx.komut('diller', async () => ctx.native.cagir('ocr-langs', {}, 5000));

  ctx.log('hazır');
}

module.exports = { init };
