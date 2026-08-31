// Overlay davranışı — bölge seçimi, çizim araçları, blur, dışa aktarım.
//
// Koordinatlar burada DIP (CSS pikseli). Kare fiziksel pikselde geliyor;
// ölçek farkı `olcek` ile köprüleniyor. Ölçekli monitörde kaymasın diye
// dışa aktarım FİZİKSEL çözünürlükte yapılıyor — kalite kaybı olmasın.

const elKare    = document.getElementById('kare');
const elCizim   = document.getElementById('cizim');
const elPerde   = document.getElementById('perde');
const elSecim   = document.getElementById('secim');
const elOlcu    = document.getElementById('olcu');
const elIpucu   = document.getElementById('ipucu');
const elNisanX  = document.getElementById('nisanX');
const elNisanY  = document.getElementById('nisanY');
const elAraclar = document.getElementById('araclar');
const elStil    = document.getElementById('stil');
const elIslem   = document.getElementById('islemler');
const elMetin   = document.getElementById('metinGiris');
const elMKat    = document.getElementById('metinKatman');
const elMIpucu  = document.getElementById('metinIpucu');
const elMSayi   = document.getElementById('metinSayi');
const elDilBtn  = document.getElementById('dilDegistir');
const elDilAd   = document.getElementById('dilAd');
const elAiPanel = document.getElementById('aiPanel');
const elAiTip   = document.getElementById('aiTip');
const elAiBilgi = document.getElementById('aiBilgi');
const elAiGovde = document.getElementById('aiGovde');
const elAiKapat = document.getElementById('aiKapat');
const elAiKopya = document.getElementById('aiKopyala');
const elCevKat  = document.getElementById('ceviriKat');

const ctx = elCizim.getContext('2d');
const mctx = elMKat.getContext('2d');
const tmp = document.createElement('canvas');       // mozaik için küçük ara tuval
const tctx = tmp.getContext('2d');

let displayId = null;
let dipGenislik = window.innerWidth;
let dipYukseklik = window.innerHeight;
let fizGenislik = dipGenislik;
let fizYukseklik = dipYukseklik;
let olcek = 1;                    // fiziksel / DIP

let kareBitmap = null;            // ImageBitmap — mozaik ve dışa aktarım için
let kareUrl = null;

/** {x,y,w,h} DIP — null ise henüz seçim yok */
let secim = null;
let mod = null;                   // 'ciziyor' | 'tasiyor' | 'boyutluyor' | 'arac'
let baslangic = null;
let yon = null;
let kilit = false;
let sonFare = { x: 0, y: 0 };

// --- çizim durumu ---
let arac = 'yok';
let renk = '#ff3b30';
let kalinlik = 4;
let sekiller = [];                // geri al için sıralı liste
let aktifSekil = null;
let metinDuzenleniyor = null;

const MOZAIK_BLOK = 11;           // DIP — redaksiyon için yeterince kaba

// --- OCR / metin modu durumu ---
let metinModu = false;
let ocrSozu = null;               // Promise — seçim biter bitmez başlar
let kelimeler = [];               // [{metin, satir, sira, x, y, w, h}]
let kelimeSecim = null;           // {a, b} — kelimeler[] içinde kapsayıcı aralık
let metinSuruklu = false;
let metinAnchor = null;           // sürükleme başladığı kelime — seçim buradan büyür
let sonTikZamani = 0;
let sonTikSayisi = 0;
let diller = [];                  // kurulu OCR dilleri
let dilSecili = undefined;        // undefined = ayardaki varsayılan

// --- AI (çeviri / açıklama) ---
let aiAcik = false;
let aiCalisiyor = false;
let aiSonuc = '';

// --- satır içi çeviri (altyazı) ---
let cevSatirlar = null;           // [{kaynak, ceviri, x, y, w, h}] — DIP
let cevUstune = false;            // false: satırın altında · true: kaynağın üstünde

// ---------------------------------------------------------------- ana süreç

window.deightshot.on('overlay:sifirla', (v) => {
  document.documentElement.style.setProperty('--karartma', String(v.karartma));
  displayId = v.displayId;
  dipGenislik = v.dipGenislik;
  dipYukseklik = v.dipYukseklik;

  kilit = false;
  secim = null;
  mod = null;
  sekiller = [];
  aktifSekil = null;
  metinCikis(false);
  metinModundanCik();
  aiKapat();
  ocrSozu = null;
  kelimeler = [];
  kelimeSecim = null;
  dilSecili = undefined;          // her yakalamada ayardaki varsayılana dön
  aracSec('yok');

  if (kareUrl) { URL.revokeObjectURL(kareUrl); kareUrl = null; }
  if (kareBitmap) { kareBitmap.close(); kareBitmap = null; }
  elKare.classList.remove('gorunur');
  elKare.removeAttribute('src');

  tuvalKur(v.dipGenislik, v.dipYukseklik, 1);

  // Nişangâhı imlecin GERÇEK yerine kur. Eskiden ilk fare hareketine kadar
  // bir önceki oturumdan kalma yerde duruyordu.
  if (v.imlec) { sonFare = { ...v.imlec }; nisanKur(v.imlec.x, v.imlec.y); }
  else nisanGizle();

  ciz();
});

/**
 * 🔴 GİZLİLİK — pencere gizlenirken içeriği sil.
 *
 * Temizlik eskiden `overlay:sifirla` ile GÖSTERME anında yapılıyordu. IPC
 * asenkron olduğu için pencere görünür olduğunda renderer henüz eski kareyi
 * silmemiş oluyordu ve bir önceki ekran görüntüsü ~1 sn ekranda kalıyordu.
 * Kullanımda çıktı: "yanımda biri varken en son ne SS aldığımı unutmuş olabilirim."
 *
 * Gizlerken silince yarış kalmıyor — bir sonraki Ins'e kadar saniyeler var.
 */
window.deightshot.on('overlay:temizle', () => {
  secim = null;
  mod = null;
  sekiller = [];
  aktifSekil = null;
  metinCikis(false);
  metinModundanCik();
  cevKatTemizle();
  aiKapat();
  ocrSozu = null;
  kelimeler = [];
  kelimeSecim = null;

  if (kareUrl) { URL.revokeObjectURL(kareUrl); kareUrl = null; }
  if (kareBitmap) { kareBitmap.close(); kareBitmap = null; }
  elKare.classList.remove('gorunur');
  elKare.removeAttribute('src');

  nisanGizle();
  ciz();
  tuvalCiz();
});

// Donmuş kare geldi — şeffaf katmanın yerine sessizce geç.
// PNG bayt olarak geliyor (file:// olsa canvas "tainted" olur, dışa aktarım patlar).
window.deightshot.on('overlay:kare', async (v) => {
  fizGenislik = v.fizikselGenislik;
  fizYukseklik = v.fizikselYukseklik;
  olcek = v.fizikselGenislik / v.dipGenislik;

  const blob = new Blob([v.png], { type: 'image/png' });
  kareUrl = URL.createObjectURL(blob);
  elKare.onload = () => elKare.classList.add('gorunur');
  elKare.src = kareUrl;

  try { kareBitmap = await createImageBitmap(blob); } catch (e) { console.error('kare çözülemedi', e); }

  tuvalKur(v.dipGenislik, v.dipYukseklik, olcek);
  tuvalCiz();
});

window.deightshot.on('overlay:tum-ekran', () => {
  if (kilit) return;
  metinModundanCik();
  secim = { x: 0, y: 0, w: dipGenislik, h: dipYukseklik };
  mod = null;
  nisanGizle();
  ciz();
  ocrTetikle();
});

