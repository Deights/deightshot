// OpenAI-uyumlu uzak LLM ucu — Açıkla için (ve DeepL yoksa çeviri için).
//
// 🔴 GİZLİLİK: ekrandaki metni DIŞARI GÖNDERİR. "Sıfır telemetri" kuralının
// bilinçli istisnası; çağıran taraf kullanıcının bunu açıkça açtığını doğrulamadan
// buraya gelmemeli.
//
// Neden tek bir sağlayıcıya bağlanmıyoruz: ücretsiz katmanlar daralıyor ve
// kapanıyor. Groq, OpenRouter, Google AI Studio'nun uyumluluk ucu, Together,
// hatta yerel bir sunucu — hepsi aynı `/chat/completions` protokolünü
// konuşuyor. URL + anahtar + model yapıştırınca çalışır, biri kapanırsa
// diğerine geçilir, kod değişmez. Tasarımdaki "motor takılabilir" kuralı.
//
// Ollama motoruyla AYNI arayüzü uygular: uret(mesajlar, secenekler).

// 🔴 ÖLÇÜLDÜ — Groq ücretsiz katman, satır çevirisi testiyle
// (tools/satir-ceviri-testi.js).
//
//   openai/gpt-oss-20b   0.5 sn  ✅ ÖNERİLEN — deyimlerde 3/3 doğru
//   openai/gpt-oss-120b  0.8 sn  iyi ama cümleler biraz hantal
//   qwen/qwen3.6-27b     2.8 sn  ❌ düşünmeyi cevaba karıştırıyor
//
// ⚠️ 16 Ağu'da en iyi çıkan `llama-3.3-70b-versatile` 18 Ağu'da hesaptan
// KALDIRILDI (404 model_not_found) — iki gün dayandı. Ücretsiz katmanlar
// böyle değişiyor; motorun sağlayıcıdan bağımsız olması tam bu yüzden şart.
//
// 🔴 Ücretsiz katman sınırı: dakikada 8000 token (TPM). Bir ekran dolusu
// çeviri ~2000 token, yani dakikada 3-4 çeviri. Aşınca 429 geliyor; sunucu
// "şu kadar saniye sonra dene" diyor ve aşağıda otomatik bekleniyor.
const ONERILEN_MODEL = 'openai/gpt-oss-20b';

/** Kullanıcı ucu eksik yazarsa tamamla — "groq.com/openai/v1" da çalışsın. */
function ucDuzelt(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/\/chat\/completions$/.test(u)) u += '/chat/completions';
  return u;
}

async function hazirMi(ayar = {}) {
  const url = ucDuzelt(ayar.apiUrl);
  if (!url) return { hazir: false, sebep: 'API adresi girilmemiş' };
  if (!(ayar.apiAnahtar || '').trim()) return { hazir: false, sebep: 'API anahtarı girilmemiş' };
  if (!(ayar.apiModel || '').trim()) return { hazir: false, sebep: 'API modeli girilmemiş' };
  return { hazir: true, url, model: ayar.apiModel };
}

/**
 * Uçtaki kullanılabilir sohbet modelleri.
 *
 * 🔴 Neden var: 18 Ağu'da Groq bütün Llama modellerini kaldırdı ve ayarda
 * yazan model bir anda 404 oldu. "Model bulunamadı" demek yetmiyor —
 * kullanıcı o an NE kullanabileceğini de görmeli, yoksa sağlayıcının
 * sitesine gidip aramak zorunda kalıyor.
 */
