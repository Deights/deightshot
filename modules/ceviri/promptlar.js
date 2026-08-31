// Çeviri ve açıklama promptları.
//
// 🔴 HALÜSİNASYON SINIRI — tasarımın sert kuralı:
// Model SADECE ekranda gördüğü metin hakkında konuşur. Oyun senaryosu, hikâye
// sonucu, "bu seçeneği seçersen ölürsün" gibi iddialar YASAK — küçük modeller
// tam da böyle şeylerde uyduruyor ve gayet emin tonda söylüyor.
//
// Ama dikkat: bu yasak OYUNA ÖZGÜ iddialar için. "Motion Blur nedir" sorusu
// genel teknik bilgi ve asıl istenen şey o. İkisini ayırmak şart,
// yoksa "Açıkla" özelliği işe yaramaz hale gelir.

// ⚠️ İlk sürümde "teknik terimleri İngilizce bırak" kuralı fazla geniş
// yorumlandı ve model İngilizce cümleyi olduğu gibi geri döndürdü.
// Bu yüzden "TAMAMINI çevir" kuralı en başa ve en sert şekilde yazıldı,
// istisna dar tutuldu.
const CEVIRI_SISTEM = `Sen bir çevirmensin. Sana ekran görüntüsünden alınmış metin verilecek.

EN ÖNEMLİ KURAL: Metnin TAMAMINI hedef dile çevir. Cümleleri asla olduğu gibi
bırakma. Çıktın hedef dilde olmalı — kaynak dilde cümle kalmamalı.

Tek istisna (sadece bunlar olduğu gibi kalır):
- Kişi, yer, marka, şirket ve ürün adları (Arasaka, Windows, Steam)
- Yerleşik teknik ayar terimleri (V-Sync, Motion Blur, Anti-Aliasing, FPS, ray tracing)
Bu istisna SADECE tek tek terimler için geçerlidir, cümleler için değil.

Diğer kurallar:
- Metin bir arayüzden alındığı için kopuk olabilir. Olmayan kelimeyi tamamlama, uydurma.
- SADECE çeviriyi yaz. "İşte çeviri:" gibi giriş cümlesi, başlık ya da açıklama ekleme.
- Metnin satır yapısını koru.`;

const ACIKLA_SISTEM = `Sana bir ekran görüntüsünden alınmış metin verilecek. Görevin bu metni Türkçe AÇIKLAMAK — sadece çevirmek değil.

YAPMAN GEREKEN:
- Metinde geçen teknik terimlerin ne olduğunu anlat (örn. "Motion Blur: kamera hızlı dönerken görüntüyü bulanıklaştırır; sinematik durur ama hedef takibini zorlaştırır, rekabetçi oyunda kapatılması önerilir").
- Bir ayar söz konusuysa ne işe yaradığını, açık/kapalı olmasının pratikte ne değiştirdiğini söyle.
- Seçenekler varsa aralarındaki farkı belirt (bu daha agresif, bu daha uzlaşmacı gibi).
- Metnin tonunu ve ne ima ettiğini açıklayabilirsin.

🔴 KESİNLİKLE YAPMAYACAKLARIN:
- Metinde OLMAYAN olay, karakter, hikâye ya da sonuç uydurma.
- "Bu seçeneği seçersen şu olur", "bu karakter sonra şunu yapar", "bu görevi kaçırırsan şunu kaybedersin" gibi OYUNA ÖZGÜ sonuç iddiasında BULUNMA. O oyunu bilmiyorsun.
- Emin olmadığın şeyi emin gibi söyleme. Bilmiyorsan "metinden bu anlaşılmıyor" de.

Genel teknik bilgi vermek serbest (bir grafik ayarının ne yaptığı gibi).
Bu belirli oyunun/uygulamanın içeriği hakkında tahmin yürütmek yasak.

Kısa ve net yaz. Madde işareti kullanabilirsin. Gereksiz giriş cümlesi kurma.`;

/** @param {string} metin @param {string} hedef ISO dil kodu */
function ceviriMesajlari(metin, hedef = 'tr') {
  const dilAdi = { tr: 'Türkçe', en: 'İngilizce' }[hedef] || hedef;
  return [
    { role: 'system', content: CEVIRI_SISTEM },
    { role: 'user', content: `Aşağıdaki metni ${dilAdi} diline çevir:\n\n---\n${metin}\n---` },
  ];
}

