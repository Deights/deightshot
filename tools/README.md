# tools/ — geliştirme ve ölçüm araçları

Bunlar **ürünün parçası değil.** Uygulama bu klasör olmadan da çalışır;
buradakiler geliştirme sırasında bir şeyi *ölçmek* için yazıldı.

Depoda duruyorlar çünkü çoğu bir kararın kanıtı: "bu neden böyle yapıldı"
sorusunun cevabı genellikle buradaki bir ölçümde.

---

## ⛔ Önce bunu oku: bir araç ekranını yakalar

| Araç | Ekran yakalar mı | Sentetik tuş basar mı |
|---|---|---|
| **`gorsel-test.js`** | 🔴 **EVET** | 🔴 **EVET** |
| diğerlerinin hepsi | hayır | hayır |

`gorsel-test.js` çalıştığı anda ekranında ne varsa diske yazar. Bir kez
gerçekten yaşandı: özel içerik kazara kaydedildi. Merakla çalıştırma;
çalıştıracaksan önce ekranını temizle.

Diğer araçların hiçbiri ekrana bakmaz, tuş üretmez — güvenle koşturulur.

---

## Ne işe yarıyorlar

**Arayüzü gözle doğrulama**
```
npx electron tools/ayarlar-onizleme.js      # ayar penceresinin görüntüsü
npx electron tools/altyazi-onizleme         # satır içi altyazı görüntüsü
```

**OCR ölçümleri** — hangi ölçek, hangi dil, hangi punto çalışıyor
```
node tools/ocr-olcek-testi.js               # büyütme oranı isabeti artırıyor mu
node tools/ocr-dil-karsilastir.js           # diller arası isabet
node tools/ocr-kucuk-punto-testi.js         # küçük puntoda ne bozuluyor
node tools/ocr-koordinat-testi.js           # kelime kutuları metinle hizalı mı
node tools/ocr-dil-secimi/coklu-olc.js      # otomatik dil seçimi algoritması
```

**Çeviri motoru** — hangi model, hangi politika
```
node tools/uzak-motor-testi.js              # motor seçim kuralları (regresyon testi)
node tools/model-karsilastir.js --model <ad>
node tools/satir-ceviri-testi.js --model <ad>
node tools/ollama-ham-probe.js <ad>
```

**Diğer**
```
npx electron tools/yukleme-testi.js         # ana süreç modülleri yükleniyor mu
node tools/ikon-uret.js                     # tepsi ikonlarını ve .ico'yu üretir
node tools/kaynak-testi.js                  # GPU/CPU eşik mantığı
```

⚠️ `npx electron .` **çalıştırma.** Kurulu sürüm açıkken tekil örnek
kilidine takılıp kurulu uygulamada overlay açtırır. Onun yerine
`yukleme-testi.js` kullan.

---

## `ocr-olcek-testi.js` hakkında bir not

Bu test, o an ekranda görünen kelimeleri arar ve kaçını doğru okuduğuna
bakar. Beklenen kelime listesi dosyanın içinde sabit — **başka bir ekranda
çalıştırırsan listeyi kendi ekranına göre güncellemen gerekir**, yoksa
"0 isabet" der ve OCR bozuk sanırsın. Hatanın sebebi OCR değil, listedir.
