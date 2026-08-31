// Ollama arka ucu — yerel, offline, kurulu modelleri kullanır.
//
// Takılabilir motor arayüzünü uygular:
//   hazirMi()  -> { hazir, sebep?, modeller? }
//   uret(mesajlar, secenekler) -> { metin, model, ms }
//
// Neden Ollama: zaten kurulu, ayrı runtime yazmaya gerek yok.
// ⚠️ Ama oradaki modeller RP/sohbet için seçilmiş (9-12B, bir kısmı abliterated).
// Çeviri için ideal değiller — boru hattını kurmak için yeterli, doğru model
// sonra ölçerek seçilecek.

const TABAN = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// 🔴 ÖLÇÜLDÜ (16 Ağu 2026).
// Bu liste tahmin değil, aynı testten geçmiş modellerin sonucu. Yeni model
// eklerken önce `node tools/model-karsilastir.js --model <ad>` çalıştır.
const OLCULEN = {
  // think:false'u yok sayıyor; cevap yerine İngilizce akıl yürütme döndürüyor.
  'qwen3:4b': { p: -100, not: 'düşünmeyi kapatmıyor' },
  // Hızlı (0.5-1.7 sn) ama çeviri anlamı bozuyor ("remote" -> "yakın"),
  // halüsinasyon sınırını tanımıyor, takılma döngüsüne giriyor.
  'qwen3:1.7b': { p: -80, not: 'çeviri kalitesi yetersiz' },
  // Doğrulanmış: think:false uyuyor, satır çevirisi ~1 sn, hizalama tutuyor.
  'qwen3:8b': { p: +40, not: 'ölçüldü, çalışıyor' },
};

/** Talimat takibi zayıf olan modelleri geri plana at. */
function modelPuani(ad) {
  const a = ad.toLowerCase();
  if (OLCULEN[a]) return OLCULEN[a].p;

  let p = 0;
  // Abliterated/uncensored modeller talimat takibinde zayıflıyor —
  // "teknik terimleri İngilizce bırak" gibi kuralları atlıyorlar.
  if (a.includes('abliterated') || a.includes('heretic') || a.includes('uncensored')) p -= 50;
  // Kişilik yüklenmiş özel modeller (dayi-ai gibi) çeviri için uygun değil
  if (a.startsWith('dayi-')) p -= 30;
  // ⚠️ 3B altı modeller ölçümde çeviri anlamını bozdu. Ölçülmemiş küçük bir
  // model varsayılan OLMASIN — hız uğruna yanlış çeviri en kötü takas.
  if (/[:\-](0\.\d|1|1\.\d|2|2\.\d)b\b/.test(a)) p -= 60;
  // Qwen ailesi Türkçe'de iyi sayılıyor — ölçülmedi, sadece başlangıç tercihi
  if (a.includes('qwen')) p += 10;
  if (a.includes('gemma')) p += 5;
  return p;
}

