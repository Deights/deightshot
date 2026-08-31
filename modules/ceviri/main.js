// ceviri — seçili metni Türkçeye çevirir ya da ne anlama geldiğini açıklar.
//
// Tasarım kuralı: motor TAKILABİLİR. Tek arayüzün arkasında bugün Ollama var,
// yarın API ya da gömülü model olabilir; uygulamanın geri kalanı değişmez.
//
// Kaynak kararı ölçüme dayanıyor: "oyun var mı" değil, "şu an neresi boş".
// Rekabetçi oyunlar CPU'ya yüklenir ve GPU'yu boş bırakır — orada GPU doğru
// seçimdir.
const ollama = require('./motorlar/ollama');
const deepl = require('./motorlar/deepl');
const api = require('./motorlar/api');
const {
  ceviriMesajlari, aciklaMesajlari,
  satirCeviriMesajlari, satirCeviriAyristir,
} = require('./promptlar');

const MOTORLAR = { ollama, deepl, api };

let ctx = null;
let sonKarar = null;

/**
 * Overlay açılırken oyun ön planda mıydı.
 * Modül kendi ölçemez — overlay ekranı kaplayınca ön plandaki uygulama
 * DeightShot'in kendisi oluyor. Çekirdek yakalama anında ölçüp saklıyor.
 */
function oyunAcikMi() {
  try { return !!(ctx.oyunDurumu && ctx.oyunDurumu().acik); }
  catch { return false; }
}

/**
 * Uzak motor kullanılabilir mi — GİZLİLİK KAPISI.
 *
 * 🔴 Tek geçiş noktası. Ekran metni buradan onay almadan makineden çıkmaz.
 * `uzakAcik` kullanıcı elle açmadıkça false.
 *
 * ⚠️ ÖLÇÜLDÜ (oyun içinde): ilk sürüm sadece "VRAM yetiyor mu"ya bakıyordu
 * ve oyun açıkken bile "model sığıyor" deyip YERELDE kaldı — çeviri ~20 saniye
 * sürdü. Sığmak hızlı çalışmak demek değil: oyunla VRAM çekişmesi modeli
 * sürünüyor. Doğru sinyal "oyun ön planda mı", bütçe tahmini değil.
 */
function uzakIzinli(ayar, gpuBos, oyunVar, yerelYok) {
  if (!ayar.uzakAcik) return false;
  if (ayar.uzakNeZaman === 'hep') return true;
  // 'oyunda' = "yereli tercih et, yapamadığı durumda uzağa geç".
  // ⚠️ Yerel motorun KAPALI olması da tam olarak o durumdur. Eskiden burada
  // sadece oyun/VRAM'e bakılıyordu; Ollama kapalıyken uzak motor açık ve
  // çalışır haldeyken bile "Ollama çalışmıyor" hatası veriliyordu (ölçüldü).
  return oyunVar || !gpuBos || yerelYok;
}

/** VRAM/CPU ölçüp motorun nerede çalışacağına karar ver. */
async function kaynakKarari(tahminiModelMb = 6000) {
  let k = null;
  try {
    k = await ctx.native.cagir('resources', {}, 6000);
  } catch (e) {
    ctx.log('kaynak ölçülemedi, GPU varsayılıyor: ' + e.message);
    return { gpu: true, gerekce: 'ölçüm yok', olcum: null };
  }

  const vramYeter = k.vramAlinabilirMb >= tahminiModelMb;
  const cpuMusait = k.cpuYuzde < 55;

  if (vramYeter) {
    return {
      gpu: true,
      gerekce: `${k.vramAlinabilirMb} MB alınabilir VRAM`,
      tahmin: '~1-3 sn',
      olcum: k,
    };
  }

  return {
    gpu: false,
    gerekce: k.tamEkranUygulamaVar
      ? `VRAM dar (${k.vramAlinabilirMb} MB) — tam ekran uygulama açık (${k.onPlanUygulama})`
      : `VRAM dar (${k.vramAlinabilirMb} MB)`,
    tahmin: cpuMusait ? '10-30 sn' : '30 sn+',
    olcum: k,
  };
}

/**
 * Hangi motor, hangi cihaz, ne kadar sürer — ÇALIŞTIRMADAN.
 * @param {'cevir'|'acikla'} islem  DeepL açıklama yapamaz, seçim buna bağlı.
 */
