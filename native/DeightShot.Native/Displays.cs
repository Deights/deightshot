using System.Runtime.InteropServices;

namespace DeightShot.Native;

internal sealed record DisplayInfo(
    int Index,
    long Hmon,
    int X,
    int Y,
    int Width,
    int Height,
    bool Primary,
    string DeviceName);

/// <summary>
/// Monitor listesi — FIZIKSEL piksel koordinatlarinda.
/// Electron'un screen API'si DIP verir; ikisini karistirma.
/// Eslesme sirayla yapilir (bkz src/main/capture.js).
/// </summary>
internal static class Displays
{
    private const int MONITOR_PRIMARY = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEX info);

    public static List<DisplayInfo> List()
    {
        var result = new List<DisplayInfo>();
        int i = 0;

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hmon, IntPtr _, ref RECT _, IntPtr _) =>
        {
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfoW(hmon, ref info))
            {
                var r = info.rcMonitor;
                result.Add(new DisplayInfo(
                    Index: i++,
                    Hmon: hmon.ToInt64(),
                    X: r.Left,
                    Y: r.Top,
                    Width: r.Right - r.Left,
                    Height: r.Bottom - r.Top,
                    Primary: (info.dwFlags & MONITOR_PRIMARY) != 0,
                    DeviceName: info.szDevice ?? ""));
            }
            return true;
        }, IntPtr.Zero);

        // Birincil monitor her zaman basta olsun — Electron tarafi sirayla esliyor.
        result.Sort((a, b) => a.Primary == b.Primary ? a.Index.CompareTo(b.Index) : (a.Primary ? -1 : 1));
        return result;
    }
}
