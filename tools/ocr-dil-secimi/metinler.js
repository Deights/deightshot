// OCR ölçümünün YER GERÇEĞİ. Değiştirirsen eski ölçümlerle kıyaslanamaz.
//
// `dil` alanı beklenen doğru cevap — otomatik seçim sezgisi bununla sınanıyor.
module.exports = [
  {
    ad: 'tr-dusuk-punto',
    punto: 15,
    dil: 'tr',
    metin: 'kanka selam iki gündür kullanıyorum ve beğenmediğim tarafları\n' +
           'şunlar: bazen ss almak istediğimde son aldığım ss görünüyor\n' +
           'gizlilik açısından çok kötü çünkü unutabilirim yanlış basıyor',
  },
  {
    ad: 'tr-yuksek-punto',
    punto: 22,
    dil: 'tr',
    metin: 'Görüş Alanı ayarını değiştir\nDüşman Sağlık Çubuğu açık\nZincir İyileştirme: Tek',
  },
  {
    ad: 'en-oyun-menusu',
    punto: 17,
    dil: 'en',
    metin: 'Incoming Damage Feedback\nCrosshair Damage Feedback\nWeapon Auto-Cycle on Empty\n' +
           'Taking Damage Closes Deathbox or Crafting Menu\nAlways Sprint',
  },
  {
    ad: 'en-dusuk-punto',
    punto: 13,
    dil: 'en',
    metin: 'Your account has been temporarily restricted due to unusual activity.\n' +
           'To restore access, verify your email address and enable two-factor authentication.',
  },
  {
    ad: 'ru-oyun',
    punto: 18,
    dil: 'ru',
    metin: 'Настройки графики\nРазмытие в движении\nПолноэкранный режим\nСохранить изменения',
  },
  {
    ad: 'zh-oyun',
    punto: 22,
    dil: 'zh',
    metin: '游戏设置\n视野范围\n开始游戏\n保存并退出',
  },
  {
    ad: 'ja-oyun',
    punto: 22,
    dil: 'ja',
    metin: 'ゲーム設定\n視野角\nセーブしますか\n装備を変更する',
  },
  {
    ad: 'karisik',
    punto: 16,
    dil: 'karisik',
    metin: 'Motion Blur kapalı olsun\nField of View: 90 derece\nAlways Sprint açık bırak',
  },
];