window.deightshot.on('overlay:eylem', (eylem) => {
  if (eylem === 'kopyala') gonder('kopyala');
  else if (eylem === 'kaydet') gonder('kaydet');
  else if (eylem === 'temizle') {
    // Esc kademeli: önce AI paneli, sonra metin modu, sonra seçim.
    // (Karar burada veriliyor çünkü globalShortcut tuşu pencereye hiç
    //  ulaştırmıyor — ana süreç panelin açık olduğunu bilemez.)
    // Altyazı en üstteki katman — önce o kalksın, metin modu dursun.
    if (cevSatirlar) { cevKatTemizle(); aiKapat(); return; }
    if (aiAcik) { aiKapat(); return; }
    if (metinModu) { metinModundanCik(); return; }
    secim = null; sekiller = []; ocrSozu = null; kelimeler = [];
    aracSec('yok'); nisanKur(sonFare.x, sonFare.y); ciz(); tuvalCiz();
  }
  else if (eylem === 'nisan-gizle') nisanGizle();
  else if (eylem === 'metin-kopyala') metniPanoyaYaz();
  else if (eylem === 'metin-tumunu-sec') araligiKur(0, kelimeler.length - 1);
  else if (eylem === 'geri') geriAl();
});

// ---------------------------------------------------------------- tuval

function tuvalKur(dw, dh, o) {
  // Arka plan FİZİKSEL çözünürlükte; çizim DIP biriminde yapılıyor.
  elCizim.width = Math.round(dw * o);
  elCizim.height = Math.round(dh * o);
  ctx.setTransform(o, 0, 0, o, 0, 0);

  elMKat.width = elCizim.width;
  elMKat.height = elCizim.height;
  mctx.setTransform(o, 0, 0, o, 0, 0);
}

function tuvalCiz() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, elCizim.width, elCizim.height);
  ctx.restore();

  for (const s of sekiller) sekilCiz(s);
  if (aktifSekil) sekilCiz(aktifSekil);
}

