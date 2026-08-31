using System.Runtime.InteropServices;
using Vortice.DXGI;

namespace Shot88.Native;

/// <param name="VramToplamMb">Ekran kartının özel belleği (donanım).</param>
/// <param name="VramSurecKullanimMb">SADECE bizim sürecimizin kullandığı VRAM.</param>
/// <param name="VramButceMb">
/// OS'un şu an bu sürece ayırdığı üst sınır. Başkaları doldurdukça küçülür —
/// asıl karar sinyali bu. nvidia-smi'nin "used/free"si sistem geneli olduğu için
/// bu sayılarla birebir tutmaz; aynı şeyi ölçmüyorlar.
/// </param>
/// <param name="VramAlinabilirMb">Bütçe eksi kendi kullanımımız = pratikte alabileceğimiz.</param>
internal sealed record KaynakDurumu(
    long VramToplamMb,
    long VramSurecKullanimMb,
    long VramButceMb,
    long VramAlinabilirMb,
    double CpuYuzde,
    int CekirdekSayisi,
    long RamToplamMb,
    long RamBosMb,
    bool TamEkranUygulamaVar,
    string OnPlanUygulama,
    string VramHatasi);

/// <summary>
/// CPU / GPU / RAM ölçümü — çeviri motorunun nereden çalışacağına karar vermek için.
///
/// Tasarım notundaki ilk kural "oyun çalışıyorsa GPU'ya dokunma" idi; bunun
/// fazla kaba olduğu görüldü: rekabetçi oyunlar (LoL, Valorant, CS)
/// CPU'ya yüklenir, GPU'yu az kullanır — orada GPU zaten boştur ve DOĞRU seçimdir.
/// Cyberpunk gibi oyunlarda tam tersi. O yüzden "oyun var mı" değil,
/// "şu an neresi boş" ölçülüyor.
///
/// nvidia-smi'ye bağımlı DEĞİL: DXGI'den okuyor, AMD/Intel'de de çalışır.
/// </summary>
internal static class Resources
{
    // ---- RAM ----
    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys;
        public ulong ullTotalPageFile, ullAvailPageFile;
        public ulong ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    // ---- CPU ----
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

    private static long _oncekiIdle, _oncekiKernel, _oncekiUser;
    private static bool _ilkOlcum = true;

    /// <summary>
    /// CPU yükü. İki ölçüm arasındaki farktan hesaplanır, bu yüzden ilk çağrıda
    /// kısa bir örnekleme yapılır (PerformanceCounter'ın ağırlığına gerek yok).
    /// </summary>
    private static double CpuYuku()
    {
        if (_ilkOlcum)
        {
            GetSystemTimes(out _oncekiIdle, out _oncekiKernel, out _oncekiUser);
            Thread.Sleep(120);
            _ilkOlcum = false;
        }

        GetSystemTimes(out long idle, out long kernel, out long user);

        long dIdle = idle - _oncekiIdle;
        long dKernel = kernel - _oncekiKernel;
        long dUser = user - _oncekiUser;

        _oncekiIdle = idle; _oncekiKernel = kernel; _oncekiUser = user;

        // kernel zamanı idle'ı da içerir
        long toplam = dKernel + dUser;
        if (toplam <= 0) return 0;
        return Math.Clamp(100.0 * (toplam - dIdle) / toplam, 0, 100);
    }

