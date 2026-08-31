// Çeviri ayarları penceresi.
//
// Tasarım kararı: anahtarlar yazılır yazılmaz KAYDEDİLMEZ; alan odaktan
// çıkınca ya da "sına"ya basınca kaydedilir. Yarım yapıştırılmış bir anahtarla
// arka planda istek atılmasın.

const el = (id) => document.getElementById(id);

const ALANLAR = ['deeplAnahtar', 'apiUrl', 'apiAnahtar', 'apiModel'];

let yukleniyor = true;

function durumYaz(hedef, metin, sinif) {
  const d = el(hedef);
  d.textContent = metin;
  d.className = 'durum' + (sinif ? ' ' + sinif : '');
}

function govdeGuncelle() {
  const acik = el('uzakAcik').checked;
  if (acik) el('uzakGovde').removeAttribute('data-kapali');
  else el('uzakGovde').setAttribute('data-kapali', '');
}

async function cagir(komut, veri) {
  const c = await window.shot88.modul('ceviri', komut, veri || {});
  if (!c.ok) throw new Error(c.error);
  return c.data;
}

/** Uzak alanları kaydet. Anahtar boşsa da kaydedilir (silme işlemi). */
async function kaydet(alanlar) {
  if (yukleniyor) return;
  const y = {};
  for (const k of alanlar) y[k] = el(k).value.trim();
  await cagir('uzak-ayarla', y);
  durumYaz('kayitDurum', 'kaydedildi', 'iyi');
  setTimeout(() => durumYaz('kayitDurum', ''), 1600);
}

// --- ilk yükleme ---
(async () => {
  try {
    const [d, u] = await Promise.all([cagir('durum'), cagir('uzak-durum')]);

    // yerel modeller
    const sec = el('model');
    sec.textContent = '';
    if (d.hazir && d.modeller && d.modeller.length) {
      const oto = document.createElement('option');
      oto.value = ''; oto.textContent = '(otomatik — ölçüme göre en iyisi)';
      sec.appendChild(oto);
      for (const m of d.modeller) {
        const o = document.createElement('option');
        o.value = m.ad;
        // Puanı gösterme, anlamı yok; ölçülmüş olanı işaretle.
        o.textContent = `${m.ad}  (${m.boyutGb} GB)` + (m.puan >= 40 ? '  ✓ ölçüldü' : '');
        sec.appendChild(o);
      }
      sec.value = d.elleSecildi && d.modeller.some((m) => m.ad === d.secili) ? d.secili : '';
      durumYaz('yerelDurum',
        `${d.modeller.length} model kurulu · ` +
        (d.elleSecildi ? `elle seçildi: ${d.secili}` : `otomatik → ${d.secili}`),
        'iyi');
    } else {
      const o = document.createElement('option');
      o.textContent = '(model yok)';
      sec.appendChild(o);
      sec.disabled = true;
      durumYaz('yerelDurum', d.sebep || 'Ollama çalışmıyor', 'kotu');
    }

    // uzak
    el('uzakAcik').checked = !!u.acik;
    el('neZaman').value = u.neZaman || 'oyunda';
    govdeGuncelle();

    if (u.deepl && u.deepl.hazir) {
      durumYaz('deeplDurum',
        `bağlı · kalan ${u.deepl.kalan.toLocaleString('tr')} / ${u.deepl.limit.toLocaleString('tr')} karakter`,
        'iyi');
    }
    if (u.api && u.api.hazir) durumYaz('apiDurum', `yapılandırıldı · ${u.api.model}`, 'iyi');
  } catch (e) {
    durumYaz('kayitDurum', e.message, 'kotu');
  } finally {
    yukleniyor = false;
  }
})();

// --- olaylar ---
el('uzakAcik').addEventListener('change', async () => {
  govdeGuncelle();
  await cagir('uzak-ayarla', { uzakAcik: el('uzakAcik').checked });
  durumYaz('kayitDurum', el('uzakAcik').checked
    ? 'uzak motor AÇIK — metin dışarı gidebilir'
    : 'uzak motor kapalı — her şey yerelde', el('uzakAcik').checked ? 'kotu' : 'iyi');
});

el('neZaman').addEventListener('change', () =>
  cagir('uzak-ayarla', { uzakNeZaman: el('neZaman').value }));

el('model').addEventListener('change', async () => {
  await cagir('model-sec', { model: el('model').value });
  durumYaz('yerelDurum', `seçili: ${el('model').value || 'otomatik'}`, 'iyi');
});

// Odaktan çıkınca kaydet — her tuşta değil.
for (const k of ALANLAR) el(k).addEventListener('blur', () => kaydet([k]));

// Anahtarı göster/gizle
for (const [dugme, alan] of [['deeplGoster', 'deeplAnahtar'], ['apiGoster', 'apiAnahtar']]) {
  el(dugme).addEventListener('click', () => {
    const i = el(alan);
    i.type = i.type === 'password' ? 'text' : 'password';
  });
}