function sekilCiz(s) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.renk;
  ctx.fillStyle = s.renk;
  ctx.lineWidth = s.kal;

  const n = kutuNormal(s);

  switch (s.tip) {
    case 'kalem':
      ctx.beginPath();
      s.noktalar.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;

    case 'vurgu':
      // Vurgulayıcı: yarı saydam ve kalın, üst üste binince koyulaşmasın diye
      // tek yol halinde çiziliyor.
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = s.kal * 4;
      ctx.beginPath();
      s.noktalar.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;

    case 'cizgi':
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      break;

    case 'ok': {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const uzunluk = Math.hypot(dx, dy);
      if (uzunluk < 1) break;
      const aci = Math.atan2(dy, dx);
      const bas = Math.min(10 + s.kal * 2.6, uzunluk * 0.45);
      // Gövdeyi uç payı bırakarak çiz, uç üçgeni ayrı doldur
      const gx = s.x2 - Math.cos(aci) * bas * 0.75;
      const gy = s.y2 - Math.sin(aci) * bas * 0.75;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - Math.cos(aci - 0.42) * bas, s.y2 - Math.sin(aci - 0.42) * bas);
      ctx.lineTo(s.x2 - Math.cos(aci + 0.42) * bas, s.y2 - Math.sin(aci + 0.42) * bas);
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'kutu':
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      break;

    case 'daire':
      ctx.beginPath();
      ctx.ellipse(n.x + n.w / 2, n.y + n.h / 2, Math.abs(n.w / 2), Math.abs(n.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'mozaik':
      mozaikCiz(n);
      break;

    case 'metin':
      ctx.font = `700 ${s.punto}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      // Koyu/açık her zeminde okunsun diye ince kontur
      ctx.lineWidth = Math.max(2, s.punto / 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      s.satirlar.forEach((satir, i) => {
        const y = s.y + i * s.punto * 1.25;
        ctx.strokeText(satir, s.x, y);
        ctx.fillText(satir, s.x, y);
      });
      break;
  }
  ctx.restore();
}

/** Mozaik: kaynağı küçültüp geri büyüterek pikselleştir (blur'dan güvenli redaksiyon). */
function mozaikCiz(n) {
  if (n.w < 2 || n.h < 2) return;

  if (!kareBitmap) {
    // Kare henüz gelmedi — en azından içeriği gizle
    ctx.fillStyle = 'rgba(20,20,23,0.98)';
    ctx.fillRect(n.x, n.y, n.w, n.h);
    return;
  }

  const kw = Math.max(1, Math.round(n.w / MOZAIK_BLOK));
  const kh = Math.max(1, Math.round(n.h / MOZAIK_BLOK));
  tmp.width = kw; tmp.height = kh;
  tctx.imageSmoothingEnabled = true;
  tctx.clearRect(0, 0, kw, kh);
  tctx.drawImage(kareBitmap,
    n.x * olcek, n.y * olcek, n.w * olcek, n.h * olcek,
    0, 0, kw, kh);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, kw, kh, n.x, n.y, n.w, n.h);
  ctx.imageSmoothingEnabled = true;
}

// ---------------------------------------------------------------- metin modu (OCR)

/** Seçim biter bitmez çağrılır — OCR arka planda başlar, sonucu beklemeyiz.
    Çift tıklandığında hazır olsun diye (ölçüldü: bölge OCR'ı ~6 ms). */
function ocrTetikle() {
  if (!secim) return;
  const n = sinirla(secim);
  const istek = { displayId, x: n.x, y: n.y, w: n.w, h: n.h, olcek };
  if (dilSecili !== undefined) istek.lang = dilSecili;
  ocrSozu = window.deightshot.modul('metin-secme', 'al', istek)
    .then((c) => {
      if (!c.ok) throw new Error(c.error);
      return c.data;
    });
  ocrSozu.catch(() => {});          // sessiz — hata çift tıkta bildirilecek
  return ocrSozu;
}

/** Kurulu OCR dillerini bir kez öğren (dil değiştirici için). */
async function dilleriYukle() {
  if (diller.length) return diller;
  try {
    const c = await window.deightshot.modul('metin-secme', 'diller', {});
    if (c.ok) diller = c.data.languages || [];
  } catch { /* önemsiz */ }
  return diller;
}

/**
 * Dili değiştir ve YENİDEN oku. Otomatik tahmin yerine bu tercih edildi:
 * ölçümde İngilizce metinde en-US belirgin daha iyi, Türkçe metinde tr —
 * ama içeriğe bakıp güvenilir tahmin edecek bir ölçüt bulunamadı.
 * Yeniden okuma ~50 ms, yani tek tık maliyeti yok denecek kadar az.
 */
async function diliDegistir() {
  await dilleriYukle();
  if (diller.length < 2) { bilgiVer('Tek OCR dili kurulu'); return; }

  // 'oto' listenin başında: varsayılan o, elle seçim ondan sonra geliyor.
  // Ölçüldü: otomatik seçim 5/5 doğru (tools/ocr-dil-secimi).
  const secenekler = ['oto', ...diller];
  const suAn = dilSecili !== undefined ? dilSecili : 'oto';
  const i = secenekler.indexOf(suAn);
  dilSecili = secenekler[(i + 1) % secenekler.length];

  const soz = ocrTetikle();
  try {
    const sonuc = await soz;
    kelimeler = sonuc.kelimeler || [];
    kelimeSecim = null;
    sonDil = sonuc.dil;
    dilRozetiGuncelle();
    sayiGuncelle(sonuc);
    metinCiz();
  } catch (e) {
    bilgiVer('OCR başarısız: ' + e.message);
  }
}

let sonDil = '';
function dilRozetiGuncelle() {
  // Otomatikte hangi dilin SEÇİLDİĞİNİ göster — "oto" demek bilgi vermiyor,
  // kullanıcının yanlış okumayı fark edip elle değiştirebilmesi lazım.
  if (dilSecili === 'oto' || dilSecili === undefined) {
    elDilAd.textContent = sonDil ? `oto → ${sonDil}` : 'oto';
  } else {
    elDilAd.textContent = dilSecili || sonDil || '—';
  }
}

elDilBtn.addEventListener('click', (e) => { e.stopPropagation(); diliDegistir(); });
elDilBtn.addEventListener('mousedown', (e) => e.stopPropagation());

// ---------------------------------------------------------------- AI paneli

function aiPanelYerlestir() {
  const kenar = 14;
  const g = elAiPanel.offsetWidth;
  const y = elAiPanel.offsetHeight;
  let x, t;

  // Altyazı kipinde panel sadece kısa bir not — seçimin yanına değil, üst
  // köşeye. Seçimin yanına koymak çevirinin önünü kapatıyordu.
  if (elAiPanel.classList.contains('dar')) {
    elAiPanel.style.left = Math.round(dipGenislik - g - kenar) + 'px';
    elAiPanel.style.top = kenar + 'px';
    return;
  }

  if (secim) {
    const n = normalize(secim);
    x = n.x + n.w + 12;                       // seçimin sağına
    if (x + g > dipGenislik - kenar) x = n.x - g - 12;   // sığmazsa soluna
    t = n.y;
  } else {
    x = dipGenislik - g - kenar;
    t = kenar;
  }
  elAiPanel.style.left = Math.round(Math.min(Math.max(kenar, x), dipGenislik - g - kenar)) + 'px';
  elAiPanel.style.top = Math.round(Math.min(Math.max(kenar, t), dipYukseklik - y - kenar)) + 'px';
}

function aiKapat() {
  aiAcik = false;
  elAiPanel.hidden = true;
  elAiPanel.classList.remove('dar');
  aiSonuc = '';
}

/** Basit kalın-yazı işaretlemesi — model **böyle** yazıyor. */
function aiMetniYaz(metin) {
  elAiGovde.textContent = '';
  const parcalar = String(metin).split(/(\*\*[^*]+\*\*)/g);
  for (const p of parcalar) {
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      const b = document.createElement('strong');
      b.textContent = p.slice(2, -2);
      elAiGovde.appendChild(b);
    } else if (p) {
      elAiGovde.appendChild(document.createTextNode(p));
    }
  }
}

/**
 * Sonuç satırı: nerede çalıştı, ne kadar sürdü.
 *
 * 🔴 Uzak motorda "metin dışarı gitti" bilgisi GÖRÜNÜR olmalı. Tasarımın
 * sıfır telemetri kuralının istisnasını sessizce işletmiyoruz — kullanıcı ayarı
 * kendi açsa bile her sonuçta nereye gittiğini görsün.
 */
function aiBilgiYaz(d) {
  elAiBilgi.textContent = '';
  if (d.uzak) {
    const r = document.createElement('span');
    r.className = 'ai-uzak-rozet';
    r.textContent = '↗ dışarı gönderildi';
    r.title = 'Bu metin ' + (d.cihaz === 'DeepL' ? 'DeepL' : 'API ucuna') +
      ' gönderildi. Kapatmak için: tepsi → Çeviri → Uzak motor.';
    elAiBilgi.appendChild(r);
  }
  const t = document.createElement('span');
  t.textContent = `${d.cihaz} · ${d.model} · ${(d.ms / 1000).toFixed(1)} sn`;
  elAiBilgi.appendChild(t);
}

/** @param {string} [hazirMetin] verilmezse metin modundaki seçim kullanılır */
/**
 * Yükleniyor durumu + geçen süre sayacı.
 * Sayaç şart: kullanımda oyun içinde 138 sn beklendi ve panel donmuş gibi duruyordu.
 * @returns {() => void} sayacı durduran fonksiyon
 */
function aiYukleniyorGoster(mesaj) {
  elAiGovde.textContent = '';
  const yuk = document.createElement('div');
  yuk.className = 'ai-yukleniyor';

  const donen = document.createElement('span');
  donen.className = 'ai-donen';
  const yazi = document.createElement('span');
  yazi.textContent = mesaj;
  const sayac = document.createElement('span');
  sayac.className = 'ai-sayac';

  yuk.append(donen, yazi, sayac);
  elAiGovde.appendChild(yuk);

  const t0 = Date.now();
  const z = setInterval(() => {
    sayac.textContent = Math.round((Date.now() - t0) / 1000) + ' sn';
  }, 500);
  return () => clearInterval(z);
}

/** Yavaş çalışacaksa panelde sor — kararı kullanıcı versin. */
function aiYavasOnayi(plan) {
  return new Promise((coz) => {
    elAiGovde.textContent = '';

    const u = document.createElement('div');
    u.className = 'ai-uyari';
    u.textContent = plan.uyari;
    elAiGovde.appendChild(u);

    const alt = document.createElement('div');
    alt.className = 'ai-secim';

    const devam = document.createElement('button');
    devam.className = 'ai-dugme';
    devam.textContent = `Yine de çalıştır (~${Math.round(plan.tahminSn)} sn)`;
    devam.onclick = (e) => { e.stopPropagation(); coz(true); };

    const vazgec = document.createElement('button');
    vazgec.className = 'ai-dugme birincil';
    vazgec.textContent = 'Vazgeç';
    vazgec.onclick = (e) => { e.stopPropagation(); coz(false); };

    alt.append(devam, vazgec);
    elAiGovde.appendChild(alt);

    const ipucu = document.createElement('div');
    ipucu.className = 'ai-not-ic';
    ipucu.textContent = 'Oyundan çıkınca GPU boşalır ve saniyeler içinde biter.';
    elAiGovde.appendChild(ipucu);

    aiPanelYerlestir();
  });
}

async function aiCalistir(islem, hazirMetin) {
  if (aiCalisiyor) return;
  const metin = hazirMetin !== undefined ? hazirMetin : seciliMetin();
  if (!metin.trim()) { bilgiVer('Önce metin seç'); return; }

  aiAcik = true;
  aiCalisiyor = true;
  aiSonuc = '';
  elAiPanel.hidden = false;
  elAiTip.textContent = islem === 'cevir' ? 'Çeviri' : 'Açıklama';
  elAiBilgi.textContent = '';
  elAiKopya.disabled = true;

  let durdurSayac = aiYukleniyorGoster('Model çalışıyor… ilk seferde model yüklenirken uzun sürebilir');
  aiPanelYerlestir();

  try {
    let c = await window.deightshot.modul('ceviri', islem, { metin });
    if (!c.ok) throw new Error(c.error);

    // Kaynak dar (oyun açık gibi) — sessizce 2 dakika bekletmek yerine sor.
    // Tam ekran oyunda ölçüldü: 138 saniye sürdü ve makine tekledi.
    if (c.data && c.data.onayGerekli) {
      const onay = await aiYavasOnayi(c.data);
      if (!onay) { aiKapat(); return; }
      durdurSayac();
      durdurSayac = aiYukleniyorGoster(`CPU'da çalışıyor — tahmini ${Math.round(c.data.tahminSn)} sn`);
      c = await window.deightshot.modul('ceviri', islem, { metin, yavasOnayli: true });
      if (!c.ok) throw new Error(c.error);
    }

    const d = c.data;
    aiSonuc = d.metin || '';
    aiMetniYaz(aiSonuc || '(boş cevap)');
    aiBilgiYaz(d);
    elAiKopya.disabled = !aiSonuc;
  } catch (e) {
    elAiGovde.textContent = '';
    const h = document.createElement('div');
    h.className = 'ai-hata';
    h.textContent = e.message.includes('Ollama')
      ? `${e.message}\n\nOllama kurulu ve çalışıyor olmalı.`
      : e.message;
    elAiGovde.appendChild(h);
  } finally {
    durdurSayac();
    aiCalisiyor = false;
    aiPanelYerlestir();
  }
}

// ------------------------------------------------- satır içi çeviri (altyazı)
//
// Tasarım kararı: "çevirdiği kelimenin hemen kenarında çevirisi olsa ya da
// cümlenin — hem görüntü hem işlevsellik açısından daha güzel olur."
// Yan panel duruyor: uzun açıklamalar ve hizalama tutmadığı durumlar için.

/** Seçili kelimeleri satırlara böl, her satırın kaynak metnini ve kutusunu ver. */
function seciliSatirlar() {
  if (!kelimeler.length) return [];
  const [a, b] = kelimeSecim ? [kelimeSecim.a, kelimeSecim.b] : [0, kelimeler.length - 1];

  const grup = new Map();
  for (let i = a; i <= b; i++) {
    const k = kelimeler[i];
    if (!k) continue;
    let g = grup.get(k.satir);
    if (!g) { g = { parcalar: [], x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }; grup.set(k.satir, g); }
    g.parcalar.push(k.metin);
    g.x1 = Math.min(g.x1, k.x);
    g.y1 = Math.min(g.y1, k.y);
    g.x2 = Math.max(g.x2, k.x + k.w);
    g.y2 = Math.max(g.y2, k.y + k.h);
  }

  return [...grup.entries()]
    .sort((p, q) => p[1].y1 - q[1].y1)          // ekranda yukarıdan aşağı
    .map(([satir, g]) => ({
      satir,
      kaynak: g.parcalar.join(' '),
      x: g.x1, y: g.y1, w: g.x2 - g.x1, h: g.y2 - g.y1,
    }))
    .filter((s) => s.kaynak.trim());
}

