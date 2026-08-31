// Kısayol olarak atanabilecek tuşlar — TEK kaynak.
// Hem kısayol motoru (hotkeys.js) hem ayar arayüzü buradan besleniyor;
// iki ayrı liste tutulsaydı biri güncellenip diğeri unutulurdu.
//
// 🔴 Neden sadece bu tuşlar: kısayol tuşu YUTULUYOR (tusuYut), yani odaktaki
// uygulamaya hiç gitmiyor. Harf/rakam atansaydı o tuş sistem genelinde
// yazılamaz hale gelirdi. Buradakiler normal yazıda kullanılmayan tuşlar.
//
// `code`    : DOM KeyboardEvent.code — ayar penceresi tuşu böyle tanıyor
// `uiohook` : uiohook-napi keycode  — yedek motor
// `vk`      : Windows sanal tuş kodu — native hook (tercih edilen motor)

const TUSLAR = [
  { code: 'Insert',      uiohook: 3666, vk: 0x2D, ad: 'Ins' },
  { code: 'PrintScreen', uiohook: 3639, vk: 0x2C, ad: 'PrtScn' },
  { code: 'Pause',       uiohook: 3653, vk: 0x13, ad: 'Pause' },
  { code: 'ScrollLock',  uiohook: 70,   vk: 0x91, ad: 'ScrLk' },
  { code: 'F1',  uiohook: 59, vk: 0x70, ad: 'F1' },
  { code: 'F2',  uiohook: 60, vk: 0x71, ad: 'F2' },
  { code: 'F3',  uiohook: 61, vk: 0x72, ad: 'F3' },
  { code: 'F4',  uiohook: 62, vk: 0x73, ad: 'F4' },
  { code: 'F5',  uiohook: 63, vk: 0x74, ad: 'F5' },
  { code: 'F6',  uiohook: 64, vk: 0x75, ad: 'F6' },
  { code: 'F7',  uiohook: 65, vk: 0x76, ad: 'F7' },
  { code: 'F8',  uiohook: 66, vk: 0x77, ad: 'F8' },
  { code: 'F9',  uiohook: 67, vk: 0x78, ad: 'F9' },
  { code: 'F10', uiohook: 68, vk: 0x79, ad: 'F10' },
  { code: 'F11', uiohook: 87, vk: 0x7A, ad: 'F11' },
  { code: 'F12', uiohook: 88, vk: 0x7B, ad: 'F12' },
];

// ⚠️ Windows'un kendi kullandığı tuşlar — atanabilir ama uyarı gösterilir.
const CAKISMA = {
  PrintScreen: 'Windows Ekran Alıntısı da bu tuşu kullanıyor olabilir',
  F12: 'Tarayıcı/geliştirici araçları F12 kullanıyor',
  F1: 'Çoğu uygulamada Yardım tuşu',
  F5: 'Çoğu uygulamada Yenile tuşu',
};

const koduBul = (uiohook) => TUSLAR.find((t) => t.uiohook === uiohook) || null;
const domKoduBul = (code) => TUSLAR.find((t) => t.code === code) || null;

/** hotkeys.js'in beklediği { uiohookKeycode: vk } tablosu. */
const vkTablosu = () => Object.fromEntries(TUSLAR.map((t) => [t.uiohook, t.vk]));

module.exports = { TUSLAR, CAKISMA, koduBul, domKoduBul, vkTablosu };