el('deeplTest').addEventListener('click', async () => {
  await kaydet(['deeplAnahtar']);
  durumYaz('deeplDurum', 'sınanıyor…', 'bekle');
  el('deeplTest').disabled = true;
  try {
    const u = await cagir('uzak-durum');
    if (u.deepl.hazir) {
      durumYaz('deeplDurum',
        `✓ bağlandı · ${u.deepl.ucretsiz ? 'ücretsiz katman' : 'ücretli'} · ` +
        `kalan ${u.deepl.kalan.toLocaleString('tr')} / ${u.deepl.limit.toLocaleString('tr')} karakter`,
        'iyi');
    } else {
      durumYaz('deeplDurum', '✗ ' + u.deepl.sebep, 'kotu');
    }
  } catch (e) {
    durumYaz('deeplDurum', '✗ ' + e.message, 'kotu');
  } finally {
    el('deeplTest').disabled = false;
  }
});

el('apiTest').addEventListener('click', async () => {
  await kaydet(['apiUrl', 'apiAnahtar', 'apiModel']);
  durumYaz('apiDurum', 'sınanıyor… (küçük bir istek gönderiliyor)', 'bekle');
  el('apiTest').disabled = true;
  try {
    // Gerçekten çalışıyor mu — sadece alan dolu mu değil, uç cevap veriyor mu.
    const r = await cagir('api-sina');
    durumYaz('apiDurum', `✓ ${r.model} · ${r.ms} ms · cevap: "${r.ornek}"`, 'iyi');
  } catch (e) {
    durumYaz('apiDurum', '✗ ' + e.message, 'kotu');
  } finally {
    el('apiTest').disabled = false;
  }
});


// ---------------------------------------------------------------- kısayol

let atanabilir = [];      // [{code, ad}]
let cakismalar = {};
let dinliyor = false;

function tusYaz(ad) { el('tusAta').textContent = ad || '—'; }

/** "Tuşa bas" kipini bitir. */
function dinlemeyiBitir() {
  dinliyor = false;
  el('tusAta').removeAttribute('data-dinliyor');
}

async function kisayolYukle() {
  try {
    const d = await window.shot88.kisayolDurum();
    atanabilir = d.tuslar || [];
    cakismalar = d.cakisma || {};
    tusYaz(d.ad);
    el('basiliTut').value = String(d.basiliTutmaMs);
    el('tusuYut').checked = !!d.tusuYut;

    // Tuş yutma yalnızca native hook ile mümkün — uiohook yedeğindeyken
    // seçeneği açık bırakmak yalan olur.
    const nativeVar = d.motor === 'native';
    el('tusuYut').disabled = !nativeVar;
    durumYaz('motorDurum',
      nativeVar
        ? 'Kısayol motoru: native hook (tuş yutulabiliyor)'
        : `Kısayol motoru: ${d.motor || 'YOK'} — tuş yutulamıyor`,
      nativeVar ? 'iyi' : 'kotu');
  } catch (e) {
    durumYaz('motorDurum', 'kısayol durumu okunamadı: ' + e.message, 'kotu');
  }
}

el('tusAta').addEventListener('click', () => {
  if (dinliyor) { dinlemeyiBitir(); kisayolYukle(); return; }
  dinliyor = true;
  el('tusAta').setAttribute('data-dinliyor', '');
  el('tusAta').textContent = 'bir tuşa bas…';
  durumYaz('tusDurum', 'Esc ile vazgeç', 'bekle');
});

// Dinleme kipindeyken TÜM tuşlar burada yakalanıyor; sayfanın geri kalanına
// gitmesin (Enter'ın düğmeye basması gibi kazalar olmasın).
window.addEventListener('keydown', async (e) => {
  if (!dinliyor) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.code === 'Escape') {
    dinlemeyiBitir();
    durumYaz('tusDurum', '');
    kisayolYukle();
    return;
  }

  const t = atanabilir.find((x) => x.code === e.code);
  if (!t) {
    // Neden olmadığını söyle — sessizce yok saymak "bozuk" hissi veriyor.
    durumYaz('tusDurum', `"${e.key}" atanamaz — yazıda kullanılmayan bir tuş seç`, 'kotu');
    return;
  }

  dinlemeyiBitir();
  durumYaz('tusDurum', 'uygulanıyor…', 'bekle');
  try {
    const r = await window.shot88.kisayolKur({ code: t.code });
    tusYaz(r.ad);
    const uyari = cakismalar[t.code];
    durumYaz('tusDurum', uyari ? `${r.ad} atandı · ⚠ ${uyari}` : `${r.ad} atandı`,
      uyari ? 'bekle' : 'iyi');
  } catch (err) {
    durumYaz('tusDurum', 'olmadı: ' + err.message, 'kotu');
    kisayolYukle();
  }
}, true);

el('basiliTut').addEventListener('change', async () => {
  await window.shot88.kisayolKur({ basiliTutmaMs: +el('basiliTut').value });
  durumYaz('tusDurum', 'basılı tutma güncellendi', 'iyi');
});

el('tusuYut').addEventListener('change', async () => {
  const r = await window.shot88.kisayolKur({ tusuYut: el('tusuYut').checked });
  durumYaz('tusDurum', el('tusuYut').checked
    ? 'tuş artık diğer uygulamalara gitmiyor'
    : 'tuş diğer uygulamalara da gidiyor', 'iyi');
  if (!r.tamam) durumYaz('motorDurum', 'kısayol yeniden kurulamadı!', 'kotu');
});

kisayolYukle();

// ---------------------------------------------------------------- kapatma
el('kapat').addEventListener('click', () => window.shot88.kapat());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.shot88.kapat();
});