async function planYap(islem = 'cevir') {
  const ayar = ctx.ayarlar.get();

  // Yerel durum önce: uzak motor "yerel sıkışıksa" devreye girdiği için
  // kaynak ölçümü her hâlükârda lazım.
  const durum = await MOTORLAR.ollama.hazirMi();
  let model = null, boyutGb = 6;
  if (durum.hazir) {
    model = ayar.ceviriModel;
    if (!model || !durum.modeller.some((m) => m.ad === model)) model = durum.modeller[0].ad;
    boyutGb = durum.modeller.find((m) => m.ad === model)?.boyutGb || 6;
  }
  const karar = await kaynakKarari(Math.round(boyutGb * 1000 * 1.2));
  const oyunVar = oyunAcikMi();
  const yerelYok = !durum.hazir;
  const neden = yerelYok ? `yerel motor yok (${durum.sebep})`
    : oyunVar ? 'oyun ön planda'
    : !karar.gpu ? 'yerel GPU dolu'
    : 'uzak motor "hep" seçili';

  // --- uzak motor devrede mi ---
  if (uzakIzinli(ayar, karar.gpu, oyunVar, yerelYok)) {
    // Çeviride DeepL önce: saf çeviri motoru, deyimlerde yerel modelden iyi
    // ve satır hizalaması garanti (her satır ayrı çevriliyor).
    if (islem === 'cevir' && (ayar.deeplAnahtar || '').trim()) {
      return {
        motor: 'deepl', karar, cokYavas: false, tahminSn: 1,
        gerekce: neden, uzak: true, uyari: null,
      };
    }
    const apiDurum = await MOTORLAR.api.hazirMi(ayar);
    if (apiDurum.hazir) {
      return {
        motor: 'api', model: apiDurum.model, karar, cokYavas: false, tahminSn: 3,
        gerekce: neden, uzak: true, uyari: null,
      };
    }
    // Uzak açık ama yapılandırılmamış — sessizce yerele düşme, söyle.
    ctx.log(`uzak motor açık ama kullanılamıyor: ${apiDurum.sebep}`);
  }

  // --- yerel (Ollama) ---
  if (yerelYok) {
    // Buraya düştüysek uzak motor ya kapalı ya yapılandırılmamış.
    // Kullanıcıya iki çıkış yolunu da söyle, sadece "Ollama çalışmıyor" deme.
    throw new Error(`${durum.sebep}. ` + (ayar.uzakAcik
      ? 'Uzak motor açık ama kullanılamadı — Ayarlar → LLM ucu alanlarını kontrol et.'
      : "Ya Ollama'yı başlat, ya Ayarlar'dan uzak motoru aç."));
  }

  // 🔴 ÖLÇÜLDÜ (tam ekran oyun açıkken): 8B model CPU'da 138 saniye sürdü ve
  // makineyi tekletti. Bu bir seçenek değil — sessizce yapmak yerine
  // kullanıcıya söyleyip kararı ona bırakıyoruz.
  // ⚠️ ÖLÇÜLDÜ (oyun içinde): VRAM "yetiyor" görünse bile oyunla çekişme
  // yüzünden çeviri ~20 sn sürdü. O yüzden oyun açıkken de yavaş sayılıyor.
  const cokYavas = (!karar.gpu || oyunVar) && boyutGb >= 3;
  const tahminSn = !karar.gpu
    ? Math.round(boyutGb * 22)            // CPU: 5 GB -> ~110 sn (ölçümle uyumlu)
    : oyunVar
      ? 20                                // GPU ama oyunla çekişmeli (ölçüldü)
      : Math.max(2, Math.round(boyutGb * 0.8));

  return {
    motor: 'ollama', model, boyutGb, karar, cokYavas, tahminSn, uzak: false,
    gerekce: karar.gerekce,
    uyari: cokYavas
      ? (oyunVar
          ? `${ctx.oyunDurumu().ad || 'Bir oyun'} açık. Yerel model GPU'yu oyunla ` +
            `paylaştığı için çeviri ~${tahminSn} saniye sürer ve oyunu tekletebilir.`
          : `GPU şu an dolu. Bu model CPU'da yaklaşık ` +
            `${Math.round(tahminSn / 60)} dakika sürer ve bilgisayarı yavaşlatır.`) +
        (ayar.uzakAcik
          ? ' Uzak motor açık ama kullanılamadı — ayarlardan anahtarı kontrol et.'
          : ' Ayarlardan uzak motor açarsan oyun içinde ~1 saniyede biter.')
      : null,
  };
}

