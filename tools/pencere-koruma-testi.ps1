# Bir pencerenin YAKALAMA KORUMASI var mı — içeriğine BAKMADAN.
#
# GetWindowDisplayAffinity yalnızca bir bayrak döndürür:
#   0 = WDA_NONE               normal, yakalanabilir
#   1 = WDA_MONITOR            yakalamada SİYAH çıkar
#   17 = WDA_EXCLUDEFROMCAPTURE yakalamada YOK sayılır
#
# shot88 overlay'i de bu bayrağı kullanıyor (kendini yakalamasın diye).
#
#   powershell -ExecutionPolicy Bypass -File tools/pencere-koruma-testi.ps1
#   powershell ... -File tools/pencere-koruma-testi.ps1 -Filtre telegram

param([string]$Filtre = "")

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Pencere {
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint dwAffinity);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr p);
}
"@

$bulunan = New-Object System.Collections.ArrayList
$cb = [Pencere+EnumProc]{
  param($h, $p)
  if (-not [Pencere]::IsWindowVisible($h)) { return $true }
  $n = [Pencere]::GetWindowTextLength($h)
  if ($n -lt 1) { return $true }
  $sb = New-Object System.Text.StringBuilder ($n + 1)
  [void][Pencere]::GetWindowTextW($h, $sb, $sb.Capacity)
  $baslik = $sb.ToString()
  $aff = 0
  [void][Pencere]::GetWindowDisplayAffinity($h, [ref]$aff)
  [void]$bulunan.Add([pscustomobject]@{ Baslik = $baslik; Koruma = $aff })
  return $true
}
[void][Pencere]::EnumWindows($cb, [IntPtr]::Zero)

$ad = @{ 0 = "yok (yakalanabilir)"; 1 = "WDA_MONITOR (siyah cikar)"; 17 = "WDA_EXCLUDEFROMCAPTURE (hic cikmaz)" }

$liste = $bulunan
if ($Filtre) { $liste = $bulunan | Where-Object { $_.Baslik -match $Filtre } }

Write-Output "=== gorunur pencereler ve yakalama korumasi ==="
foreach ($p in $liste) {
  $k = if ($ad.ContainsKey([int]$p.Koruma)) { $ad[[int]$p.Koruma] } else { "bilinmeyen ($($p.Koruma))" }
  $isaret = if ($p.Koruma -ne 0) { "KORUMALI ->" } else { "           " }
  Write-Output ("{0} {1,-42} {2}" -f $isaret, $p.Baslik.Substring(0, [Math]::Min(42, $p.Baslik.Length)), $k)
}
Write-Output ""
Write-Output ("korumali pencere sayisi: " + (($bulunan | Where-Object { $_.Koruma -ne 0 }).Count) + " / " + $bulunan.Count)
