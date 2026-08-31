using System.Runtime.InteropServices;

namespace DeightShot.Native;

/// <summary>
/// Düşük seviye klavye hook'u (WH_KEYBOARD_LL) — uiohook-napi'nin YAPAMADIĞI şeyi yapar:
/// tuşu **yutar**, yani odaktaki uygulamaya hiç geçirmez.
///
/// Neden gerekli: Ins'e basınca DeightShot overlay'i açılıyor ama tuş aynı anda
/// editöre de gidip "overtype" (OVR) modunu açıyordu. Gerçek tuşla ölçülerek
/// doğrulandı.
///
/// ⚠️ Otomatik tekrar: Windows tuş basılı tutulunca ~43ms'de bir WM_KEYDOWN
/// gönderir (2 saniyede ~49 tane). İlk keydown'dan sonrakiler yok sayılmazsa
/// "basılı tut = tam ekran" hiç tetiklenmez.
/// </summary>
internal static class Hotkey
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    // Kendi gonderdigimiz sentetik tuslari tanimak icin (test scriptleri)
    private const uint LLKHF_INJECTED = 0x10;

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessageW(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int ptX, ptY; }

    private const uint WM_QUIT = 0x0012;

    // ---- durum ----
    private static IntPtr _hook = IntPtr.Zero;
    private static HookProc _proc;          // GC toplamasin diye alanda tutuluyor
    private static Thread _thread;
    private static uint _threadId;

    private static uint _vk;                // izlenen sanal tus kodu
    private static bool _yut;               // tusu odaktaki uygulamadan gizle
    private static bool _basili;            // ilk keydown geldi mi
    private static long _basimT0;
    private static int _tekrar;

    /// <summary>Olay yayinlayici — Program.cs stdout'a yazar.</summary>
    public static Action<object> OlayYolla { get; set; }

    public static bool Calisiyor => _hook != IntPtr.Zero;

    public static void Baslat(uint vkCode, bool yut)
    {
        Durdur();

        _vk = vkCode;
        _yut = yut;
        _basili = false;
        _tekrar = 0;

        var kuruldu = new ManualResetEventSlim(false);
        Exception hata = null;

        // Hook, mesaj dongusu olan bir thread'e kurulmali.
        _thread = new Thread(() =>
        {
            try
            {
                _threadId = GetCurrentThreadId();
                _proc = HookCallback;
                _hook = SetWindowsHookExW(WH_KEYBOARD_LL, _proc, GetModuleHandleW(null), 0);
                if (_hook == IntPtr.Zero)
                    throw new InvalidOperationException($"SetWindowsHookEx basarisiz (Win32 {Marshal.GetLastWin32Error()})");
            }
            catch (Exception ex) { hata = ex; }
            finally { kuruldu.Set(); }

            if (_hook == IntPtr.Zero) return;

            // Mesaj dongusu — hook'un calismasi icin sart.
            while (GetMessageW(out MSG msg, IntPtr.Zero, 0, 0) > 0) { }

            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        })
        { IsBackground = true, Name = "deightshot-hotkey" };

        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        kuruldu.Wait(3000);
        if (hata is not null) throw hata;
    }

    public static void Durdur()
    {
        if (_threadId != 0)
        {
            PostThreadMessageW(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            _threadId = 0;
        }
        _thread = null;
        _basili = false;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(_hook, nCode, wParam, lParam);

        var veri = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
        if (veri.vkCode != _vk) return CallNextHookEx(_hook, nCode, wParam, lParam);

        int msg = (int)wParam;
        bool asagi = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        bool yukari = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        if (asagi)
        {
            if (_basili)
            {
                // OTOMATIK TEKRAR — yok say, sayaci sifirlama.
                _tekrar++;
            }
            else
            {
                _basili = true;
                _tekrar = 0;
                _basimT0 = Environment.TickCount64;
                OlayYolla?.Invoke(new { evt = "hotkey", state = "down" });
            }
        }
        else if (yukari && _basili)
        {
            _basili = false;
            OlayYolla?.Invoke(new
            {
                evt = "hotkey",
                state = "up",
                heldMs = (int)(Environment.TickCount64 - _basimT0),
                repeats = _tekrar,
            });
        }

        // YUTMA: CallNextHookEx cagirilmazsa tus odaktaki uygulamaya HIC gitmez.
        if (_yut) return new IntPtr(1);

        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }
}