async function calistir(mesajlar, secim = {}) {
  const ayar = ctx.ayarlar.get();
  const plan = secim.plan || await planYap();
  const { model, karar } = plan;

  sonKarar = karar;

  // Uzak LLM ucu — metin makineden ÇIKIYOR. Log'a da yaz ki geriye dönük
  // "ne zaman dışarı gitti" sorusu cevaplanabilsin.
  if (plan.motor === 'api') {
    ctx.log(`UZAK · ${plan.model} · ${plan.gerekce} — metin dışarı gönderiliyor`);
    const r = await MOTORLAR.api.uret(mesajlar, ayar, {});
    return {
      metin: r.metin, model: r.model, ms: r.ms,
      cihaz: 'API', uzak: true, gerekce: plan.gerekce, olcum: karar.olcum,
    };
  }

  ctx.log(`motor: ${karar.gpu ? 'GPU' : 'CPU'} · ${model} · ${karar.gerekce}`);

  const r = await MOTORLAR.ollama.uret(mesajlar, {
    model,
    gpu: karar.gpu,
    dusunme: secim.dusunme !== undefined ? secim.dusunme : !!ayar.ceviriDusunme,
    // CPU'ya düştüysek oyun/başka bir şey kaynağı zorluyor demektir —
    // modeli bellekte tutmak durumu kötüleştirir, hemen bırak.
    keepAlive: karar.gpu ? (ayar.ceviriBellekteKalsin || '5m') : '0s',
    // GPU kararı verilse bile VRAM gerçekte çekişmeli olabilir (oyun menüde
    // az VRAM tutup oyuna girince doldurabiliyor). 120 sn kısa kalıp
    // "aborted" hatası veriyordu — pay bırakıldı.
    zamanAsimi: karar.gpu ? 300000 : 600000,
  });

  // CPU modunda ayrıca zorla boşalt — oyundan çıkıldıktan sonra da
  // makinenin teklediği ölçüldü.
  if (!karar.gpu) MOTORLAR.ollama.bosalt(model).catch(() => {});

  // Model düşünmesini cevap sanıp bastıysa sessizce gösterme — hangi modelin
  // uygun olmadığını söyle, kullanıcı değiştirebilsin.
  if (r.dusunmeSizintisi) {
    ctx.log(`${model} düşünmeyi kapatmıyor — cevap yerine akıl yürütme döndü`);
    throw new Error(
      `"${model}" düşünme kipini kapatmıyor: cevap yerine kendi akıl yürütmesini ` +
      `döndürdü. Bu modelle çeviri yapılamaz — ayarlardan başka bir model seç ` +
      `(örn. qwen3:8b).`);
  }

  return {
    metin: r.metin,
    model: r.model,
    ms: r.ms,
    cihaz: karar.gpu ? 'GPU' : 'CPU',
    gerekce: karar.gerekce,
    olcum: karar.olcum,
  };
}

