// Ayarlar — userData altında düz JSON. Kısayol ve basılı tutma süresi buradan.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const VARSAYILAN = {
  // uiohook keycode. 3666 = Insert. Ayarlardan değiştirilebilir olacak.
  kisayolKeycode: 3666,
  kisayolAd: 'Ins',

  // Basılı tutma eşiği. Tasarım notu: 600-800ms akıcı, 2sn elde bekletiyor.
  // Ölçüldü: 700ms güvenilir tetikleniyor.
  basiliTutmaMs: 700,

  // OCR dili. 'oto' = dili kendisi bulur (ölçüldü 8/8, tools/ocr-dil-secimi).
  //
  // Nasıl: her OCR motoru yalnızca kendi alfabesini üretebiliyor. Latin motoru
  // '游戏' yazamaz. Önce Latin-dışı motorlar denenip imza alfabesi (Kana/Han/
  // Kiril) arıyoruz; hiçbiri tutmazsa Latin'dir ve tr↔en ayrımına geçiyoruz.
  //
  // ⚠️ Bir süre 'en-US' sabitti ve TÜRKÇE metinleri bozdu
  // ("beğenmediğim" -> "beöenmediöim"). Sabit dil iki senaryoyu birden çözmüyor.
  // '' (profil dili) ve tek tek diller hâlâ elle seçilebiliyor.
  ocrDil: 'oto',

  // OCR öncesi büyütme. Ölçüldü: 1.5x en iyi (14/19 -> 17/19, +15 ms).
  // 2x ve 3x DAHA KÖTÜ — fazla büyütme kaliteyi düşürüyor.
  ocrOlcek: 1.5,

  // Çeviri motoru — boş ise kurulu modeller arasından otomatik seçilir.
  ceviriModel: '',
  // Model Ollama belleğinde ne kadar kalsın. Kısa tutmak VRAM'i geri verir.
  ceviriBellekteKalsin: '5m',
  // Qwen3 gibi modellerde "düşünme" modu. Ölçüldü: kapalıyken 4-5 kat hızlı
  // (12s -> 1s) ama deyimsel cümlelerde çeviri biraz daha kötü.
  // Asıl çözüm doğru modeli seçmek; bu sadece takası ayarlanabilir tutuyor.
  ceviriDusunme: false,

  // --- UZAK MOTORLAR (varsayılan KAPALI) ---
  //
  // 🔴 Tasarımın 1. kuralı: sıfır telemetri. Uygulama kendiliğinden hiçbir ağ
  // isteği yapmaz. Buradaki alanlar o kuralın TEK istisnası ve istisna
  // sessiz olmamalı: kapalı gelirler, kullanıcı elle açar, açıkken overlay'de
  // "metin dışarı gidiyor" göstergesi durur.
  //
  // Neden var: oyun açıkken GPU dolu, yerel model CPU'ya düşüp kullanılamıyor
  // (ölçüldü: 138 sn).
  uzakAcik: false,

  // Çeviri için DeepL. Ücretsiz katman ~500.000 karakter/ay — bir ekran
  // görüntüsü 200-500 karakter, yani ayda ~1000-2500 çeviri.
  // Saf çeviri motoru: "Çevir" yapar, "Açıkla" YAPAMAZ (LLM değil).
  deeplAnahtar: '',
  // Ücretsiz anahtarlar ":fx" ile biter ve api-free ucunu kullanır.
  // Boş bırakılırsa anahtarın şekline bakıp kendisi seçer.
  deeplUc: '',

  // Açıklama (ve DeepL yoksa çeviri) için OpenAI-uyumlu herhangi bir uç.
  // Tek bir sağlayıcıya bağlanmıyoruz: ücretsiz katmanlar daralıp kapanıyor.
  // Groq, OpenRouter, Google AI Studio (uyumluluk ucu) ve yerel sunucular
  // aynı protokolü konuşuyor — URL + anahtar + model yapıştırınca çalışır.
  apiUrl: '',
  apiAnahtar: '',
  apiModel: '',

  // Uzak motor ne zaman devreye girsin:
  //   'oyunda'  — sadece yerel GPU doluyken (varsayılan, en az veri çıkışı)
  //   'hep'     — her zaman uzak (yerel model hiç çalışmaz)
  uzakNeZaman: 'oyunda',

  // Kısayol tuşunu odaktaki uygulamadan gizle (yut).
  // Açıkken Ins'e basmak editörde OVR modunu AÇMAZ. Sadece native hook'ta çalışır.
  tusuYut: true,

  // Yakalanan görsel kaydedilirken varsayılan klasör
  kayitKlasoru: null, // null => Resimler/deightshot

  // Overlay karartma yoğunluğu (0-1)
  karartma: 0.45,

  // Windows açılışında kendiliğinden başlasın (tray'de bekler)
  otomatikBaslat: false,
};

let mevcut = { ...VARSAYILAN };
let dosya = null;

/* ── Tek seferlik gec: shot88 -> DeightShot ─────────────────────────
   Urun adi degisince Electron'un userData yolu da degisiyor:
   %APPDATA%\shot88  ->  %APPDATA%\DeightShot

   Gec yapilmazsa kullanici uygulamayi FABRIKA AYARLARINDA gorur —
   kisayol tusu, basili tutma esigi, kayit klasoru, hepsi gider.
   Yeniden adlandirmanin en kolay gozden kacan bedeli budur: kod
   calisir, hata vermez, ama kullanici her seyini kaybeder.

   Iki emniyet:
     1. Yalnizca YENI dosya yokken calisir — mevcut ayarin uzerine yazmaz.
     2. Eski dosya SILINMEZ — geri donus yolu acik kalir.
   Eski urun adi bilincli olarak sabit yazildi; tarihsel bir degerdir. */
function eskiAyarlariTasi(hedef) {
  try {
    if (fs.existsSync(hedef)) return;              // yeni ayar zaten var
    const eski = path.join(app.getPath('appData'), 'shot88', 'ayarlar.json');
    if (!fs.existsSync(eski)) return;              // gececek bir sey yok
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.copyFileSync(eski, hedef);
    console.log('[ayarlar] onceki surumden tasindi:', eski);
  } catch (e) {
    console.error('[ayarlar] gec basarisiz, varsayilanlarla devam:', e.message);
  }
}

function init() {
  dosya = path.join(app.getPath('userData'), 'ayarlar.json');
  eskiAyarlariTasi(dosya);
  try {
    const ham = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    mevcut = { ...VARSAYILAN, ...ham };
  } catch {
    // ilk çalıştırma — varsayılanlarla devam
  }
  if (!mevcut.kayitKlasoru) {
    mevcut.kayitKlasoru = path.join(app.getPath('pictures'), 'deightshot');
  }
}

function get() {
  return mevcut;
}

function set(patch) {
  mevcut = { ...mevcut, ...patch };
  try {
    fs.mkdirSync(path.dirname(dosya), { recursive: true });
    fs.writeFileSync(dosya, JSON.stringify(mevcut, null, 2), 'utf8');
  } catch (e) {
    console.error('[ayarlar] yazılamadı:', e.message);
  }
  return mevcut;
}

module.exports = { init, get, set, VARSAYILAN };
