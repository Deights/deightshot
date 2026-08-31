#!/usr/bin/env node
/* ============================================================
   IKON URETICI — assets/logo-kaynak.png'den tepsi ikonlarini
   ve uygulama .ico dosyasini uretir.
   ------------------------------------------------------------
   CALISTIR:  node tools/ikon-uret.js

   NEDEN BOYLE:
   Ikon artik kodla CIZILMIYOR, sahibinin cizdigi logodan
   URETILIYOR. Kaynak logo depoda (assets/logo-kaynak.png), yani
   ikon yeniden uretilebilir — "bu ikon nereden geldi" sorusunun
   cevabi kaybolmuyor.

   DIS BAGIMLILIK YOK. PNG cozucu, olcekleyici, PNG yazici ve ICO
   paketleyici bu dosyanin icinde. Sebep: ikon ureticisi ugruna
   projeye goruntu kutuphanesi kurmak, kurulum yukunu her
   gelistiriciye odetir.

   BOYUTA GORE AYAR (uc tur render edilip GOZLE secildi):
   Kucuk boyutlarda PAY BIRAKMAK olumcul. 16 pikselde kenardaki
   iki piksel isaretin okunabilirligini bitiriyordu — olculdu:
   payli surumde 16px bir leke, paysiz surumde ic ice iki form
   secilebiliyor. O yuzden pay boyutla birlikte buyuyor, 16 ve
   24'te sifir.
   ============================================================ */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const KAYNAK = path.join(__dirname, '..', 'assets', 'logo-kaynak.png');
const ASSETS = path.join(__dirname, '..', 'assets');

const ZEMIN = [245, 245, 245];   // karo
const ISARET = [16, 16, 18];     // logo

/* pay: kenar boslugu (piksel) · en: yatay doldurma orani · kose: yuvarlaklik */
/* ⚠️ PAY, YUVARLAK KOSEDEN BUYUK OLMALI.
   Yaricapi r olan bir yuvarlak kosede, kare bir seklin kesilmeden
   sigabilmesi icin gereken en kucuk pay r*(1 - 1/karekok2) ~= 0.293*r.
   kose = 0.20*N oldugu icin bu ~0.06*N eder. Ilk surumde 64 icin pay 3
   verilmisti (gereken ~4) ve isaretin sol ust kosesi karonun yuvarlagina
   takilip KESILIYORDU — render edilip gozle goruldu.
   16 ve 24'te kose yaricapi kucuk (0.14) ve pay birakmak okunabilirligi
   bitirdigi icin bilerek tasma birakiliyor; o boyutta tam doldurmak
   kesilmekten daha iyi duruyor (olculdu). */
const AYAR = {
  16:  { pay: 0,  en: 1.00, kose: 0.14 },
  24:  { pay: 0,  en: 1.00, kose: 0.14 },
  32:  { pay: 2,  en: 0.95, kose: 0.20 },
  48:  { pay: 4,  en: 0.90, kose: 0.20 },
  64:  { pay: 5,  en: 0.88, kose: 0.20 },
  128: { pay: 10, en: 0.86, kose: 0.20 },
  256: { pay: 20, en: 0.86, kose: 0.20 },
};
const TRAY = [16, 32, 64];                       // uygulamanin okudugu boyutlar
const ICO = [16, 24, 32, 48, 64, 128, 256];

