// DeepL arka ucu — SADECE çeviri. Açıklama yapamaz (LLM değil, çeviri motoru).
//
// Neden var: yerel qwen3:8b düz metinde iyi ama deyimlerde bozuyor
// ("You should have known better than to trust him." -> anlamsız çıktı,
// ölçüldü). DeepL tam orada güçlü.
// Ayrıca oyun açıkken GPU'ya ihtiyaç duymuyor — asıl derdimiz oydu.
//
// 🔴 GİZLİLİK: bu motor ekrandaki metni DIŞARI GÖNDERİR. Tasarımın "sıfır
// telemetri" kuralının bilinçli istisnası. Çağıran taraf kullanıcının bunu
// açıkça açtığını doğrulamadan buraya gelmemeli.
//
// Ücretsiz katman: ~500.000 karakter/ay. Anahtar ":fx" ile bitiyorsa ücretsiz.

const UC_UCRETSIZ = 'https://api-free.deepl.com/v2';
const UC_UCRETLI = 'https://api.deepl.com/v2';

/** Ücretsiz anahtarlar ":fx" ile biter — uç adresi buna göre seçilir. */
function ucSec(anahtar, elle) {
  if (elle) return elle.replace(/\/+$/, '');
  return /:fx$/.test((anahtar || '').trim()) ? UC_UCRETSIZ : UC_UCRETLI;
}

async function istek(yol, anahtar, uc, govde, zamanAsimi = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), zamanAsimi);
  try {
    const r = await fetch(ucSec(anahtar, uc) + yol, {
      method: govde ? 'POST' : 'GET',
      headers: {
        Authorization: `DeepL-Auth-Key ${anahtar}`,
        ...(govde ? { 'Content-Type': 'application/json' } : {}),
      },
      body: govde ? JSON.stringify(govde) : undefined,
      signal: c.signal,
    });

    if (!r.ok) {
      // DeepL'in hata kodları eyleme dönüşebilir — ham "HTTP 456" kullanıcıya
      // hiçbir şey anlatmıyor. Ne olduğunu ve ne yapacağını söyle.
      if (r.status === 403) throw new Error('DeepL anahtarı geçersiz. Ayarlardan kontrol et.');
      if (r.status === 456) throw new Error('DeepL aylık ücretsiz kotan doldu. Ay başında sıfırlanır — o zamana kadar yerel model kullanılır.');
      if (r.status === 429) throw new Error('DeepL çok fazla istek aldı, biraz bekle.');
      if (r.status === 400) throw new Error('DeepL isteği reddetti (400) — dil kodu desteklenmiyor olabilir.');
      throw new Error(`DeepL HTTP ${r.status}`);
    }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('DeepL yanıt vermedi (zaman aşımı). İnternet bağlantını kontrol et.');
    if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(e.message || '')) {
      throw new Error('DeepL\'e ulaşılamadı — internet bağlantısı yok gibi.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** @returns {{hazir:boolean, sebep?:string, kalan?:number, limit?:number}} */
async function hazirMi(ayar = {}) {
  const anahtar = (ayar.deeplAnahtar || '').trim();
  if (!anahtar) return { hazir: false, sebep: 'DeepL anahtarı girilmemiş' };

  try {
    const u = await istek('/usage', anahtar, ayar.deeplUc, null, 8000);
    const kullanilan = u.character_count || 0;
    const limit = u.character_limit || 0;
    return {
      hazir: true,
      kullanilan,
      limit,
      kalan: Math.max(0, limit - kullanilan),
      ucretsiz: /:fx$/.test(anahtar),
    };
  } catch (e) {
    return { hazir: false, sebep: e.message };
  }
}

/**
 * Satırları BİREBİR çevirir. DeepL her metni ayrı çevirdiği için hizalama
 * sorunu YOK — LLM'de en kırılgan yer buydu (numaralı format + doğrulama
 * gerekiyordu). Burada girdi kaç satırsa çıktı o kadar satır, garanti.
 *
 * @param {string[]} satirlar
 * @param {{hedef?:string, kaynak?:string}} sec
 * @returns {{satirlar:string[], ms:number, kaynakDil:string|null}}
 */
async function satirCevir(satirlar, ayar = {}, sec = {}) {
  const t0 = Date.now();
  const anahtar = (ayar.deeplAnahtar || '').trim();
  if (!anahtar) throw new Error('DeepL anahtarı girilmemiş');

  // Boş satırlar API'ye gitmesin — kotadan yer, karşılığında boş döner.
  const gidecek = [];
  const eslesme = [];
  satirlar.forEach((s, i) => {
    if (String(s).trim()) { eslesme.push(i); gidecek.push(String(s)); }
  });
  if (!gidecek.length) return { satirlar: satirlar.slice(), ms: 0, kaynakDil: null };

  const govde = {
    text: gidecek,
    target_lang: (sec.hedef || 'tr').toUpperCase(),
    // Oyun arayüzünden gelen metin kopuk olabiliyor; DeepL'in cümle bölmesi
    // satırları birleştirmesin — hizalamayı bozar.
    split_sentences: '0',
    preserve_formatting: true,
  };
  if (sec.kaynak) govde.source_lang = sec.kaynak.toUpperCase();

  const c = await istek('/translate', anahtar, ayar.deeplUc, govde, sec.zamanAsimi || 20000);
  const ceviriler = c.translations || [];
  if (ceviriler.length !== gidecek.length) {
    throw new Error(`DeepL ${gidecek.length} satır için ${ceviriler.length} sonuç döndürdü`);
  }

  const cikti = satirlar.slice();
  eslesme.forEach((hedefIndex, i) => { cikti[hedefIndex] = ceviriler[i].text; });

  return {
    satirlar: cikti,
    ms: Date.now() - t0,
    kaynakDil: ceviriler[0] ? ceviriler[0].detected_source_language : null,
    karakter: gidecek.reduce((t, s) => t + s.length, 0),
  };
}

/** Tek parça metin çevir (blok kip). */
async function cevir(metin, ayar = {}, sec = {}) {
  const satirlar = String(metin).split('\n');
  const r = await satirCevir(satirlar, ayar, sec);
  return { metin: r.satirlar.join('\n'), ms: r.ms, kaynakDil: r.kaynakDil, karakter: r.karakter };
}

module.exports = { ad: 'deepl', hazirMi, cevir, satirCevir, cevirebilir: true, aciklayabilir: false };
