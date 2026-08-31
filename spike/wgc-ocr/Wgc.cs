using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;

namespace DeightShot.Spike;

internal sealed record CaptureResult(
    byte[] Bgra,
    int Width,
    int Height,
    long CreateDeviceMs,
    long FirstFrameMs,
    long ReadbackMs);

/// <summary>Windows Graphics Capture ile tek kare yakalar (BGRA ham piksel dondurur).</summary>
internal static class Wgc
{
    public static bool IsSupported()
    {
        try { return GraphicsCaptureSession.IsSupported(); }
        catch { return false; }
    }

    public static CaptureResult CaptureMonitor(IntPtr hmon, bool captureCursor = false)
        => Capture(interop =>
        {
            Guid iid = Interop.GraphicsCaptureItemIid;
            IntPtr p = interop.CreateForMonitor(hmon, ref iid);
            return WinRT.MarshalInspectable<GraphicsCaptureItem>.FromAbi(p);
        }, captureCursor);

    public static CaptureResult CaptureWindow(IntPtr hwnd, bool captureCursor = false)
        => Capture(interop =>
        {
            Guid iid = Interop.GraphicsCaptureItemIid;
            IntPtr p = interop.CreateForWindow(hwnd, ref iid);
            return WinRT.MarshalInspectable<GraphicsCaptureItem>.FromAbi(p);
        }, captureCursor, nudgeHwnd: hwnd);

    private static CaptureResult Capture(
        Func<Interop.IGraphicsCaptureItemInterop, GraphicsCaptureItem> makeItem,
        bool captureCursor,
        IntPtr nudgeHwnd = default)
    {
        var sw = Stopwatch.StartNew();

        // --- D3D11 cihazi ---
        var featureLevels = new[]
        {
            FeatureLevel.Level_11_1, FeatureLevel.Level_11_0, FeatureLevel.Level_10_1, FeatureLevel.Level_10_0
        };

        // WGC BGRA destegi sart
        var hr = D3D11.D3D11CreateDevice(
            null,
            DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            featureLevels,
            out ID3D11Device d3dDevice,
            out ID3D11DeviceContext context);

        if (hr.Failure || d3dDevice is null)
            throw new InvalidOperationException($"D3D11CreateDevice basarisiz: {hr}");

        using var dxgiDevice = d3dDevice.QueryInterface<IDXGIDevice>();
        int hr2 = Interop.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out IntPtr pWinrtDevice);
        if (hr2 != 0) throw Marshal.GetExceptionForHR(hr2)!;

        var winrtDevice = WinRT.MarshalInspectable<IDirect3DDevice>.FromAbi(pWinrtDevice);
        long createDeviceMs = sw.ElapsedMilliseconds;

        // --- yakalama ogesi ---
        var interop = Interop.GetCaptureItemInterop();
        GraphicsCaptureItem item = makeItem(interop);

        var size = item.Size;
        if (size.Width <= 0 || size.Height <= 0)
            throw new InvalidOperationException($"Gecersiz yakalama boyutu: {size.Width}x{size.Height}");

        var framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            winrtDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            size);

        var session = framePool.CreateCaptureSession(item);

        // Win11: sari yakalama cercevesini kaldir, imleci disla.
        // Eski surumlerde bu ozellikler yok -> sessizce gec.
        TrySet(() => session.IsCursorCaptureEnabled = captureCursor);
        TrySet(() => session.IsBorderRequired = false);

        var frameReady = new TaskCompletionSource<Direct3D11CaptureFrame>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var frameSw = Stopwatch.StartNew();
        framePool.FrameArrived += (pool, _) =>
        {
            var f = pool.TryGetNextFrame();
            if (f is not null) frameReady.TrySetResult(f);
        };

        session.StartCapture();

        // Pencere modunda durağan bir pencere hic kare uretmeyebilir.
        // Once kisa bekle; gelmezse yeniden cizmeye zorlayip tekrar bekle.
        if (!frameReady.Task.Wait(TimeSpan.FromMilliseconds(700)))
        {
            if (nudgeHwnd != IntPtr.Zero)
            {
                Console.WriteLine("  (kare gelmedi -> pencere yeniden cizmeye zorlaniyor)");
                for (int i = 0; i < 5 && !frameReady.Task.IsCompleted; i++)
                {
                    Interop.NudgeRepaint(nudgeHwnd);
                    frameReady.Task.Wait(TimeSpan.FromMilliseconds(300));
                }
            }

            if (!frameReady.Task.Wait(TimeSpan.FromSeconds(3)))
                throw new TimeoutException("Kare gelmedi (yeniden cizme zorlamasi da ise yaramadi).");
        }

        using var frame = frameReady.Task.Result;
        long firstFrameMs = frameSw.ElapsedMilliseconds;

        // --- yuzeyden dokuya ---
        var readSw = Stopwatch.StartNew();

        IntPtr pSurface = WinRT.MarshalInspectable<IDirect3DSurface>.FromManaged(frame.Surface);
        var access = (Interop.IDirect3DDxgiInterfaceAccess)Marshal.GetObjectForIUnknown(pSurface);
        Marshal.Release(pSurface);

        Guid texIid = typeof(ID3D11Texture2D).GUID;
        IntPtr pTex = access.GetInterface(ref texIid);
        using var srcTex = new ID3D11Texture2D(pTex);

        var desc = srcTex.Description;
        int w = (int)desc.Width, h = (int)desc.Height;

        var stagingDesc = desc;
        stagingDesc.Usage = ResourceUsage.Staging;
        stagingDesc.BindFlags = BindFlags.None;
        stagingDesc.CPUAccessFlags = CpuAccessFlags.Read;
        stagingDesc.MiscFlags = ResourceOptionFlags.None;

        using var staging = d3dDevice.CreateTexture2D(stagingDesc);
        context.CopyResource(staging, srcTex);

        var map = context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
        var pixels = new byte[w * h * 4];
        unsafe
        {
            byte* src = (byte*)map.DataPointer;
            fixed (byte* dst = pixels)
            {
                int rowBytes = w * 4;
                for (int y = 0; y < h; y++)
                {
                    Buffer.MemoryCopy(
                        src + (long)y * map.RowPitch,
                        dst + (long)y * rowBytes,
                        rowBytes, rowBytes);
                }
            }
        }
        context.Unmap(staging, 0);
        long readbackMs = readSw.ElapsedMilliseconds;

        session.Dispose();
        framePool.Dispose();
        context.Dispose();
        d3dDevice.Dispose();

        return new CaptureResult(pixels, w, h, createDeviceMs, firstFrameMs, readbackMs);
    }

    private static void TrySet(Action a)
    {
        try { a(); } catch { /* eski Windows surumu - onemsiz */ }
    }
}
