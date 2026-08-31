// Tray ikonu üretici — dışarıdan görsel dosyası taşımamak için.
// Koyu yuvarlak kare + beyaz "seçim çerçevesi" köşeleri (aracın işi bu).
// Çalıştır: node tools/ikon-uret.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function pngYaz(genislik, yukseklik, pikselFn, hedef) {
  // Ham RGBA satırları (her satırın başına filtre baytı 0)
  const satirBoyu = genislik * 4 + 1;
  const ham = Buffer.alloc(satirBoyu * yukseklik);
  for (let y = 0; y < yukseklik; y++) {
    ham[y * satirBoyu] = 0;
    for (let x = 0; x < genislik; x++) {
      const [r, g, b, a] = pikselFn(x, y);
      const o = y * satirBoyu + 1 + x * 4;
      ham[o] = r; ham[o + 1] = g; ham[o + 2] = b; ham[o + 3] = a;
    }
  }

  const parca = (tip, veri) => {
    const uz = Buffer.alloc(4);
    uz.writeUInt32BE(veri.length);
    const govde = Buffer.concat([Buffer.from(tip, 'ascii'), veri]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(govde) >>> 0);
    return Buffer.concat([uz, govde, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(genislik, 0);
  ihdr.writeUInt32BE(yukseklik, 4);
  ihdr[8] = 8;   // bit derinliği
  ihdr[9] = 6;   // renk tipi: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca('IHDR', ihdr),
    parca('IDAT', zlib.deflateSync(ham, { level: 9 })),
    parca('IEND', Buffer.alloc(0)),
  ]);

  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, png);
  return png.length;
}