/* ---------- PNG cozucu (8 bit, RGBA/RGB/gri, aralikli degil) ---------- */
function pngOku(dosya) {
  const b = fs.readFileSync(dosya);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG degil: ' + dosya);
  let o = 8, W = 0, H = 0, kanal = 0;
  const idat = [];
  while (o < b.length) {
    const uz = b.readUInt32BE(o);
    const tip = b.toString('ascii', o + 4, o + 8);
    const veri = b.slice(o + 8, o + 8 + uz);
    if (tip === 'IHDR') {
      W = veri.readUInt32BE(0);
      H = veri.readUInt32BE(4);
      if (veri[8] !== 8) throw new Error('yalniz 8 bit derinlik destekleniyor');
      if (veri[12] !== 0) throw new Error('aralikli (interlaced) PNG desteklenmiyor');
      const renkTipi = veri[9];
      kanal = renkTipi === 6 ? 4 : renkTipi === 2 ? 3 : renkTipi === 0 ? 1 : 0;
      if (!kanal) throw new Error('desteklenmeyen renk tipi: ' + renkTipi);
    } else if (tip === 'IDAT') idat.push(veri);
    else if (tip === 'IEND') break;
    o += 12 + uz;
  }
  const ham = zlib.inflateSync(Buffer.concat(idat));
  const satir = W * kanal;
  const px = Buffer.alloc(W * H * kanal);
  let onceki = Buffer.alloc(satir);
  for (let y = 0; y < H; y++) {
    const f = ham[y * (satir + 1)];
    const s = ham.slice(y * (satir + 1) + 1, y * (satir + 1) + 1 + satir);
    const c = Buffer.alloc(satir);
    for (let i = 0; i < satir; i++) {
      const a = i >= kanal ? c[i - kanal] : 0;
      const bb = onceki[i];
      const cc = i >= kanal ? onceki[i - kanal] : 0;
      let v;
      if (f === 0) v = s[i];
      else if (f === 1) v = s[i] + a;
      else if (f === 2) v = s[i] + bb;
      else if (f === 3) v = s[i] + ((a + bb) >> 1);
      else if (f === 4) {
        const p = a + bb - cc;
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - cc);
        v = s[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc);
      } else throw new Error('bilinmeyen filtre: ' + f);
      c[i] = v & 0xff;
    }
    c.copy(px, y * satir);
    onceki = c;
  }
  return { W, H, kanal, px };
}

/* Logo -> kapsama haritasi (0 = bos, 1 = isaret). Koyu piksel = isaret. */
function kapsama(img) {
  const { W, H, kanal, px } = img;
  const k = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * kanal;
    const r = px[o];
    const g = kanal >= 3 ? px[o + 1] : r;
    const b = kanal >= 3 ? px[o + 2] : r;
    const a = kanal === 4 ? px[o + 3] / 255 : 1;
    const isik = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    k[i] = (1 - isik) * a;
  }
  return k;
}

/* Alan ortalamasiyla kucult — kucultmede en dogru yontem budur.
   Bicubic gibi yontemler buyutmede iyidir; kucultmede alan
   ortalamasi hem daha keskin hem daha az takma desen uretir. */
function kucult(kap, W, H, yeniW, yeniH) {
  const c = new Float32Array(yeniW * yeniH);
  for (let y = 0; y < yeniH; y++) {
    const y0 = (y * H) / yeniH, y1 = ((y + 1) * H) / yeniH;
    for (let x = 0; x < yeniW; x++) {
      const x0 = (x * W) / yeniW, x1 = ((x + 1) * W) / yeniW;
      let top = 0, agirlik = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const ay = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const ax = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const alan = ay * ax;
          top += kap[sy * W + sx] * alan;
          agirlik += alan;
        }
      }
      c[y * yeniW + x] = agirlik ? top / agirlik : 0;
    }
  }
  return c;
}

/* Yuvarlatilmis kare kapsamasi — kenar yumusatma icin 4x4 ornekleme */
function karoKapsama(N, r) {
  const k = new Float32Array(N * N);
  const icerde = (x, y) =>
    (x >= r || y >= r || (x - r) ** 2 + (y - r) ** 2 <= r * r) &&
    (x <= N - r || y >= r || (x - (N - r)) ** 2 + (y - r) ** 2 <= r * r) &&
    (x >= r || y <= N - r || (x - r) ** 2 + (y - (N - r)) ** 2 <= r * r) &&
    (x <= N - r || y <= N - r || (x - (N - r)) ** 2 + (y - (N - r)) ** 2 <= r * r);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) if (icerde(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) s++;
      }
      k[y * N + x] = s / 16;
    }
  }
  return k;
}