    // ---- Tam ekran uygulama (oyun ipucu) ----
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    [DllImport("user32.dll")] private static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFO mi);

    /// <summary>
    /// Ön plandaki pencere bulunduğu monitörü tamamen kaplıyor mu?
    /// Kesin "oyun tespiti" değil — öyle bir şey güvenilir yapılamıyor.
    /// Sadece bir ipucu; karar asıl ölçümlere dayanıyor.
    /// </summary>
    private static (bool tamEkran, string uygulama) OnPlanDurumu()
    {
        try
        {
            IntPtr h = GetForegroundWindow();
            if (h == IntPtr.Zero) return (false, "");

            GetWindowThreadProcessId(h, out int pid);
            string ad = "";
            try { ad = System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch { }

            // Kabuk süreçleri "tam ekran uygulama" sayılmaz
            if (ad is "explorer" or "ShellExperienceHost" or "SearchHost" or "StartMenuExperienceHost")
                return (false, ad);

            if (!GetWindowRect(h, out RECT w)) return (false, ad);

            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            IntPtr mon = MonitorFromWindow(h, 2 /* NEAREST */);
            if (!GetMonitorInfoW(mon, ref mi)) return (false, ad);

            // 2 px tolerans — kenarlıksız tam ekran birebir oturmayabiliyor
            bool tam = w.Left <= mi.rcMonitor.Left + 2 && w.Top <= mi.rcMonitor.Top + 2
                    && w.Right >= mi.rcMonitor.Right - 2 && w.Bottom >= mi.rcMonitor.Bottom - 2;

            return (tam, ad);
        }
        catch { return (false, ""); }
    }

    // ---- VRAM ----
    /// <summary>Son VRAM okuma hatası (teşhis için) — başarılıysa null.</summary>
    public static string SonVramHatasi { get; private set; }

    private static (long toplam, long surecKullanim, long butce, long alinabilir) Vram()
    {
        // ⚠️ Vortice'de bellek alanları nuint/ulong. Bunları doğrudan (long)'a
        // çevirmek işaretli dönüşüm olduğu için OverflowException atıyordu.
        // Tüm aritmetik ulong'da yapılıp ÖNCE MB'a bölünüyor, sonra daraltılıyor.
        const ulong MB = 1024UL * 1024UL;
        try
        {
            using var fabrika = DXGI.CreateDXGIFactory1<IDXGIFactory1>();

            // En çok özel belleğe sahip adaptörü seç — 0. sıradaki bazen
            // temel/yazılım adaptörü oluyor ve 0 MB gösteriyor.
            IDXGIAdapter1 enIyi = null;
            ulong enIyiBellek = 0;

            for (uint i = 0; ; i++)
            {
                var sonuc = fabrika.EnumAdapters1(i, out IDXGIAdapter1 a);
                if (sonuc.Failure || a is null) break;

                var tanim = a.Description1;
                ulong ozel = (ulong)tanim.DedicatedVideoMemory;
                bool yazilim = (tanim.Flags & AdapterFlags.Software) != 0;

                if (!yazilim && ozel >= enIyiBellek) { enIyi?.Dispose(); enIyi = a; enIyiBellek = ozel; }
                else a.Dispose();
            }

            if (enIyi is null) { SonVramHatasi = "uygun adaptör bulunamadı"; return (0, 0, 0, 0); }

            using (enIyi)
            {
                ulong toplam = enIyiBellek;

                using var a3 = enIyi.QueryInterfaceOrNull<IDXGIAdapter3>();
                if (a3 is null)
                {
                    SonVramHatasi = "IDXGIAdapter3 desteklenmiyor (anlık kullanım okunamaz)";
                    return ((long)(toplam / MB), 0, 0, 0);
                }

                var bilgi = a3.QueryVideoMemoryInfo(0, MemorySegmentGroup.Local);
                ulong kullanilan = (ulong)bilgi.CurrentUsage;
                // Budget = OS'un bu sürece ayırdığı üst sınır. Gerçek "boş"
                // için bütçeden gitmek, toplam bellekten gitmekten doğru.
                ulong butce = (ulong)bilgi.Budget;
                ulong bos = butce > kullanilan ? butce - kullanilan : 0UL;

                SonVramHatasi = null;
                return ((long)(toplam / MB), (long)(kullanilan / MB),
                        (long)(butce / MB), (long)(bos / MB));
            }
        }
        catch (Exception ex)
        {
            var ilkSatir = (ex.StackTrace ?? "").Split('\n').FirstOrDefault()?.Trim() ?? "?";
            SonVramHatasi = $"{ex.GetType().Name}: {ex.Message} @ {ilkSatir}";
            return (0, 0, 0, 0);
        }
    }

    /// <summary>Sadece ön plan durumu — ölçüm beklemesi yok, anlık döner.</summary>
    public static object OnPlanHizli()
    {
        var (tamEkran, uygulama) = OnPlanDurumu();
        return new { tamEkranUygulamaVar = tamEkran, onPlanUygulama = uygulama };
    }

    public static KaynakDurumu Olc()
    {
        var (vToplam, vSurec, vButce, vAlinabilir) = Vram();
        var (tamEkran, uygulama) = OnPlanDurumu();

        var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        GlobalMemoryStatusEx(ref mem);

        return new KaynakDurumu(
            VramToplamMb: vToplam,
            VramSurecKullanimMb: vSurec,
            VramButceMb: vButce,
            VramAlinabilirMb: vAlinabilir,
            CpuYuzde: Math.Round(CpuYuku(), 1),
            CekirdekSayisi: Environment.ProcessorCount,
            RamToplamMb: (long)(mem.ullTotalPhys / (1024 * 1024)),
            RamBosMb: (long)(mem.ullAvailPhys / (1024 * 1024)),
            TamEkranUygulamaVar: tamEkran,
            OnPlanUygulama: uygulama,
            VramHatasi: SonVramHatasi);
    }
}