function cevKatTemizle() {
  cevSatirlar = null;
  elCevKat.hidden = true;
  elCevKat.textContent = '';
}

/** Satır için altyazı punto — OCR kutusu harfleri sardığı için yüksekliğe oranlı. */
function cevPunto(h) {
  return Math.max(11, Math.min(26, Math.round(h * 0.85)));
}

/**
 * Satır arası dar mı — "altında" kipi burada okunmaz, kutular bir sonraki
 * kaynak satırı örter. Ölçtük: örnek sahnede diyalog ve HUD bloklarında 5
 * çakışma çıkıyordu. Yoğunsa baştan "üstünde" kipiyle aç.
 */
function cevYogunMu(satirlar) {
  if (satirlar.length < 2) return false;
  let dar = 0, sayilan = 0;
  for (let i = 0; i < satirlar.length - 1; i++) {
    const a = satirlar[i], b = satirlar[i + 1];
    // Yan yana duran satırlar (farklı sütun) aralık hesabına girmesin.
    if (b.x > a.x + a.w || a.x > b.x + b.w) continue;
    sayilan++;
    const bosluk = b.y - (a.y + a.h);
    if (bosluk < cevPunto(a.h) * 1.45) dar++;
  }
  return sayilan > 0 && dar / sayilan >= 0.5;
}

function cevKatCiz() {
  elCevKat.textContent = '';
  if (!cevSatirlar || !cevSatirlar.length) { elCevKat.hidden = true; return; }
  elCevKat.hidden = false;

  for (const s of cevSatirlar) {
    if (!s.ceviri) continue;
    const d = document.createElement('div');
    d.className = 'cev-satir' + (cevUstune ? ' ustu' : '');
    d.textContent = s.ceviri;
    d.title = s.kaynak;                        // üstüne gelince kaynağı göster
    d.style.fontSize = cevPunto(s.h) + 'px';
    elCevKat.appendChild(d);

    // Genişlik ancak DOM'a girdikten sonra belli oluyor.
    // "Üstünde" kipinde kutu kaynağı TAMAMEN örtmeli; yoksa kaynağın uçları
    // çevirinin iki yanından sızıyor ve ikisi birbirine karışıyor.
    if (cevUstune) {
      d.style.width = Math.round(Math.max(d.offsetWidth, s.w + 4)) + 'px';
      d.style.height = Math.round(s.h + 3) + 'px';
    }

    const g = d.offsetWidth;
    const y = d.offsetHeight;
    let x = cevUstune ? s.x - 2 : s.x - 2;
    let t = cevUstune ? s.y - 2 : s.y + s.h + 2;

    // Ekrandan taşarsa içeri çek; altta yer yoksa satırın üstüne al.
    if (x + g > dipGenislik - 4) x = dipGenislik - g - 4;
    if (x < 4) x = 4;
    if (!cevUstune && t + y > dipYukseklik - 4) t = s.y - y - 2;
    if (t < 2) t = 2;

    d.style.left = Math.round(x) + 'px';
    d.style.top = Math.round(t) + 'px';
    if (g > dipGenislik * 0.6) d.classList.add('sikisik');
  }
}

async function ceviriSatirIci() {
  if (aiCalisiyor) return;
  const satirlar = seciliSatirlar();
  if (!satirlar.length) { bilgiVer('Önce metin seç'); return; }

  // Tek satırsa altyazının anlamı yok, panel daha okunur.
  if (satirlar.length === 1) return aiCalistir('cevir');

  aiCalisiyor = true;
  aiAcik = true;
  elAiPanel.hidden = false;
  elAiTip.textContent = 'Çeviri';
  elAiBilgi.textContent = '';
  elAiKopya.disabled = true;
  let durdurSayac = aiYukleniyorGoster(`${satirlar.length} satır çevriliyor…`);
  aiPanelYerlestir();

  try {
    const istek = { satirlar: satirlar.map((s) => s.kaynak) };
    let c = await window.deightshot.modul('ceviri', 'cevir-satir', istek);
    if (!c.ok) throw new Error(c.error);

    if (c.data && c.data.onayGerekli) {
      const onay = await aiYavasOnayi(c.data);
      if (!onay) { aiKapat(); return; }
      durdurSayac();
      durdurSayac = aiYukleniyorGoster(`CPU'da çalışıyor — tahmini ${Math.round(c.data.tahminSn)} sn`);
      c = await window.deightshot.modul('ceviri', 'cevir-satir', { ...istek, yavasOnayli: true });
      if (!c.ok) throw new Error(c.error);
    }

    const d = c.data;

    // Hizalama tutmadıysa altyazı BASMA — yanlış satırın altındaki çeviri
    // sessizce yanıltır. Panele düş ve nedenini söyle.
    if (!d.hizalandi) {
      aiSonuc = d.metin || '';
      aiMetniYaz(aiSonuc || '(boş cevap)');
      aiBilgiYaz(d);
      elAiBilgi.appendChild(document.createTextNode(' · satır hizası tutmadı'));
      elAiKopya.disabled = !aiSonuc;
      return;
    }

    cevSatirlar = satirlar.map((s, i) => ({ ...s, ceviri: d.satirlar[i] }));
    // Satır arası darsa "altında" kipi okunmuyor — doğru kiple aç, kullanıcı
    // Alt'a basmak zorunda kalmasın.
    cevUstune = cevYogunMu(cevSatirlar);
    cevKatCiz();

    // 🔴 Panel altyazının üstüne oturmasın: ölçüldü, çeviri
    // paneli çevirdiği metnin önünü kapattı. Altyazı kipinde panel sadece
    // kısa bir not taşıyor — daraltıp köşeye çekiyoruz.
    elAiPanel.classList.add('dar');

    aiSonuc = cevSatirlar.filter((s) => s.ceviri).map((s) => s.ceviri).join('\n');
    elAiGovde.textContent = '';
    const not = document.createElement('div');
    not.className = 'ai-not-ic';
    const cevrilen = cevSatirlar.filter((s) => s.ceviri).length;
    not.textContent = `${cevrilen}/${cevSatirlar.length} satır çevrildi. ` +
      `Alt: ${cevUstune ? 'satırın altına al' : 'kaynağın üstüne al'} · Esc: kaldır.`;
    elAiGovde.appendChild(not);

    // Parça parça çevrildiyse ve bir kısmı tutmadıysa sessiz kalma.
    if (d.parca && d.parca.basarili < d.parca.toplam) {
      const u = document.createElement('div');
      u.className = 'ai-uyari';
      u.textContent = `${d.parca.toplam - d.parca.basarili} parça hizalanamadı, ` +
        `o satırlar çevrilmeden bırakıldı (yanlış yere yazmaktansa boş bırakılır).`;
      elAiGovde.appendChild(u);
    }

    aiBilgiYaz(d);
    elAiKopya.disabled = false;
  } catch (e) {
    cevKatTemizle();
    elAiGovde.textContent = '';
    const h = document.createElement('div');
    h.className = 'ai-hata';
    h.textContent = e.message;
    elAiGovde.appendChild(h);
  } finally {
    durdurSayac();
    aiCalisiyor = false;
    aiPanelYerlestir();
  }
}

elMIpucu.addEventListener('mousedown', (e) => e.stopPropagation());
elMIpucu.addEventListener('click', (e) => {
  const b = e.target.closest('.ai-dugme[data-ai]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.ai === 'cevir') ceviriSatirIci();
  else aiCalistir(b.dataset.ai);
});

elAiPanel.addEventListener('mousedown', (e) => e.stopPropagation());
elAiKapat.addEventListener('click', (e) => { e.stopPropagation(); aiKapat(); });
elAiKopya.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!aiSonuc) return;
  kilit = true;
  await window.deightshot.metniKopyala(aiSonuc);
});

