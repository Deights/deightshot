# DeightShot

**Windows için ekran görüntüsü aracı.** Lightshot'ın yaptığını yapar, üstüne
ekrandaki **metni seçilebilir hâle getirir** (OCR), **mozaik/blur** ile
gizler ve tuşu **basılı tutunca** tam ekranı alır.

> *A Windows screenshot tool with built-in OCR text selection, blur/pixelate,
> and hold-to-fullscreen. Fully offline by default — zero telemetry.*

---

## Ne yapar

| | |
|---|---|
| **Bölge seçimi** | Sürükle · kenardan boyutlandır · içinden taşı · ok tuşlarıyla 1 px |
| **Çizim** | Kalem · ok · çizgi · kutu · daire · vurgulayıcı · metin · **mozaik** · geri al |
| **Metin seçme (OCR)** | Çift tık → ekrandaki yazı **seçilebilir metne** dönüşür, `Ctrl+C` ile kopyalanır |
| **Basılı tut = tam ekran** | `Ins`'e kısa bas → bölge seçimi. 700 ms basılı tut → tam ekran |
| **Çok monitör** | Ekran başına ayrı overlay, DIP↔fiziksel piksel çevrimi |
| **Çeviri** | Seçilen metni satır içi altyazı olarak çevirir (takılabilir motor) |

Kısayol tuşu **yutulur** — `Ins`'e basınca editörde "overtype" modu açılmaz.

## Gizlilik

**Sıfır telemetri.** Uygulama kendiliğinden hiçbir ağ isteği yapmaz.

Tek istisna: kullanıcı Ayarlar'dan uzak çeviri motorunu **açıkça açar** ve
kendi API anahtarını girerse. Kapalıyken ekran metni makineden çıkmaz —
yerel motor (Ollama) çalışmıyor olsa bile dışarı gönderilmez, hata verir.

## Gereksinimler

- Windows 10 20H2+ / Windows 11 (Windows Graphics Capture ve Windows.Media.Ocr için)
- Node.js 18+
- .NET SDK 10 (yalnızca yerel yardımcıyı derlemek için)

Ek OCR dilleri Windows'un kendi dil paketlerinden gelir; Tesseract kullanılmaz.

## Çalıştırma

```bash
npm install
npm run native:build     # C# yardımcı süreci
npm start
```

> ⚠️ VS Code terminalinde `ELECTRON_RUN_AS_NODE=1` tanımlı olabilir. Bu değişken
> varken Electron kendini düz Node sanır ve `require('electron')` API yerine
> dosya yolu döner. Başlatmadan önce temizle.

## Paketleme

```bash
npm run native:publish   # self-contained C# yardımcısı -> dist-native/
npm run paket            # -> dist/deightshot-kurulum-<sürüm>.exe
```

Kurulum dosyası imzasız olduğu için Windows Smart App Control açıksa
engellenebilir. Kurulum gerektirmeyen taşınabilir sürüm:

```bash
npm run paket:dizin      # -> dist/win-unpacked/
```

Klasörü olduğu gibi kopyalayıp `DeightShot.exe`'yi çalıştırmak yeterli —
kurulum yok, yönetici yetkisi gerekmiyor.

## Mimari

```
Electron (arayüz, overlay, çizim)
   │  satır-JSON, stdin/stdout
   ▼
deightshot-native.exe  (C# / .NET)
   ├─ Windows Graphics Capture   yakalama (BitBlt değil — oyunlarda da çalışır)
   ├─ Windows.Media.Ocr          metin tanıma, offline
   └─ WH_KEYBOARD_LL             kısayol; tuşu yutar
```

İki API C#'ta birinci sınıf olduğu için ayrı süreç tercih edildi: NodeRT
bakımsız, C++ addon her Electron sürümünde yeniden derleme demek. Ayrı süreç
ayrıca arayüzü hiç kilitlemiyor.

Çekirdek (yakalama/overlay/çizim) `src/main/` altında; sonradan gelen
yetenekler `modules/<klasör>/` altında eklenti olarak durur.

## Durum

Günlük kullanımda. Bilinen eksikler:

- Son çekilen görüntülerin geçmişi yok
- Altyazı, kopyalanan/kaydedilen görüntüye girmiyor (ayrı DOM katmanı)
- Overlay açıkken tekrar `Ins`'e basmanın davranışı belirlenmedi
- Vurgulayıcı üst üste binince koyulaşıyor

## Lisans

**Lisans yok.** Kaynak kod görünür durumda ama kullanım, değiştirme veya
dağıtım için izin verilmemiştir; tüm hakları saklıdır. Bu bilinçli bir
tercih — lisans sonradan eklenebilir, geri alınamaz.
