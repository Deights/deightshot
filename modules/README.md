# modules/ — eklentiler

Çekirdek (yakalama, overlay, çizim) `src/main/` altında. Buraya **sonradan gelen
yetenekler** girer: OCR metin seçme, sözlük, çeviri, açıkla.

Bu ayrım bilinçli bir tasarım kuralı: çekirdek küçük ve bağımsız kalsın,
yetenekler sonradan takılsın. Böylece ileride ne eklenirse eklensin
çekirdeği baştan yazmak gerekmiyor.

## Bir modül nasıl yazılır

```
modules/
  ornek-modul/
    module.json
    main.js
```

`module.json`:
```json
{
  "id": "ornek-modul",
  "name": "Örnek Modül",
  "description": "Ne yaptığı",
  "version": "1.0.0",
  "main": "main.js",
  "enabled": true
}
```

`main.js`:
```js
function init(ctx) {
  ctx.log('yüklendi');

  // Çekirdek olayları
  ctx.on('kisayol-basildi', () => { /* ... */ });

  // Native yardımcı süreci (OCR burada)
  // ctx.native.cagir('ocr', { path, lang: 'en-US', x, y, w, h })
}

module.exports = { init };
```

## Sıradaki modüller
1. **metin-secme** — çift tık → OCR kelime koordinatlarıyla metin seçme
2. **sozluk** — kelimeye gel, anlamı çıksın (~50MB, anında)
3. **ceviri** — tam cümle çevirisi (takılabilir motor)
4. **acikla** — oyun ayar menüleri için LLM açıklaması
