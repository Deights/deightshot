// OCR dil kodları -> okunabilir ad.
//
// Windows BCP-47 etiketi döndürüyor ve biçim tutarsız: 'tr', 'en-US',
// 'zh-Hans-CN', 'ja' gibi. Bu yüzden tam eşleşme değil ÖN EK eşleşmesi
// yapılıyor — yeni bir dil paketi kurulduğunda kod değiştirmeden adı çıksın.

const ADLAR = [
  ['zh-Hant', 'Çince (geleneksel)'],
  ['zh-Hans', 'Çince (basit)'],
  ['zh',      'Çince'],
  ['ja',      'Japonca'],
  ['ru',      'Rusça'],
  ['ko',      'Korece'],
  ['ar',      'Arapça'],
  ['de',      'Almanca'],
  ['fr',      'Fransızca'],
  ['es',      'İspanyolca'],
  ['it',      'İtalyanca'],
  ['pt',      'Portekizce'],
  ['en',      'İngilizce'],
  ['tr',      'Türkçe'],
];

/** @param {string} kod BCP-47 etiketi */
function ad(kod) {
  if (kod === 'oto') return 'Otomatik';
  if (!kod) return 'Windows profil dili';
  const k = String(kod).toLowerCase();
  for (const [on, isim] of ADLAR) {
    if (k.startsWith(on.toLowerCase())) return `${isim} (${kod})`;
  }
  return kod;
}

/** Kısa rozet metni — overlay'deki dil düğmesi için. */
function kisa(kod) {
  if (kod === 'oto') return 'oto';
  return String(kod || '').split('-')[0] || '—';
}

module.exports = { ad, kisa };