async function modeller(ayar = {}) {
  const taban = ucDuzelt(ayar.apiUrl).replace(/\/chat\/completions$/, '');
  if (!taban) return [];
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(taban + '/models', {
      headers: { Authorization: `Bearer ${String(ayar.apiAnahtar || '').trim()}` },
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    // Sohbet dışı olanları ele: ses, moderasyon, gömme.
    return (j.data || []).map((x) => x.id)
      .filter((id) => !/whisper|tts|guard|orpheus|embed|moderation|rerank/i.test(id));
  } catch { return []; }
}

/** 429 gövdesindeki "try again in 5.48s" ifadesinden bekleme süresini çıkar. */
function beklemeSuresi(mesaj, baslik) {
  const h = parseFloat(baslik || '');
  if (Number.isFinite(h) && h > 0) return Math.min(30000, h * 1000);
  const m = /try again in ([\d.]+)\s*s/i.exec(mesaj || '');
  if (m) return Math.min(30000, parseFloat(m[1]) * 1000 + 300);
  return 0;
}

/**
 * @param {Array<{role:string,content:string}>} mesajlar
 * @param {object} ayar  uygulama ayarları (apiUrl/apiAnahtar/apiModel)
 * @param {{zamanAsimi?:number, enFazlaToken?:number, tekrar?:boolean}} sec
 */
async function uret(mesajlar, ayar = {}, sec = {}) {
  const d = await hazirMi(ayar);
  if (!d.hazir) throw new Error(d.sebep);

  const t0 = Date.now();
  const c = new AbortController();
  const zamanAsimi = sec.zamanAsimi || 45000;
  const t = setTimeout(() => c.abort(), zamanAsimi);

  try {
    const r = await fetch(d.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(ayar.apiAnahtar).trim()}`,
      },
      body: JSON.stringify({
        model: d.model,
        messages: mesajlar,
        temperature: 0.2,
        max_tokens: sec.enFazlaToken || 1400,
        stream: false,
      }),
      signal: c.signal,
    });

    if (!r.ok) {
      // Gövdeyi oku: sağlayıcıların hata mesajı genelde açıklayıcı ve
      // kullanıcının yapabileceği bir şeye işaret ediyor (kota, model adı).
      let ayrinti = '';
      try {
        const j = await r.json();
        ayrinti = (j.error && (j.error.message || j.error.code)) || '';
      } catch { /* gövde JSON değilse boş geç */ }

      if (r.status === 401 || r.status === 403) {
        throw new Error('API anahtarı reddedildi. Ayarlardan kontrol et.');
      }
      if (r.status === 429) {
        // Sunucu ne kadar bekleneceğini söylüyor — kullanıcıya hata basmak
        // yerine bir kez bekleyip tekrar dene. Ücretsiz katmanda dakikalık
        // token sınırı (TPM 8000) normal kullanımda da ara sıra çarpıyor.
        const bekle = beklemeSuresi(ayrinti, r.headers.get('retry-after'));
        if (bekle && !sec.tekrar) {
          await new Promise((c) => setTimeout(c, bekle));
          return uret(mesajlar, ayar, { ...sec, tekrar: true });
        }
        throw new Error('API kotası doldu ya da çok hızlı istek gitti. ' +
          'Ücretsiz katmanda dakikalık token sınırı var — biraz bekle.' +
          (ayrinti ? ` (${ayrinti})` : ''));
      }
      if (r.status === 404) {
        // Sağlayıcı modeli kaldırmış olabilir (Groq 18 Ağu'da Llama'ları
        // kaldırdı). Ne kullanılabileceğini burada söyle — kullanıcı ayar
        // penceresinden tek satırda düzeltsin.
        const liste = await modeller(ayar);
        const oneri = liste.length
          ? ` Şu an kullanılabilenler: ${liste.slice(0, 8).join(', ')}.`
          : '';
        throw new Error(`"${d.model}" bu uçta yok — sağlayıcı kaldırmış olabilir.` +
          oneri + ' Ayarlar → LLM ucu → Model alanına yenisini yaz.');
      }
      throw new Error(`API HTTP ${r.status}${ayrinti ? ' — ' + ayrinti : ''}`);
    }

    const j = await r.json();
    const secim = (j.choices && j.choices[0]) || {};
    let metin = (secim.message && secim.message.content) || '';

    // Bazı modeller düşünme bloğu döndürüyor — kullanıcıya gitmesin.
    // (Yerel tarafta qwen3 bunu yapıyordu; uzak uçlarda da aynı aile var.)
    metin = metin.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (secim.finish_reason === 'length') {
      // Sessizce yarım cevap göstermektense söyle.
      metin += '\n\n[cevap uzunluk sınırına takıldı]';
    }

    return {
      metin,
      model: j.model || d.model,
      ms: Date.now() - t0,
      token: j.usage ? j.usage.total_tokens : undefined,
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`API ${Math.round(zamanAsimi / 1000)} saniyede cevap vermedi.`);
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(e.message || '')) {
      throw new Error('API adresine ulaşılamadı — internet bağlantısını ve adresi kontrol et.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  ad: 'api', hazirMi, uret, ucDuzelt, modeller, ONERILEN_MODEL,
  cevirebilir: true, aciklayabilir: true,
};