async function metinModunaGir() {
  if (metinModu || !secim || !ocrSozu) return;
  try {
    const sonuc = await ocrSozu;
    kelimeler = sonuc.kelimeler || [];
    if (!kelimeler.length) { bilgiVer('Bu bölgede metin bulunamadı'); return; }

    metinModu = true;
    sonDil = sonuc.dil;
    // Baştan HEPSİ seçili gelsin — Ctrl+C anında çalışsın. Daraltmak isteyen
    // sürükler (istek: "başta hepsi seçili olsun ama basılı tutup
    // istediğim yere kadar da seçebileyim").
    kelimeSecim = { a: 0, b: kelimeler.length - 1 };
    // İmleci I yap. ⚠️ satır içi stil şart: aracSec() body.style.cursor'ı
    // doğrudan yazıyor ve CSS sınıfını eziyor.
    document.body.style.cursor = 'text';
    // Ana sürece bildir — Ctrl+C globalShortcut'tan geliyor, oradan
    // görsel değil METİN kopyalanmalı.
    window.deightshot.metinModuDurum(displayId, true);
    document.body.classList.add('metin-modu');
    elMIpucu.hidden = false;
    elIpucu.classList.add('solgun');
    dilRozetiGuncelle();
    dilleriYukle();
    sayiGuncelle(sonuc);
    metinCiz();
  } catch (e) {
    bilgiVer('OCR başarısız: ' + e.message);
  }
}

function metinModundanCik() {
  if (!metinModu) return;
  metinModu = false;
  kelimeSecim = null;
  metinSuruklu = false;
  metinAnchor = null;
  cevKatTemizle();
  aiKapat();
  document.body.style.cursor = arac === 'yok' ? 'crosshair' : 'crosshair';
  window.deightshot.metinModuDurum(displayId, false);
  document.body.classList.remove('metin-modu');
  elMIpucu.hidden = true;
  mctx.save();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, elMKat.width, elMKat.height);
  mctx.restore();
  ciz();
}

function sayiGuncelle() {
  const secili = kelimeSecim ? (kelimeSecim.b - kelimeSecim.a + 1) : 0;
  elMSayi.textContent = secili
    ? `${secili} / ${kelimeler.length} kelime seçili`
    : `${kelimeler.length} kelime`;
}

function metinCiz() {
  mctx.save();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, elMKat.width, elMKat.height);
  mctx.restore();

  const [a, b] = kelimeSecim ? [kelimeSecim.a, kelimeSecim.b] : [-1, -2];

  // Seçili olmayan kelimeler ÇOK hafif — sadece "burada metin var" ipucu.
  // Eskiden belirgin griydi ve seçimi yutuyordu, seçili olan anlaşılmıyordu.
  mctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  kelimeler.forEach((k, i) => {
    if (i >= a && i <= b) return;
    mctx.fillRect(k.x - 1, k.y - 1, k.w + 2, k.h + 2);
  });

  // Seçim: canlı mavi — metin editöründeki seçim hissi.
  if (kelimeSecim) {
    mctx.fillStyle = 'rgba(10, 132, 255, 0.62)';
    for (let i = a; i <= b; i++) {
      const k = kelimeler[i];
      if (k) mctx.fillRect(k.x - 1.5, k.y - 1.5, k.w + 3, k.h + 3);
    }
  }
}

/** Noktanın üstündeki kelime; yoksa aynı satırdaki en yakın kelime. */
function kelimeBul(x, y) {
  for (let i = 0; i < kelimeler.length; i++) {
    const k = kelimeler[i];
    if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return i;
  }
  // Satır içinde boşluğa denk geldiyse en yakınına tutun — PDF'lerde de böyle
  let enIyi = -1, enIyiMesafe = Infinity;
  for (let i = 0; i < kelimeler.length; i++) {
    const k = kelimeler[i];
    const dy = y < k.y ? k.y - y : (y > k.y + k.h ? y - (k.y + k.h) : 0);
    const dx = x < k.x ? k.x - x : (x > k.x + k.w ? x - (k.x + k.w) : 0);
    const m = dy * 3 + dx;          // satır farkına daha çok ceza
    if (m < enIyiMesafe) { enIyiMesafe = m; enIyi = i; }
  }
  return enIyiMesafe < 400 ? enIyi : -1;
}

function araligiKur(i, j) {
  if (i < 0 || j < 0) return;
  // Seçim değişti — ekrandaki altyazı artık başka bir metne ait. Bırakmak
  // yanıltır, temizle.
  if (cevSatirlar) cevKatTemizle();
  kelimeSecim = { a: Math.min(i, j), b: Math.max(i, j) };
  sayiGuncelle();
  metinCiz();
}

function satiriSec(i) {
  const s = kelimeler[i].satir;
  let a = i, b = i;
  while (a > 0 && kelimeler[a - 1].satir === s) a--;
  while (b < kelimeler.length - 1 && kelimeler[b + 1].satir === s) b++;
  araligiKur(a, b);
}

function seciliMetin() {
  if (!kelimeler.length) return '';
  const [a, b] = kelimeSecim ? [kelimeSecim.a, kelimeSecim.b] : [0, kelimeler.length - 1];
  let cikti = '';
  let oncekiSatir = null;
  for (let i = a; i <= b; i++) {
    const k = kelimeler[i];
    if (oncekiSatir !== null) cikti += (k.satir !== oncekiSatir ? '\n' : ' ');
    cikti += k.metin;
    oncekiSatir = k.satir;
  }
  return cikti;
}

async function metniPanoyaYaz() {
  const m = seciliMetin();
  if (!m.trim()) { bilgiVer('Seçili metin yok'); return; }
  kilit = true;
  await window.deightshot.metniKopyala(m);
}

/** Kısa bilgi — ölçü rozetini geçici olarak mesaj için kullanır. */
let bilgiZaman = null;
function bilgiVer(mesaj) {
  elOlcu.hidden = false;
  elOlcu.textContent = mesaj;
  clearTimeout(bilgiZaman);
  bilgiZaman = setTimeout(() => { if (secim) ciz(); }, 1800);
}

function kutuNormal(s) {
  if (s.x1 === undefined) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: Math.min(s.x1, s.x2),
    y: Math.min(s.y1, s.y2),
    w: Math.abs(s.x2 - s.x1),
    h: Math.abs(s.y2 - s.y1),
  };
}

function geriAl() {
  if (metinDuzenleniyor) { metinCikis(false); return; }
  if (!sekiller.length) return;
  sekiller.pop();
  tuvalCiz();
}

// ---------------------------------------------------------------- nişangâh

function nisanKur(x, y) {
  elNisanX.style.left = x + 'px';
  elNisanY.style.top = y + 'px';
  const zatenVardi = document.body.classList.contains('nisanli');
  document.body.classList.add('nisanli');
  // Nişangâh aynı anda tek ekranda olmalı — iki monitörde iki artı çıkıyordu.
  if (!zatenVardi) window.deightshot.nisanBende(displayId);
}

function nisanGizle() { document.body.classList.remove('nisanli'); }

// ---------------------------------------------------------------- çizim/yerleşim

let sonBildirilen = null;
function secimBildir() {
  const varMi = !!secim;
  if (varMi === sonBildirilen) return;
  sonBildirilen = varMi;
  window.deightshot.secimDurum(displayId, varMi);
}