/* ---------- PNG yazici ---------- */
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
function pngYaz(N, pikselFn) {
  const satirBoyu = N * 4 + 1;
  const ham = Buffer.alloc(satirBoyu * N);
  for (let y = 0; y < N; y++) {
    ham[y * satirBoyu] = 0;
    for (let x = 0; x < N; x++) {
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
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca('IHDR', ihdr),
    parca('IDAT', zlib.deflateSync(ham, { level: 9 })),
    parca('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- tek boyut uret ---------- */
function ikonUret(kap, W, H, N) {
  const { pay, en, kose } = AYAR[N];
  const ic = N - 2 * pay;
  const hedefH = ic;
  const hedefW = Math.max(1, Math.round(ic * en));
  const kucuk = kucult(kap, W, H, hedefW, hedefH);
  const ox = Math.round((N - hedefW) / 2);
  const oy = Math.round((N - hedefH) / 2);
  const karo = karoKapsama(N, N * kose);
  return pngYaz(N, (x, y) => {
    const kk = karo[y * N + x];
    if (kk <= 0) return [0, 0, 0, 0];
    const mx = x - ox, my = y - oy;
    const m = (mx >= 0 && my >= 0 && mx < hedefW && my < hedefH) ? kucuk[my * hedefW + mx] : 0;
    const r = Math.round(ZEMIN[0] * (1 - m) + ISARET[0] * m);
    const g = Math.round(ZEMIN[1] * (1 - m) + ISARET[1] * m);
    const b = Math.round(ZEMIN[2] * (1 - m) + ISARET[2] * m);
    return [r, g, b, Math.round(kk * 255)];
  });
}

/* ---------- ICO paketleyici ----------
   Windows modern ICO'da PNG gomulu girdileri destekliyor, o yuzden
   ayni PNG ureticisi kullanilip tek kapsayicida toplaniyor. */
function icoYaz(pngler, hedef) {
  const baslik = Buffer.alloc(6);
  baslik.writeUInt16LE(0, 0);
  baslik.writeUInt16LE(1, 2);
  baslik.writeUInt16LE(pngler.length, 4);
  const girdiler = Buffer.alloc(16 * pngler.length);
  let ofset = 6 + girdiler.length;
  pngler.forEach((p, i) => {
    const o = i * 16;
    girdiler[o] = p.N >= 256 ? 0 : p.N;        // 256 -> 0 olarak yazilir
    girdiler[o + 1] = p.N >= 256 ? 0 : p.N;
    girdiler.writeUInt16LE(1, o + 4);
    girdiler.writeUInt16LE(32, o + 6);
    girdiler.writeUInt32LE(p.veri.length, o + 8);
    girdiler.writeUInt32LE(ofset, o + 12);
    ofset += p.veri.length;
  });
  const ico = Buffer.concat([baslik, girdiler, ...pngler.map((p) => p.veri)]);
  fs.writeFileSync(hedef, ico);
  return ico.length;
}

/* ---------- calistir ---------- */
if (!fs.existsSync(KAYNAK)) {
  console.error('✗ kaynak logo bulunamadi:', KAYNAK);
  process.exit(2);
}
const img = pngOku(KAYNAK);
const kap = kapsama(img);
console.log(`kaynak: assets/logo-kaynak.png  ${img.W}x${img.H}`);

for (const N of TRAY) {
  const veri = ikonUret(kap, img.W, img.H, N);
  fs.writeFileSync(path.join(ASSETS, `tray-${N}.png`), veri);
  console.log(`yazildi: assets/tray-${N}.png (${veri.length} bayt)`);
}
const icoParcalari = ICO.map((N) => ({ N, veri: ikonUret(kap, img.W, img.H, N) }));
const icoBoyut = icoYaz(icoParcalari, path.join(ASSETS, 'deightshot.ico'));
console.log(`yazildi: assets/deightshot.ico (${icoBoyut} bayt, ${ICO.length} boyut)`);