let crcTablo = null;
function crc32(buf) {
  if (!crcTablo) {
    crcTablo = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTablo[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTablo[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// --- ikon deseni ---
// Koyu yuvarlatilmis kare zemin + kalin beyaz "D" monogrami (DeightShot).
//
// NEDEN BOYLE (31 Agu 2026, uc tur render edilip GOZLE bakilarak secildi):
//
// * ESKI DESEN ELENDI. Once dort koseye "secim cercevesi" ayraclari vardi.
//   Fikir iyiydi ama 16 pikselde ayraclar birlesip duz bir halkaya donuyor —
//   "secim" fikri tamamen kayboluyor. Kagitta iyi, tepside anlamsiz.
//
// * D'NIN ORANI KRITIK. Ilk denemede D kare bir kutuya cizildi; ic bosluk
//   yatay bir kamaya donustu ve ikon 16 pikselde "D" degil "oynat (play)"
//   gibi okundu. Gercek bir D boyundan DARDIR — en=0.78 orani bunu duzeltti.
//
// * DAHA KALIN DENENDI, ELENDI (tk=0.19): ic bosluk 16 pikselde kapaniyor,
//   harf lekeye donuyor.
//
// * CAMGOBEGI "TARAMA CIZGISI" DENENDI, ELENDI: dikkat cekiyor ama cizgi
//   harfin uzerinden gecip D'yi bozuyor.
//
// * D ICINE METIN SATIRLARI DENENDI, ELENDI: 16 pikselde D'nin ic bosluu
//   ~2 piksel; iki satir oraya sigmiyor, gurultuye donuyor.
//
// Iki renk yeterli: opak koyu zemin sayesinde ikon hem acik hem koyu
// Windows tepsisinde ayni kontrastla duruyor. Vurgu rengi eklenmedi —
// anlam renge bagimli olmamali.
function ikon(N) {
  const rk = 0.22;                                  // zemin kose yuvarlakligi
  const ustpay = 0.12, en = 0.78, tk = 0.16;        // D: pay, genislik orani, kalinlik

  const y0 = Math.round(N * ustpay), y1 = N - 1 - y0;
  const h = y1 - y0, w = Math.round(h * en);
  const x0 = Math.round((N - w) / 2), x1 = x0 + w;
  const t = Math.max(2, Math.round(N * tk));
  const cx = x0 + t, cy = (y0 + y1) / 2;
  const rx = x1 - cx, ry = h / 2;
  const rx2 = rx - t, ry2 = ry - t;

  return (x, y) => {
    // yuvarlatilmis kare zemin
    const r = Math.round(N * rk);
    const icerde =
      (x >= r || y >= r || (x - r) ** 2 + (y - r) ** 2 <= r * r) &&
      (x <= N - 1 - r || y >= r || (x - (N - 1 - r)) ** 2 + (y - r) ** 2 <= r * r) &&
      (x >= r || y <= N - 1 - r || (x - r) ** 2 + (y - (N - 1 - r)) ** 2 <= r * r) &&
      (x <= N - 1 - r || y <= N - 1 - r || (x - (N - 1 - r)) ** 2 + (y - (N - 1 - r)) ** 2 <= r * r);
    if (!icerde) return [0, 0, 0, 0];

    // D govdesi: sol dik kol + sag yarim kavis, ic bosluk ayni orani korur
    const govde = x >= x0 && x <= x1 && y >= y0 && y <= y1 &&
      (x < cx || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
    const bosluk = x >= cx && rx2 > 0 && ry2 > 0 &&
      ((x - cx) / rx2) ** 2 + ((y - cy) / ry2) ** 2 <= 1;

    if (govde && !bosluk) return [245, 245, 245, 255];
    return [24, 24, 27, 235];
  };
}

// --- ICO üretici ---
// electron-builder uygulama ikonu için .ico istiyor (256x256 dahil).
// Windows modern ICO'da PNG gömülü girdileri destekliyor, o yüzden aynı
// PNG üreticisini kullanıp tek kapsayıcıda topluyoruz.
function icoYaz(boyutlar, hedef) {
  const pngler = boyutlar.map((N) => {
    const gecici = path.join(require('os').tmpdir(), `deightshot-ico-${N}.png`);
    pngYaz(N, N, ikon(N), gecici);
    const veri = fs.readFileSync(gecici);
    fs.unlinkSync(gecici);
    return { N, veri };
  });

  const baslik = Buffer.alloc(6);
  baslik.writeUInt16LE(0, 0);              // ayrılmış
  baslik.writeUInt16LE(1, 2);              // tip: 1 = ikon
  baslik.writeUInt16LE(pngler.length, 4);  // girdi sayısı

  const girdiler = Buffer.alloc(16 * pngler.length);
  let ofset = 6 + girdiler.length;

  pngler.forEach((p, i) => {
    const o = i * 16;
    girdiler[o] = p.N >= 256 ? 0 : p.N;      // 256 -> 0 olarak yazılır
    girdiler[o + 1] = p.N >= 256 ? 0 : p.N;
    girdiler[o + 2] = 0;                      // palet yok
    girdiler[o + 3] = 0;                      // ayrılmış
    girdiler.writeUInt16LE(1, o + 4);         // düzlem
    girdiler.writeUInt16LE(32, o + 6);        // bit derinliği
    girdiler.writeUInt32LE(p.veri.length, o + 8);
    girdiler.writeUInt32LE(ofset, o + 12);
    ofset += p.veri.length;
  });

  const ico = Buffer.concat([baslik, girdiler, ...pngler.map((p) => p.veri)]);
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, ico);
  return ico.length;
}

for (const N of [16, 32, 64]) {
  const hedef = path.join(__dirname, '..', 'assets', `tray-${N}.png`);
  const boyut = pngYaz(N, N, ikon(N), hedef);
  console.log(`yazıldı: assets/tray-${N}.png (${boyut} bayt)`);
}

const icoYol = path.join(__dirname, '..', 'assets', 'deightshot.ico');
const icoBoyut = icoYaz([16, 24, 32, 48, 64, 128, 256], icoYol);
console.log(`yazıldı: assets/deightshot.ico (${icoBoyut} bayt, 7 boyut)`);