function ciz() {
  secimBildir();

  if (!secim) {
    elSecim.hidden = true;
    elOlcu.hidden = true;
    elAraclar.hidden = true;
    elStil.hidden = true;
    elIslem.hidden = true;
    elPerde.classList.remove('gizli');
    elIpucu.classList.remove('solgun');
    return;
  }

  const { x, y, w, h } = normalize(secim);
  elPerde.classList.add('gizli');
  elSecim.hidden = false;
  elSecim.style.left = x + 'px';
  elSecim.style.top = y + 'px';
  elSecim.style.width = w + 'px';
  elSecim.style.height = h + 'px';

  elOlcu.hidden = false;
  elOlcu.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  const rozetY = y - 28 < 4 ? y + 6 : y - 28;
  let rozetX = x;
  const rozetW = elOlcu.offsetWidth || 70;
  if (rozetX + rozetW > dipGenislik - 4) rozetX = dipGenislik - rozetW - 4;
  elOlcu.style.left = Math.max(4, rozetX) + 'px';
  elOlcu.style.top = Math.max(4, rozetY) + 'px';

  // Çubuklar seçim sürerken görünmesin — sürükleme sırasında gürültü yapıyor.
  const cubuklar = mod === null;
  elAraclar.hidden = !cubuklar;
  elIslem.hidden = !cubuklar;
  elStil.hidden = !cubuklar || arac === 'yok';
  if (cubuklar) cubuklariYerlestir({ x, y, w, h });

  // Seçim yapıldıktan sonra ipucu çubuğu gereksiz — aynı eylemler artık
  // düğme olarak duruyor. Ekranı kalabalıklaştırmasın.
  elIpucu.classList.add('solgun');
}

/** Çubukları seçimin kenarına yapıştır; ekran dışına taşacaksa içeri kaydır. */
function cubuklariYerlestir(s) {
  const bosluk = 10;
  // Tam ekran seçimde çubukların gidecek yeri yok, içeri sıkışıyorlar.
  // Kenar payını cömert tut ki ekranın en ucuna yapışıp kesik görünmesinler.
  const kenar = 14;

  // --- İşlemler: seçimin ALTINDA, sağa hizalı ---
  const iw = elIslem.offsetWidth;
  const ih = elIslem.offsetHeight;
  let ix = s.x + s.w - iw;
  let iy = s.y + s.h + bosluk;
  if (iy + ih > dipYukseklik - kenar) {
    iy = s.y - ih - bosluk;                       // yukarı al
    if (iy < kenar) iy = s.y + s.h - ih - bosluk; // olmuyorsa içeri al
  }
  ix = Math.min(Math.max(kenar, ix), dipGenislik - iw - kenar);
  iy = Math.min(Math.max(kenar, iy), dipYukseklik - ih - kenar);
  elIslem.style.left = ix + 'px';
  elIslem.style.top = iy + 'px';

  // --- Araçlar: seçimin SAĞINDA, dikey ---
  const aw = elAraclar.offsetWidth;
  const ah = elAraclar.offsetHeight;
  let ax = s.x + s.w + bosluk;
  let ay = s.y;
  if (ax + aw > dipGenislik - kenar) {
    ax = s.x - aw - bosluk;                       // sola al
    if (ax < kenar) ax = s.x + s.w - aw - bosluk; // olmuyorsa içeri al
  }
  ax = Math.min(Math.max(kenar, ax), dipGenislik - aw - kenar);
  ay = Math.min(Math.max(kenar, ay), dipYukseklik - ah - kenar);
  elAraclar.style.left = ax + 'px';
  elAraclar.style.top = ay + 'px';

  // --- Stil (renk/kalınlık): araçların hemen altında ---
  if (!elStil.hidden) {
    const sw = elStil.offsetWidth;
    const sh = elStil.offsetHeight;
    let sx = ax + (aw - sw) / 2;
    let sy = ay + ah + bosluk;
    if (sy + sh > dipYukseklik - kenar) sy = Math.max(kenar, ay - sh - bosluk);
    sx = Math.min(Math.max(kenar, sx), dipGenislik - sw - kenar);
    elStil.style.left = Math.round(sx) + 'px';
    elStil.style.top = Math.round(sy) + 'px';
  }
}

function normalize(s) {
  return {
    x: Math.min(s.x, s.x + s.w),
    y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w),
    h: Math.abs(s.h),
  };
}

function sinirla(s) {
  const n = normalize(s);
  n.x = Math.max(0, Math.min(n.x, dipGenislik));
  n.y = Math.max(0, Math.min(n.y, dipYukseklik));
  n.w = Math.min(n.w, dipGenislik - n.x);
  n.h = Math.min(n.h, dipYukseklik - n.y);
  return n;
}

/** Çizim seçim alanının dışına taşmasın diye kırp. */
function secimeKirp(p) {
  const n = normalize(secim);
  return {
    x: Math.min(Math.max(p.x, n.x), n.x + n.w),
    y: Math.min(Math.max(p.y, n.y), n.y + n.h),
  };
}

// ---------------------------------------------------------------- araç çubuğu

function aracSec(yeni) {
  arac = yeni;
  document.body.classList.toggle('arac-aktif', arac !== 'yok');
  for (const b of elAraclar.querySelectorAll('.arac[data-arac]')) {
    b.classList.toggle('secili', b.dataset.arac === arac);
  }
  // Metin modundayken imleci ezme — orada I olmalı.
  if (!metinModu) {
    document.body.style.cursor = arac === 'metin' ? 'text' : 'crosshair';
  }
  if (secim) ciz();
}

elAraclar.addEventListener('mousedown', (e) => e.stopPropagation());
elStil.addEventListener('mousedown', (e) => e.stopPropagation());
elIslem.addEventListener('mousedown', (e) => e.stopPropagation());

elAraclar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.eylem === 'geri') { geriAl(); return; }
  if (b.dataset.arac) { metinCikis(true); aracSec(b.dataset.arac); }
});

elStil.addEventListener('click', (e) => {
  const r = e.target.closest('.renk');
  if (r) {
    renk = r.dataset.renk;
    for (const x of elStil.querySelectorAll('.renk')) x.classList.toggle('secili', x === r);
    return;
  }
  const k = e.target.closest('.kal');
  if (k) {
    kalinlik = Number(k.dataset.kal);
    for (const x of elStil.querySelectorAll('.kal')) x.classList.toggle('secili', x === k);
  }
});

elIslem.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const eylem = b.dataset.eylem;
  if (eylem === 'kapat') window.deightshot.tus('iptal');
  else if (eylem === 'kopyala') gonder('kopyala');
  else if (eylem === 'kaydet') gonder('kaydet');
  else if (eylem === 'metni-kopyala') metniKopyalaDugmesi();
  else if (eylem === 'cevir' || eylem === 'acikla') aiTumSecim(eylem);
});

/**
 * Ana çubuktaki Çevir/Açıkla — seçimin TAMAMINI işler.
 * Metin modundan bağımsız çalışır: kullanımda bu düğmeler ana çubukta arandı,
 * metin modunun içine gömülü olmaları keşfedilemez yapıyordu.
 */
async function aiTumSecim(islem) {
  if (!secim || aiCalisiyor) return;
  if (!ocrSozu) ocrTetikle();
  try {
    const sonuc = await ocrSozu;
    const metin = (sonuc && sonuc.metin || '').trim();
    if (!metin) { bilgiVer('Bu bölgede metin bulunamadı'); return; }

    // 🔴 Kullanımda araç çubuğundaki "Çevir"e basıldı ve blok panel geldi —
    // altyazı sadece metin modu çubuğundaki düğmede çalışıyordu. İki ayrı
    // "Çevir" düğmesinin farklı davranması saçma; ikisi de altyazı basar.
    // (Açıkla blok kalıyor: açıklama satıra bölünecek bir şey değil.)
    if (islem === 'cevir') {
      kelimeler = sonuc.kelimeler || [];
      if (kelimeler.length) {
        kelimeSecim = null;             // seçimin tamamı
        sonDil = sonuc.dil;
        return ceviriSatirIci();
      }
    }
    aiCalistir(islem, metin);
  } catch (e) {
    bilgiVer('OCR başarısız: ' + e.message);
  }
}

/** Düğme: seçimdeki TÜM metni kopyalar. Parça seçmek isteyen çift tıklar. */
async function metniKopyalaDugmesi() {
  if (!secim) return;
  if (!ocrSozu) ocrTetikle();
  try {
    const sonuc = await ocrSozu;
    if (!sonuc.metin || !sonuc.metin.trim()) { bilgiVer('Bu bölgede metin bulunamadı'); return; }
    kilit = true;
    await window.deightshot.metniKopyala(sonuc.metin);
  } catch (e) {
    kilit = false;
    bilgiVer('OCR başarısız: ' + e.message);
  }
}