function init(_ctx) {
  ctx = _ctx;

  ctx.komut('durum', async () => {
    const ayar = ctx.ayarlar.get();
    const d = await MOTORLAR.ollama.hazirMi();
    return {
      motor: 'ollama',
      ...d,
      secili: ayar.ceviriModel || (d.modeller && d.modeller[0] && d.modeller[0].ad) || null,
      // Arayüz "otomatik" ile "elle seçilmiş"i ayırt edebilsin — ikisi aynı
      // modele işaret etse bile durum farklı.
      elleSecildi: !!ayar.ceviriModel,
      sonKarar,
      uzakAcik: !!ayar.uzakAcik,
      uzakNeZaman: ayar.uzakNeZaman || 'oyunda',
    };
  });

  /** Uzak motorların durumu — ayar ekranı ve "kotam ne kadar kaldı" için. */
  ctx.komut('uzak-durum', async () => {
    const ayar = ctx.ayarlar.get();
    const [d, a] = await Promise.all([
      (ayar.deeplAnahtar || '').trim()
        ? MOTORLAR.deepl.hazirMi(ayar)
        : Promise.resolve({ hazir: false, sebep: 'anahtar girilmemiş' }),
      MOTORLAR.api.hazirMi(ayar),
    ]);
    return {
      acik: !!ayar.uzakAcik,
      neZaman: ayar.uzakNeZaman || 'oyunda',
      deepl: d,
      api: { hazir: a.hazir, sebep: a.sebep, model: a.model },
    };
  });

  /** Uzak motoru aç/kapat ve alanlarını kaydet. */
  ctx.komut('uzak-ayarla', async (a) => {
    const y = {};
    for (const k of ['uzakAcik', 'uzakNeZaman', 'deeplAnahtar', 'deeplUc',
                     'apiUrl', 'apiAnahtar', 'apiModel']) {
      if (a[k] !== undefined) y[k] = a[k];
    }
    ctx.ayarlar.set(y);
    if (y.uzakAcik !== undefined) {
      ctx.log(y.uzakAcik
        ? '⚠ UZAK MOTOR AÇILDI — seçilen metin dışarı gönderilecek'
        : 'uzak motor kapatıldı — her şey yerelde');
    }
    return { tamam: true };
  });

  /**
   * API ucunu GERÇEKTEN dene — alanların dolu olması çalıştığı anlamına gelmiyor.
   * Model adı yanlış, kota dolu, adres başka bir şey olabilir. Küçük bir istek.
   */
  ctx.komut('api-sina', async () => {
    const ayar = ctx.ayarlar.get();
    const d = await MOTORLAR.api.hazirMi(ayar);
    if (!d.hazir) throw new Error(d.sebep);
    ctx.log('API ucu sınanıyor — küçük bir istek gönderiliyor');
    const r = await MOTORLAR.api.uret([
      { role: 'user', content: 'Şunu Türkçeye çevir, sadece çeviriyi yaz: "The remote certificate is invalid."' },
    ], ayar, { enFazlaToken: 60, zamanAsimi: 25000 });
    return { model: r.model, ms: r.ms, ornek: (r.metin || '').slice(0, 80) };
  });

  /** Çalıştırmadan önce durum kontrolü — yavaş olacaksa arayüz kullanıcıya sorsun. */
  ctx.komut('plan', async (a) => {
    const p = await planYap((a && a.islem) || 'cevir');
    return {
      motor: p.motor, model: p.model, boyutGb: p.boyutGb,
      cihaz: p.uzak ? (p.motor === 'deepl' ? 'DeepL' : 'API') : (p.karar.gpu ? 'GPU' : 'CPU'),
      uzak: !!p.uzak,
      gerekce: p.gerekce, tahminSn: p.tahminSn,
      cokYavas: p.cokYavas, uyari: p.uyari,
    };
  });

  ctx.komut('cevir', async (a) => {
    const metin = (a.metin || '').trim();
    if (!metin) throw new Error('çevrilecek metin yok');
    const plan = await planYap('cevir');
    if (plan.cokYavas && !a.yavasOnayli) return { onayGerekli: true, ...plan, karar: undefined };

    if (plan.motor === 'deepl') {
      ctx.log(`UZAK · DeepL · ${plan.gerekce} — metin dışarı gönderiliyor`);
      const r = await MOTORLAR.deepl.cevir(metin, ctx.ayarlar.get(), { hedef: a.hedef || 'tr' });
      return {
        metin: r.metin, model: 'DeepL', ms: r.ms, cihaz: 'DeepL', uzak: true,
        gerekce: plan.gerekce, kaynakDil: r.kaynakDil, karakter: r.karakter,
      };
    }
    return calistir(ceviriMesajlari(metin, a.hedef || 'tr'), { plan });
  });

  /**
   * Satır satır çeviri — sonuç kaynak satırın hemen altına yazılacak.
   * Yan panel yerine bu isteniyor: "çevirdiği kelimenin hemen kenarında olsa".
   *
   * Hizalama tutmazsa `hizalandi:false` dönüyoruz; arayüz yan panele düşsün.
   * Yanlış satırın altına çeviri basmak sessiz ve güven kırıcı bir hata.
   */
  ctx.komut('cevir-satir', async (a) => {
    const satirlar = (a.satirlar || []).map((s) => String(s));
    if (!satirlar.length) throw new Error('çevrilecek satır yok');

    const plan = await planYap('cevir');
    if (plan.cokYavas && !a.yavasOnayli) return { onayGerekli: true, ...plan, karar: undefined };

    // ⚠️ ÖLÇÜLDÜ: hizalama 30 satıra kadar sağlam, ama metin modu ekranın
    // TAMAMINI seçili başlatıyor — 60-100 satır olabiliyor ve model o kadarında
    // satır düşürüyor. Ölçüldü: altyazı basılmadı, panele düştü.
    //
    // Çözüm parçalama. Her parça KENDİ İÇİNDE doğrulanıyor, yani bir parça
    // tutmasa bile diğerlerinin hizası güvenilir — yanlış satıra çeviri
    // basma riski yok. Tutmayan parça çevrilmemiş kalır, uydurulmaz.
    const PARCA = 20;
    if (satirlar.length > PARCA && plan.motor !== 'deepl') {
      const sonuc = new Array(satirlar.length).fill(null);
      let toplamMs = 0, basarili = 0, parcaSayisi = 0;

      for (let i = 0; i < satirlar.length; i += PARCA) {
        const dilim = satirlar.slice(i, i + PARCA);
        parcaSayisi++;
        try {
          const r = await calistir(satirCeviriMesajlari(dilim, a.hedef || 'tr'), { plan });
          toplamMs += r.ms;
          const ayri = satirCeviriAyristir(r.metin, dilim.length);
          if (ayri) {
            ayri.forEach((s, j) => { sonuc[i + j] = s; });
            basarili++;
          } else {
            ctx.log(`parça ${parcaSayisi} hizalanmadı (${dilim.length} satır) — o satırlar boş bırakıldı`);
          }
        } catch (e) {
          ctx.log(`parça ${parcaSayisi} hata: ${e.message}`);
        }
      }

      if (!basarili) {
        return { metin: '', satirlar: null, hizalandi: false, model: plan.model || 'yerel',
                 ms: toplamMs, cihaz: plan.uzak ? 'API' : 'GPU', uzak: !!plan.uzak,
                 gerekce: plan.gerekce };
      }
      return {
        metin: sonuc.filter(Boolean).join('\n'),
        satirlar: sonuc, hizalandi: true,
        parca: { toplam: parcaSayisi, basarili },
        model: plan.model || 'yerel', ms: toplamMs,
        cihaz: plan.uzak ? 'API' : 'GPU', uzak: !!plan.uzak, gerekce: plan.gerekce,
      };
    }

    // DeepL her satırı AYRI çeviriyor — hizalama sorunu yapısal olarak yok.
    // LLM'de en kırılgan yer buydu (numaralı format + doğrulama gerekiyordu).
    if (plan.motor === 'deepl') {
      ctx.log(`UZAK · DeepL · ${satirlar.length} satır — metin dışarı gönderiliyor`);
      const r = await MOTORLAR.deepl.satirCevir(satirlar, ctx.ayarlar.get(), { hedef: a.hedef || 'tr' });
      return {
        metin: r.satirlar.join('\n'), satirlar: r.satirlar, hizalandi: true,
        model: 'DeepL', ms: r.ms, cihaz: 'DeepL', uzak: true,
        gerekce: plan.gerekce, kaynakDil: r.kaynakDil, karakter: r.karakter,
      };
    }

    const r = await calistir(satirCeviriMesajlari(satirlar, a.hedef || 'tr'), { plan });
    const ayri = satirCeviriAyristir(r.metin, satirlar.length);
    if (!ayri) {
      ctx.log(`satır hizalaması tutmadı (${satirlar.length} bekleniyordu) — panele düşülüyor`);
      return { ...r, hizalandi: false, satirlar: null };
    }
    return { ...r, hizalandi: true, satirlar: ayri };
  });

  ctx.komut('acikla', async (a) => {
    const metin = (a.metin || '').trim();
    if (!metin) throw new Error('açıklanacak metin yok');
    // 'acikla' verildiği için DeepL bu plana hiç aday olmaz — çeviri motoru,
    // açıklama yapamaz. Uzak açıksa API ucu, değilse yerel model.
    const plan = await planYap('acikla');
    if (plan.cokYavas && !a.yavasOnayli) return { onayGerekli: true, ...plan, karar: undefined };
    return calistir(aciklaMesajlari(metin), { plan });
  });

  ctx.komut('model-sec', async (a) => {
    ctx.ayarlar.set({ ceviriModel: a.model || '' });
    return { secili: a.model || '(otomatik)' };
  });

  /** Modeli bellekten at — VRAM'i hemen geri ver (oyuna gireceksen). */
  ctx.komut('bosalt', async () => {
    const d = await MOTORLAR.ollama.hazirMi();
    if (!d.hazir) return { bosaltildi: false, sebep: d.sebep };
    const ayar = ctx.ayarlar.get();
    const model = ayar.ceviriModel || d.modeller[0].ad;
    return { bosaltildi: await MOTORLAR.ollama.bosalt(model), model };
  });

  ctx.log('hazır');
}

module.exports = { init };
