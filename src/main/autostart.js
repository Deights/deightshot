// Windows açılışında otomatik başlatma.
//
// Electron'un `app.setLoginItemSettings` API'si bunu Çalıştır (Run) kayıt
// anahtarına yazarak yapıyor — yönetici yetkisi gerekmiyor.
//
// ⚠️ Geliştirme modunda anlamsız: kayda `electron.exe .` yazılır, o da
// node_modules yolu taşındığında bozulur. Sadece paketlenmiş uygulamada açılır.
const { app } = require('electron');
const settings = require('./settings');

const paketliMi = () => app.isPackaged;

function durum() {
  if (!paketliMi()) return { destekleniyor: false, acik: false };
  try {
    const s = app.getLoginItemSettings();
    return { destekleniyor: true, acik: !!s.openAtLogin };
  } catch {
    return { destekleniyor: false, acik: false };
  }
}

function ayarla(acik) {
  if (!paketliMi()) {
    console.warn('[otomatik-baslat] geliştirme modunda atlanıyor');
    return false;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: acik,
      // Açılışta pencere göstermesin — zaten tray uygulaması, ama
      // Windows'un "başlangıçta gizli" işaretini de veriyoruz.
      openAsHidden: true,
      args: ['--gizli-baslat'],
    });
    settings.set({ otomatikBaslat: acik });
    console.log(`[otomatik-baslat] ${acik ? 'AÇIK' : 'kapalı'}`);
    return true;
  } catch (e) {
    console.error('[otomatik-baslat] ayarlanamadı:', e.message);
    return false;
  }
}

/** Açılışta ayarla dosyasıyla Windows kaydını hizala (kullanıcı elle değiştirmiş olabilir). */
function esitle() {
  if (!paketliMi()) return;
  const d = durum();
  const istenen = settings.get().otomatikBaslat;
  if (d.acik !== istenen) ayarla(istenen);
}

module.exports = { durum, ayarla, esitle, paketliMi };
