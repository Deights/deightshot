# Paketlemeyi BİR KEZ yönetici olarak çalıştırır.
#
# Neden gerekli: electron-builder'ın imzalama araç paketi (winCodeSign) içinde
# macOS sembolik bağlantıları var. Windows'ta sembolik bağlantı oluşturmak
# ayrıcalık istiyor; olmayınca arşiv açılamıyor ve paketleme düşüyor.
# Bize o macOS kısmı hiç lazım değil ama electron-builder tümünü açmaya çalışıyor.
#
# Bir kez yönetici olarak çalışınca cache doğru şekilde dolar,
# sonraki paketlemeler normal kullanıcıyla çalışır.
$ErrorActionPreference = 'Continue'
$kok = Split-Path -Parent $PSScriptRoot
$log = Join-Path $kok 'paketleme.log'

Set-Content -Path $log -Value "== paketleme $(Get-Date -Format s) ==" -Encoding utf8
Set-Location $kok

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

& "$kok\node_modules\.bin\electron-builder.cmd" --win --x64 *>&1 |
    Tee-Object -FilePath $log -Append

Add-Content -Path $log -Value "== cikis kodu: $LASTEXITCODE =="