// Satır içi (altyazı) çeviri — tasarım kararı: çeviri, kaynak satırın yanında dursun.
// Yan panelde blok halinde vermek "hangi kelime hangisi" sorusunu doğuruyordu.
//
// ⚠️ Buradaki zor kısım HİZALAMA: çıktı satır sayısı girdiyle BİREBİR aynı olmalı,
// yoksa çeviriler yanlış satırın altına düşer — sessiz ve kötü bir hata.
// Bu yüzden numaralı format zorlanıyor ve sayı tutmazsa çağıran taraf reddediyor.
// ⚠️ ÖLÇÜLDÜ: ilk sürümde "tek başına anlamsız bir satırı olabildiğince BİREBİR
// çevir" yazıyordu. Bu talimat modeli kelimesi kelimesine çeviriye itti ve
// deyimleri öldürdü — aynı model blok kipte "Ona güvenmemelisin." derken
// satır kipinde "Ona güvenmekle daha iyi yapardın." (tam tersi) dedi.
// Satırlar zaten hep birlikte gönderiliyor, yani BAĞLAM MODELDE VAR;
// sorun onu kullanmasını yasaklamamızdı.
const SATIR_SISTEM = `Sen bir çevirmensin. Sana numaralanmış satırlar verilecek. Bu satırlar aynı ekrandan geliyor ve BİRLİKTE tek bir metin oluşturuyor.

ÇIKTI BİÇİMİ (kesin kural):
- Her girdi satırı için TEK bir çıktı satırı yaz.
- Satırı aynı numarayla başlat, ardından "|" ve çeviri. Örnek: 3|Çeviri metni
- Girdide kaç satır varsa çıktıda TAM olarak o kadar satır olsun. Satır birleştirme, bölme ya da atlama YOK.
- Başlık, giriş cümlesi, açıklama, boş satır ekleme.

ÇEVİRİ KURALLARI:
- ÖNCE bütün satırları oku, metnin neyden bahsettiğini anla. Bir satırı çevirirken
  komşu satırları bağlam olarak kullan.
- ANLAMI çevir, kelimeleri değil. Deyimleri Türkçede aynı anlama gelen doğal
  karşılıklarıyla ver; kelimesi kelimesine çeviri YAPMA.
  Örnek: "You should have known better than to trust him."
    ✅ "Ona güvenmemen gerektiğini bilmeliydin."
    ❌ "Ona güvenmekle daha iyi yapardın."  (kelime kelime, anlamı ters)
- Türkçesi doğal ve akıcı olsun; bir insan öyle söyler mi diye kontrol et.
- Satırın TAMAMINI hedef dile çevir; kaynak dilde cümle bırakma.
- Satırlar bir arayüzden geldiği için kopuk olabilir. Eksik kelimeyi TAMAMLAMA,
  olmayan bilgi UYDURMA. Sadece yazanı çevir.
- Olduğu gibi kalanlar: kişi/yer/marka/ürün adları ve yerleşik ayar terimleri
  (V-Sync, Motion Blur, Anti-Aliasing, FPS). Bu istisna sadece TERİMLER için.
- Çevrilecek bir şey yoksa (sayı, tek sembol) satırı olduğu gibi geri yaz.`;

/**
 * @param {string[]} satirlar
 * @param {string} hedef ISO dil kodu
 */
function satirCeviriMesajlari(satirlar, hedef = 'tr') {
  const dilAdi = { tr: 'Türkçe', en: 'İngilizce' }[hedef] || hedef;
  const govde = satirlar.map((s, i) => `${i + 1}|${s}`).join('\n');
  return [
    { role: 'system', content: SATIR_SISTEM },
    {
      role: 'user',
      content: `Aşağıdaki ${satirlar.length} satırı ${dilAdi} diline çevir. ` +
        `Çıktı tam ${satirlar.length} satır olmalı.\n\n${govde}`,
    },
  ];
}

/**
 * Modelin numaralı çıktısını satır dizisine çevirir.
 * Sayı tutmazsa null döner — çağıran yan panele düşsün, YANLIŞ HİZALAMA GÖSTERME.
 * @returns {string[]|null}
 */
function satirCeviriAyristir(cikti, beklenen) {
  const satirlar = String(cikti || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const sonuc = new Array(beklenen).fill(null);
  let eslesen = 0;
  for (const s of satirlar) {
    const m = /^(\d+)\s*[|:.\-]\s*(.*)$/.exec(s);
    if (!m) continue;
    const i = +m[1] - 1;
    if (i < 0 || i >= beklenen || sonuc[i] !== null) continue;
    sonuc[i] = m[2].trim();
    eslesen++;
  }

  // Numaralamayı hiç kullanmamış ama satır sayısı tutuyorsa sırayla eşle.
  if (eslesen === 0 && satirlar.length === beklenen) return satirlar;

  // Tek bir satır bile eksikse hizalama şüpheli — kabul etme.
  if (eslesen < beklenen) return null;
  return sonuc;
}

function aciklaMesajlari(metin) {
  return [
    { role: 'system', content: ACIKLA_SISTEM },
    { role: 'user', content: `Ekrandan alınan metin:\n\n---\n${metin}\n---\n\nBu ne anlama geliyor?` },
  ];
}

module.exports = {
  ceviriMesajlari, aciklaMesajlari,
  satirCeviriMesajlari, satirCeviriAyristir,
  CEVIRI_SISTEM, ACIKLA_SISTEM, SATIR_SISTEM,
};