async function istek(yol, govde, zamanAsimi = 120000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), zamanAsimi);
  const t0 = Date.now();
  try {
    const r = await fetch(TABAN + yol, {
      method: govde ? 'POST' : 'GET',
      headers: govde ? { 'Content-Type': 'application/json' } : undefined,
      body: govde ? JSON.stringify(govde) : undefined,
      signal: c.signal,
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    // ⚠️ Ham "This operation was aborted" mesajı kullanıcıya hiçbir şey
    // anlatmıyor (oyun içinde ölçüldü). Ne olduğunu ve ne yapacağını söyle.
    if (e.name === 'AbortError' || /aborted/i.test(e.message || '')) {
      const sn = Math.round((Date.now() - t0) / 1000);
      throw new Error(
        `Model ${sn} saniyede cevap veremedi ve durduruldu. ` +
        `Genelde GPU başka bir şeyle (oyun gibi) dolu olduğunda oluyor — ` +
        `oyundan çıkıp tekrar dene, ya da daha küçük bir model seç.`);
    }
    if (/fetch failed|ECONNREFUSED/i.test(e.message || '')) {
      throw new Error('Ollama çalışmıyor. Ollama uygulamasını başlat ve tekrar dene.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function hazirMi() {
  try {
    const r = await istek('/api/tags', null, 4000);
    const modeller = (r.models || [])
      .map((m) => ({ ad: m.name, boyutGb: +(m.size / 1e9).toFixed(1), puan: modelPuani(m.name) }))
      .sort((a, b) => b.puan - a.puan || a.boyutGb - b.boyutGb);

    if (!modeller.length) return { hazir: false, sebep: 'Ollama çalışıyor ama kurulu model yok' };
    return { hazir: true, modeller };
  } catch (e) {
    return {
      hazir: false,
      sebep: e.name === 'AbortError'
        ? 'Ollama yanıt vermedi (zaman aşımı)'
        : `Ollama çalışmıyor (${TABAN})`,
    };
  }
}

/**
 * @param {Array<{role:string,content:string}>} mesajlar
 * @param {{model?:string, gpu?:boolean, keepAlive?:string, zamanAsimi?:number}} sec
 */
async function uret(mesajlar, sec = {}) {
  const t0 = Date.now();

  let model = sec.model;
  if (!model) {
    const d = await hazirMi();
    if (!d.hazir) throw new Error(d.sebep);
    model = d.modeller[0].ad;
  }

  const secenekler = {
    temperature: 0.2,        // çeviri/açıklama — yaratıcılık istemiyoruz
    top_p: 0.9,
    // 512 yetmiyordu: birkaç maddelik açıklama cümle ortasında kesiliyordu.
    num_predict: sec.enFazlaToken || 1400,
    // ⚠️ ÖLÇÜLDÜ: qwen3 ailesinin varsayılanı `repeat_penalty 1` — yani ceza YOK.
    // qwen3:1.7b bu yüzden "ışık yollarını kendi içindeki" ibaresini yüzlerce kez
    // tekrarlayıp token limitine dayandı (23 sn). Küçük modeller buna çok yatkın.
    repeat_penalty: 1.12,
  };

  // Kaynak kararı: GPU'ya sığmıyorsa katman sayısını 0 yapıp CPU'ya zorla.
  if (sec.gpu === false) secenekler.num_gpu = 0;

  const cevap = await istek('/api/chat', {
    model,
    messages: mesajlar,
    stream: false,
    // Qwen3 gibi modeller cevaptan önce görünmez akıl yürütme üretiyor.
    // Ölçüldü: kapalıyken 4-5 kat hızlı (12s -> 1s) ama deyimsel cümlelerde
    // çeviri biraz daha kötü. Takas ayardan yönetiliyor.
    // Desteklemeyen modeller bu alanı yok sayıyor, zararı yok.
    think: !!sec.dusunme,
    options: secenekler,
    // Model bellekte ne kadar kalsın. Kısa tutmak VRAM'i geri verir —
    // tasarımdaki "boşta kaynak yeme" kuralı.
    keep_alive: sec.keepAlive || '5m',
  }, sec.zamanAsimi || 120000);

  let metin = (cevap.message && cevap.message.content) || '';

  // Bazı modeller (Qwen3 vb.) düşünme bloğu döndürüyor — kullanıcıya gitmesin.
  metin = metin.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // ⚠️ Ölçüldü: düşünme açıkken qwen3:8b cevabın SONUNA "/think" yapıştırdı
  // ("Destek ile iletişime geçin /think"). Kontrol etiketi, metnin parçası değil.
  metin = metin.replace(/\s*\/(no_?)?think\b/gi, '').trim();

  // ⚠️ ÖLÇÜLDÜ: `qwen3:4b` etiketi think:false'u YOK SAYIYOR ve akıl yürütmesini
  // <think> etiketi olmadan doğrudan cevap alanına basıyor ("Okay, let's tackle
  // this translation request..." diye başlayan 1100+ karakter İngilizce metin).
  // Aynı istek qwen3:8b'de 27 karakterlik doğru çeviri döndürüyor — yani model
  // sorunu, bizim isteğimiz değil. Etiketsiz geldiği için yukarıdaki temizleyici
  // yakalayamıyor; kullanıcıya çöp göstermek yerine adıyla söylüyoruz.
  const sizinti = !sec.dusunme && /^(okay|alright|first,|let me|i need to|so,? the user)\b/i.test(metin);
  return { metin, model, ms: Date.now() - t0, dusunmeSizintisi: sizinti };
}

/** Modeli bellekten at — VRAM'i hemen geri ver. */
async function bosalt(model) {
  try {
    await istek('/api/chat', { model, messages: [], keep_alive: 0 }, 8000);
    return true;
  } catch { return false; }
}

module.exports = { ad: 'ollama', hazirMi, uret, bosalt };