// ---------------------------------------------------------------- metin aracı

function metinBasla(x, y) {
  metinCikis(true);
  const punto = 13 + kalinlik * 3;
  metinDuzenleniyor = { x, y, punto, renk };
  elMetin.hidden = false;
  elMetin.textContent = '';
  elMetin.style.left = x + 'px';
  elMetin.style.top = y + 'px';
  elMetin.style.color = renk;
  elMetin.style.fontSize = punto + 'px';
  elMetin.style.lineHeight = '1.25';
  setTimeout(() => elMetin.focus(), 0);
}

function metinCikis(kaydet) {
  if (!metinDuzenleniyor) return;
  const yazi = elMetin.textContent.replace(/ /g, ' ');
  if (kaydet && yazi.trim()) {
    sekiller.push({
      tip: 'metin',
      x: metinDuzenleniyor.x,
      y: metinDuzenleniyor.y,
      punto: metinDuzenleniyor.punto,
      renk: metinDuzenleniyor.renk,
      satirlar: yazi.split('\n'),
    });
  }
  metinDuzenleniyor = null;
  elMetin.hidden = true;
  elMetin.textContent = '';
  tuvalCiz();
}

elMetin.addEventListener('keydown', (e) => {
  e.stopPropagation();               // overlay kısayolları metne karışmasın
  if (e.key === 'Escape') { metinCikis(false); e.preventDefault(); }
  else if (e.key === 'Enter' && !e.shiftKey) { metinCikis(true); e.preventDefault(); }
});
elMetin.addEventListener('mousedown', (e) => e.stopPropagation());

// ---------------------------------------------------------------- fare

document.addEventListener('mousemove', (e) => {
  sonFare = { x: e.clientX, y: e.clientY };

  // Metin modunda sürükleyerek seçim (PDF'te seçer gibi)
  if (metinModu) {
    if (metinSuruklu && metinAnchor !== null) {
      const i = kelimeBul(e.clientX, e.clientY);
      // Çapadan itibaren büyüt — iki yöne de çalışır.
      if (i >= 0) araligiKur(metinAnchor, i);
    }
    return;
  }

  if (!secim && !mod) nisanKur(e.clientX, e.clientY);
  if (!mod) return;

  if (mod === 'arac') {
    const p = secimeKirp({ x: e.clientX, y: e.clientY });
    if (aktifSekil.tip === 'kalem' || aktifSekil.tip === 'vurgu') aktifSekil.noktalar.push(p);
    else { aktifSekil.x2 = p.x; aktifSekil.y2 = p.y; }
    tuvalCiz();
    return;
  }

  if (mod === 'ciziyor') {
    secim.w = e.clientX - baslangic.x;
    secim.h = e.clientY - baslangic.y;
  } else if (mod === 'tasiyor') {
    const dx = e.clientX - baslangic.x;
    const dy = e.clientY - baslangic.y;
    secim = {
      x: Math.max(0, Math.min(baslangic.s.x + dx, dipGenislik - baslangic.s.w)),
      y: Math.max(0, Math.min(baslangic.s.y + dy, dipYukseklik - baslangic.s.h)),
      w: baslangic.s.w,
      h: baslangic.s.h,
    };
  } else if (mod === 'boyutluyor') {
    const s = { ...baslangic.s };
    const dx = e.clientX - baslangic.x;
    const dy = e.clientY - baslangic.y;
    if (yon.includes('w')) { s.x += dx; s.w -= dx; }
    if (yon.includes('e')) { s.w += dx; }
    if (yon.includes('n')) { s.y += dy; s.h -= dy; }
    if (yon.includes('s')) { s.h += dy; }
    secim = s;
  }
  ciz();
});

document.addEventListener('mouseleave', () => { if (!mod) nisanGizle(); });
document.addEventListener('mouseenter', (e) => {
  if (!secim && !mod) nisanKur(e.clientX, e.clientY);
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || kilit) return;

  // --- metin modu: seçim kelime bazlı çalışır ---
  if (metinModu) {
    const simdi = Date.now();
    sonTikSayisi = (simdi - sonTikZamani < 400) ? sonTikSayisi + 1 : 1;
    sonTikZamani = simdi;

    const i = kelimeBul(e.clientX, e.clientY);
    if (i < 0) { e.preventDefault(); return; }

    if (sonTikSayisi >= 3) { satiriSec(i); metinAnchor = null; }        // üç tık = satır
    else if (sonTikSayisi === 2) { araligiKur(i, i); metinAnchor = i; } // çift tık = kelime
    else {
      // Tek tık: buradan sürükleyerek seç. Çapa burası — normal metin
      // seçiminde olduğu gibi basılı tuttuğun yerden büyür.
      metinSuruklu = true;
      metinAnchor = i;
      araligiKur(i, i);
    }

    e.preventDefault();
    return;
  }

  // Metin düzenleniyorsa önce onu bitir
  if (metinDuzenleniyor) { metinCikis(true); return; }

  // Bir çizim aracı aktif ve seçim varsa: çizim yap
  if (arac !== 'yok' && secim) {
    const p = secimeKirp({ x: e.clientX, y: e.clientY });

    if (arac === 'metin') { metinBasla(p.x, p.y); e.preventDefault(); return; }

    mod = 'arac';
    if (arac === 'kalem' || arac === 'vurgu') {
      aktifSekil = { tip: arac, renk, kal: kalinlik, noktalar: [p] };
    } else {
      aktifSekil = { tip: arac, renk, kal: kalinlik, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    }
    document.body.classList.add('suruklüyor');
    ciz();
    e.preventDefault();
    return;
  }

  const tut = e.target.closest('.tut');
  if (tut) {
    mod = 'boyutluyor';
    yon = tut.dataset.yon;
    baslangic = { x: e.clientX, y: e.clientY, s: normalize(secim) };
  } else if (secim && e.target === elSecim) {
    mod = 'tasiyor';
    baslangic = { x: e.clientX, y: e.clientY, s: normalize(secim) };
  } else {
    mod = 'ciziyor';
    baslangic = { x: e.clientX, y: e.clientY };
    secim = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    nisanGizle();
  }
  document.body.classList.add('suruklüyor');
  ciz();
  e.preventDefault();
});

// Çift tık: görsel modda metin moduna geçer (asıl özellik).
document.addEventListener('dblclick', (e) => {
  if (kilit || metinModu || !secim || arac !== 'yok') return;
  const n = normalize(secim);
  const icinde = e.clientX >= n.x && e.clientX <= n.x + n.w
              && e.clientY >= n.y && e.clientY <= n.y + n.h;
  if (!icinde) return;
  e.preventDefault();
  metinModunaGir();
});

document.addEventListener('mouseup', () => {
  if (metinModu) { metinSuruklu = false; return; }
  if (!mod) return;
  const oncekiMod = mod;
  mod = null;
  document.body.classList.remove('suruklüyor');

  if (oncekiMod === 'arac') {
    if (aktifSekil) {
      const bosMu = aktifSekil.noktalar
        ? aktifSekil.noktalar.length < 2
        : Math.hypot(aktifSekil.x2 - aktifSekil.x1, aktifSekil.y2 - aktifSekil.y1) < 3;
      if (!bosMu) sekiller.push(aktifSekil);
      aktifSekil = null;
      tuvalCiz();
    }
    ciz();
    return;
  }

  if (secim) {
    const n = sinirla(secim);
    if (n.w < 3 || n.h < 3) { secim = null; sekiller = []; nisanKur(sonFare.x, sonFare.y); }
    else {
      secim = n;
      // OCR'ı ŞİMDİ başlat, sonucu bekleme. Çift tıkladığında hazır olsun —
      // yoksa 300ms bekleme hissi olur (tasarım notundaki kritik kural).
      ocrTetikle();
    }
  }
  ciz();
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Araç aktifse önce aracı bırak, seçimi koru — kullanıcı çizimden çıkmak isteyebilir.
  if (arac !== 'yok') { aracSec('yok'); return; }
  window.deightshot.tus('iptal');
});

