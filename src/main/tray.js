// Tray ikonu — uygulama pencere göstermez, hep burada durur.
const { Tray, Menu, nativeImage, app, shell } = require('electron');
const path = require('path');
const state = require('./state');
const settings = require('./settings');
const capture = require('./capture');
const native = require('./native');
const hotkeys = require('./hotkeys');
const autostart = require('./autostart');
const ayarlarPenceresi = require('./ayarlar-penceresi');
const diller = require('./diller');

function init() {
  const ikon = nativeImage.createFromPath(
    path.join(__dirname, '..', '..', 'assets', 'tray-32.png')
  );

  state.tray = new Tray(ikon);
  state.tray.setToolTip('shot88 — ekran görüntüsü');
  menuKur();

  // TEK tık = bölge seçimi başlat. Tasarım kararı: "elim dolu olabilir, mouse ile
  // üstüne gelip sol tık yapayım". Menü sağ tıkta zaten duruyor.
  // Çift tıkta Windows önce 'click' yolluyor; ac() ikinci çağrıyı zaten yutuyor.
  state.tray.on('click', () => capture.ac());
}

function menuKur() {
  const s = settings.get();
  const menu = Menu.buildFromTemplate([
    { label: `shot88 ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: `Bölge seç  (${s.kisayolAd})`, click: () => capture.ac() },
    {
      label: 'Kayıt klasörünü aç',
      click: () => shell.openPath(s.kayitKlasoru),
    },
    { type: 'separator' },
    {
      label: `Basılı tutma: ${s.basiliTutmaMs}ms`,
      submenu: [600, 700, 1000, 2000].map((ms) => ({
        label: `${ms} ms`,
        type: 'radio',
        checked: s.basiliTutmaMs === ms,
        click: () => { settings.set({ basiliTutmaMs: ms }); menuKur(); },
      })),
    },
    {
      label: `OCR dili: ${diller.ad(s.ocrDil)}`,
      // Liste KURULU dillerden üretiliyor. Eskiden tr/en-US elle yazılıydı;
      // yeni dil paketi kurulunca menüde görünmüyordu.
      submenu: [
        { label: 'Otomatik  — ölçüldü 8/8', type: 'radio', checked: s.ocrDil === 'oto',
          toolTip: 'Dili kendisi bulur: Kiril/Han/Kana imzasına bakar, ' +
                   'Latin ise Türkçe ↔ İngilizce ayrımını yapar.',
          click: () => { settings.set({ ocrDil: 'oto' }); menuKur(); } },
        { label: diller.ad(''), type: 'radio', checked: s.ocrDil === '',
          click: () => { settings.set({ ocrDil: '' }); menuKur(); } },
        { type: 'separator' },
        ...(state.ocrDilleri.length
          ? state.ocrDilleri.map((k) => ({
              label: diller.ad(k), type: 'radio', checked: s.ocrDil === k,
              click: () => { settings.set({ ocrDil: k }); menuKur(); },
            }))
          : [{ label: '(dil listesi okunamadı)', enabled: false }]),
        { type: 'separator' },
        { label: 'Metin modunda tek tıkla da değiştirilebilir', enabled: false },
      ],
    },
    {
      label: `OCR büyütme: ${s.ocrOlcek}x`,
      submenu: [1, 1.5, 2, 3].map((o) => ({
        label: o === 1 ? 'Kapalı (1x)' : (o === 1.5 ? '1.5x  — ölçülen en iyi' : `${o}x`),
        type: 'radio',
        checked: s.ocrOlcek === o,
        click: () => { settings.set({ ocrOlcek: o }); menuKur(); },
      })),
    },
    {
      label: `${s.kisayolAd} tuşunu diğer uygulamalardan gizle`,
      type: 'checkbox',
      checked: s.tusuYut !== false,
      enabled: hotkeys.aktifMotor() === 'native',
      toolTip: hotkeys.aktifMotor() === 'native'
        ? 'Açıkken Ins editörde OVR modunu açmaz'
        : 'Yalnızca native hook ile mümkün (şu an uiohook yedeği çalışıyor)',
      click: async (mi) => {
        settings.set({ tusuYut: mi.checked });
        await hotkeys.durdur();
        await hotkeys.init();
        menuKur();
      },
    },
    { type: 'separator' },
    {
      // Uzak motor açıkken bunu menüden de görebilmek lazım — gizlilik durumu
      // sadece ayar penceresinin içinde saklı kalmasın.
      label: s.uzakAcik
        ? 'Ayarlar…   ⚠ uzak motor AÇIK'
        : 'Ayarlar…',
      click: () => ayarlarPenceresi.ac(),
    },
    { type: 'separator' },
    {
      label: native.calisiyorMu()
        ? `Native: çalışıyor · kısayol motoru: ${hotkeys.aktifMotor() || 'yok'}`
        : 'Native: YOK (npm run native:build)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Windows açılışında başlat',
      type: 'checkbox',
      checked: autostart.durum().acik,
      enabled: autostart.paketliMi(),
      toolTip: autostart.paketliMi()
        ? 'shot88 açılışta tray’de bekler'
        : 'Yalnızca kurulu sürümde çalışır (şu an geliştirme modundasın)',
      click: (mi) => { autostart.ayarla(mi.checked); menuKur(); },
    },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { state.kapaniyor = true; app.quit(); } },
  ]);
  state.tray.setContextMenu(menu);
}

module.exports = { init, menuKur };
