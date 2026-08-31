using System.Runtime.InteropServices;

namespace Shot88.Native;

/// <summary>
/// WGC icin gereken COM/WinRT kopruleri. .NET 5+ ile birlikte yerlesik WinRT
/// marshalling kaldirildigi icin HSTRING ve aktivasyon fabrikasi elle kuruluyor.
/// </summary>
internal static class Interop
{
    // Windows.Graphics.Capture.GraphicsCaptureItem
    internal static readonly Guid GraphicsCaptureItemIid =
        new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

    [ComImport]
    [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
        IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
    }

    [ComImport]
    [Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDirect3DDxgiInterfaceAccess
    {
        IntPtr GetInterface([In] ref Guid iid);
    }

    [DllImport("combase.dll", CharSet = CharSet.Unicode)]
    private static extern int WindowsCreateString(string sourceString, int length, out IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("combase.dll")]
    private static extern int RoGetActivationFactory(IntPtr activatableClassId, [In] ref Guid iid, out IntPtr factory);

    [DllImport("d3d11.dll", EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice", SetLastError = true)]
    internal static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    /// <summary>GraphicsCaptureItem aktivasyon fabrikasindan interop arayuzunu alir.</summary>
    internal static IGraphicsCaptureItemInterop GetCaptureItemInterop()
    {
        const string classId = "Windows.Graphics.Capture.GraphicsCaptureItem";

        int hr = WindowsCreateString(classId, classId.Length, out IntPtr hstr);
        if (hr != 0) throw Marshal.GetExceptionForHR(hr)!;

        try
        {
            Guid iid = typeof(IGraphicsCaptureItemInterop).GUID;
            hr = RoGetActivationFactory(hstr, ref iid, out IntPtr pFactory);
            if (hr != 0) throw Marshal.GetExceptionForHR(hr)!;

            return (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(pFactory);
        }
        finally
        {
            WindowsDeleteString(hstr);
        }
    }

    // ---- user32 ----

    internal const uint MONITOR_DEFAULTTOPRIMARY = 1;
    internal static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    internal static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowTextW(IntPtr hwnd, [Out] char[] text, int maxCount);

    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    internal delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    // Durağan pencereyi yeniden çizmeye zorlamak icin (WGC pencere modu
    // yalnizca pencere yeni kare urettiginde FrameArrived tetikliyor).
    internal const uint RDW_INVALIDATE = 0x0001;
    internal const uint RDW_ERASE = 0x0004;
    internal const uint RDW_FRAME = 0x0400;
    internal const uint RDW_ALLCHILDREN = 0x0080;
    internal const uint RDW_UPDATENOW = 0x0100;

    [DllImport("user32.dll")]
    internal static extern bool RedrawWindow(IntPtr hwnd, IntPtr lprcUpdate, IntPtr hrgnUpdate, uint flags);

    internal static void NudgeRepaint(IntPtr hwnd)
    {
        RedrawWindow(hwnd, IntPtr.Zero, IntPtr.Zero,
            RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
    }

    internal static string GetWindowTitle(IntPtr hwnd)
    {
        var buf = new char[512];
        int n = GetWindowTextW(hwnd, buf, buf.Length);
        return n > 0 ? new string(buf, 0, n) : string.Empty;
    }

    /// <summary>Basligi verilen metni iceren ilk gorunur pencereyi bulur.</summary>
    internal static IntPtr FindWindowByTitle(string needle)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            string title = GetWindowTitle(hwnd);
            if (title.Length == 0) return true;
            if (title.Contains(needle, StringComparison.OrdinalIgnoreCase))
            {
                found = hwnd;
                return false; // dur
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