// ---------------------------------------------------------------- klavye

const ARAC_TUSLARI = {
  v: 'yok', p: 'kalem', a: 'ok', l: 'cizgi', r: 'kutu',
  o: 'daire', h: 'vurgu', t: 'metin', b: 'mozaik',
};

document.addEventListener('keydown', (e) => {
  if (kilit || metinDuzenleniyor) return;

  // --- metin modu kısayolları ---
  // Kararı yine ANA SÜREÇ veriyor (globalShortcut ile çiftlenmesin diye);
  // orada metin modu bilindiği için doğru eyleme yönlendiriliyor.
  if (metinModu) {
    if (e.key === 'Escape') { window.deightshot.tus('iptal'); e.preventDefault(); return; }
    // Alt: altyazıyı satırın altı ↔ kaynağın üstü arasında gezdir.
    // Satır arası dar olan yoğun metinlerde "altında" okunmuyor, "üstünde" şart.
    if (e.key === 'Alt' && cevSatirlar) {
      cevUstune = !cevUstune; cevKatCiz(); e.preventDefault(); return;
    }
    if (e.ctrlKey && /^[aA]$/.test(e.key)) { window.deightshot.tus('tum-ekran'); e.preventDefault(); return; }
    if (e.ctrlKey && /^[cC]$/.test(e.key)) { window.deightshot.tus('kopyala'); e.preventDefault(); return; }
    return;   // diğer tuşlar metin modunda iş yapmasın
  }

  if (e.ctrlKey && /^[zZ]$/.test(e.key)) { geriAl(); e.preventDefault(); return; }

  // Bu tuşlar ana süreçte tek elden karara bağlanıyor. Sebep: aynı tuşlar
  // globalShortcut ile de yakalanıyor (overlay odağı alamasa bile çalışsın diye).
  // İkisi birden iş yaparsa Esc önce seçimi temizleyip sonra overlay'i kapatıyordu.
  if (e.key === 'Escape')  { window.deightshot.tus('iptal');     e.preventDefault(); return; }
  if (e.key === 'Enter')   { window.deightshot.tus('kopyala');   e.preventDefault(); return; }
  if (e.ctrlKey && /^[aA]$/.test(e.key)) { window.deightshot.tus('tum-ekran'); e.preventDefault(); return; }
  if (e.ctrlKey && /^[cC]$/.test(e.key)) { window.deightshot.tus('kopyala');   e.preventDefault(); return; }
  if (e.ctrlKey && /^[sS]$/.test(e.key)) { window.deightshot.tus('kaydet');    e.preventDefault(); return; }

  // Araç kısayolları (seçim yapıldıktan sonra anlamlı)
  if (!e.ctrlKey && !e.altKey && secim) {
    const t = ARAC_TUSLARI[e.key.toLowerCase()];
    if (t) { aracSec(t); e.preventDefault(); return; }
  }

  // Ok tuşlarıyla 1px ayar (Shift 10px, Alt boyut)
  const oklar = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (oklar[e.key] && secim) {
    const adim = e.shiftKey ? 10 : 1;
    const [dx, dy] = oklar[e.key];
    const s = normalize(secim);
    secim = e.altKey
      ? sinirla({ x: s.x, y: s.y, w: s.w + dx * adim, h: s.h + dy * adim })
      : sinirla({ x: s.x + dx * adim, y: s.y + dy * adim, w: s.w, h: s.h });
    ciz();
    e.preventDefault();
  }
});

// ---------------------------------------------------------------- dışa aktarım

/**
 * Kare + çizimleri birleştirip seçimi FİZİKSEL çözünürlükte dışa aktarır.
 * Ana süreçte birleştirmek yerine burada yapılıyor: mozaik zaten tuvalde,
 * ikinci bir kopya/ölçekleme yolu açmaya gerek yok.
 */
async function kompozitPng() {
  const n = sinirla(secim);
  const sw = Math.max(1, Math.round(n.w * olcek));
  const sh = Math.max(1, Math.round(n.h * olcek));
  const sx = Math.round(n.x * olcek);
  const sy = Math.round(n.y * olcek);

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');

  if (kareBitmap) octx.drawImage(kareBitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  else { octx.fillStyle = '#141417'; octx.fillRect(0, 0, sw, sh); }

  // Çizim tuvali zaten fiziksel çözünürlükte — birebir kopyalanıyor.
  octx.drawImage(elCizim, sx, sy, sw, sh, 0, 0, sw, sh);

  // Altyazılar DOM katmanında duruyor, tuvalde değil — elle çizilmezse
  // kopyalanan görüntüde çeviri OLMAZ. İstek: "çeviri açıkken ss
  // alırsam çeviriler de görünsün."
  altyaziyiTuvaleCiz(octx, sx, sy);

  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Yuvarlak köşeli dikdörtgen — roundRect yoksa düz köşeye düş. */
function yuvarlakYol(c, x, y, w, h, r) {
  if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Ekrandaki altyazı kutularını dışa aktarım tuvaline çizer.
 *
 * Konum ve stil, DOM'daki GERÇEK kutulardan okunuyor (getBoundingClientRect +
 * getComputedStyle). Ölçüleri burada yeniden hesaplasaydık ekranda görünenle
 * kaydedilen arasında sessizce fark oluşurdu — CSS her değiştiğinde ikisi
 * ayrışırdı. Tek gerçek kaynak: ekrandaki kutunun kendisi.
 *
 * @param {CanvasRenderingContext2D} octx
 * @param {number} sx,sy  seçimin sol üst köşesi (FİZİKSEL piksel)
 */
function altyaziyiTuvaleCiz(octx, sx, sy) {
  if (!cevSatirlar || elCevKat.hidden) return;

  for (const d of elCevKat.querySelectorAll('.cev-satir')) {
    const r = d.getBoundingClientRect();
    const x = r.left * olcek - sx;
    const y = r.top * olcek - sy;
    const w = r.width * olcek;
    const h = r.height * olcek;
    if (w < 1 || h < 1) continue;
    // Seçimin tamamen dışındaki kutular boşuna çizilmesin.
    if (x + w < 0 || y + h < 0 || x > octx.canvas.width || y > octx.canvas.height) continue;

    const s = getComputedStyle(d);
    const kenarG = parseFloat(s.borderLeftWidth) || 0;

    octx.save();
    octx.fillStyle = s.backgroundColor;
    yuvarlakYol(octx, x, y, w, h, (parseFloat(s.borderTopLeftRadius) || 5) * olcek);
    octx.fill();

    // Sol mavi vurgu şeridi (altında kipinde var, üstünde kipinde yok)
    if (kenarG > 0) {
      octx.fillStyle = s.borderLeftColor;
      octx.fillRect(x, y, kenarG * olcek, h);
    }

    const punto = (parseFloat(s.fontSize) || 13) * olcek;
    octx.font = `${s.fontWeight || 500} ${punto}px "Segoe UI", system-ui, sans-serif`;
    octx.fillStyle = s.color;
    octx.textBaseline = 'middle';

    // Ekranda ortalanıyorsa burada da ortala ("üstünde" kipi), yoksa soldan.
    const ortali = s.justifyContent === 'center';
    octx.textAlign = ortali ? 'center' : 'left';
    const metinX = ortali
      ? x + w / 2
      : x + (kenarG + (parseFloat(s.paddingLeft) || 6)) * olcek;

    // Ekrandaki gölgeyi de taşı — koyu zemin üstünde okunurluğu o sağlıyor.
    octx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    octx.shadowOffsetY = 1 * olcek;
    octx.shadowBlur = 2 * olcek;
    octx.fillText(d.textContent, metinX, y + h / 2);
    octx.restore();
  }
}

async function gonder(islem) {
  if (kilit || !secim) return;
  metinCikis(true);

  const n = sinirla(secim);
  if (n.w < 1 || n.h < 1) return;

  kilit = true;
  try {
    const png = await kompozitPng();
    if (islem === 'kopyala') await window.deightshot.kopyala({ png });
    else await window.deightshot.kaydet({ png });
  } catch (e) {
    console.error('dışa aktarım başarısız', e);
    kilit = false;
  }
}
