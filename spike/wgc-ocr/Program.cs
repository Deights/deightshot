// shot88 spike — WGC yakalama + Windows.Media.Ocr kelime koordinatlari
//
// Kullanim:
//   dotnet run -- --monitor
//   dotnet run -- --window "Cyberpunk"
//   dotnet run -- --monitor --delay 5000 --lang en-US
using System.Diagnostics;
using Shot88.Spike;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

Console.OutputEncoding = System.Text.Encoding.UTF8;

// --- argumanlar ---
string mode = "monitor";
string windowNeedle = "";
string langTag = "";
int delayMs = 0;
string outDir = Path.Combine(AppContext.BaseDirectory, "cikti");

for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--monitor": mode = "monitor"; break;
        case "--window": mode = "window"; windowNeedle = Next(ref i); break;
        case "--lang": langTag = Next(ref i); break;
        case "--delay": delayMs = int.Parse(Next(ref i)); break;
        case "--out": outDir = Next(ref i); break;
    }
}
string Next(ref int i) => ++i < args.Length ? args[i] : "";

Interop.SetProcessDpiAwarenessContext(Interop.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
Directory.CreateDirectory(outDir);

Console.WriteLine("== shot88 spike : WGC + OCR ==");
Console.WriteLine($"WGC destekleniyor mu : {Wgc.IsSupported()}");
if (!Wgc.IsSupported())
{
    Console.WriteLine("WGC DESTEKLENMIYOR — burada duruyoruz.");
    return 1;
}

if (delayMs > 0)
{
    Console.WriteLine($"{delayMs} ms bekleniyor (oyuna gec)...");
    Thread.Sleep(delayMs);
}

// --- yakalama ---
CaptureResult cap;
string hedef;
try
{
    if (mode == "window")
    {
        IntPtr hwnd = windowNeedle.Length > 0
            ? Interop.FindWindowByTitle(windowNeedle)
            : Interop.GetForegroundWindow();

        if (hwnd == IntPtr.Zero)
        {
            Console.WriteLine($"'{windowNeedle}' basligini iceren gorunur pencere bulunamadi.");
            return 2;
        }
        hedef = $"pencere '{Interop.GetWindowTitle(hwnd)}' (hwnd 0x{hwnd.ToInt64():X})";
        Console.WriteLine($"Hedef            : {hedef}");
        cap = Wgc.CaptureWindow(hwnd);
    }
    else
    {
        IntPtr hmon = Interop.MonitorFromWindow(Interop.GetDesktopWindow(), Interop.MONITOR_DEFAULTTOPRIMARY);
        hedef = $"birincil monitor (hmon 0x{hmon.ToInt64():X})";
        Console.WriteLine($"Hedef            : {hedef}");
        cap = Wgc.CaptureMonitor(hmon);
    }
}
catch (Exception ex)
{
    Console.WriteLine($"YAKALAMA HATASI: {ex.GetType().Name}: {ex.Message}");
    return 3;
}

Console.WriteLine($"Kare             : {cap.Width}x{cap.Height}");
Console.WriteLine($"  D3D cihaz      : {cap.CreateDeviceMs} ms");
Console.WriteLine($"  ilk kare       : {cap.FirstFrameMs} ms   <-- kritik sayi");
Console.WriteLine($"  geri okuma     : {cap.ReadbackMs} ms");

// Kare tamamen siyah mi? (BitBlt'in oyunlarda dustugu tuzak)
long toplam = 0;
int ornek = 0;
for (int i = 0; i < cap.Bgra.Length; i += 4 * 97) { toplam += cap.Bgra[i] + cap.Bgra[i + 1] + cap.Bgra[i + 2]; ornek++; }
double ortalama = ornek > 0 ? (double)toplam / (ornek * 3) : 0;
Console.WriteLine($"  ort. parlaklik : {ortalama:F1}/255  {(ortalama < 1.0 ? "*** SIYAH KARE! ***" : "(dolu kare)")}");

// --- PNG'ye kodla ---
var ras = new InMemoryRandomAccessStream();
var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, ras);
encoder.SetPixelData(
    BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
    (uint)cap.Width, (uint)cap.Height, 96, 96, cap.Bgra);
await encoder.FlushAsync();

ras.Seek(0);
var pngBytes = new byte[ras.Size];
var reader = new DataReader(ras.GetInputStreamAt(0));
await reader.LoadAsync((uint)ras.Size);
reader.ReadBytes(pngBytes);

string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
string pngPath = Path.Combine(outDir, $"kare-{stamp}.png");
File.WriteAllBytes(pngPath, pngBytes);
Console.WriteLine($"PNG              : {pngPath} ({pngBytes.Length / 1024} KB)");

// --- OCR ---
OcrEngine engine = langTag.Length > 0
    ? OcrEngine.TryCreateFromLanguage(new Language(langTag))
    : OcrEngine.TryCreateFromUserProfileLanguages();

if (engine is null)
{
    Console.WriteLine($"OCR motoru olusturulamadi (dil: {(langTag.Length > 0 ? langTag : "profil")})");
    return 4;
}

ras.Seek(0);
var decoder = await BitmapDecoder.CreateAsync(ras);
using var softwareBitmap = await decoder.GetSoftwareBitmapAsync();

var ocrSw = Stopwatch.StartNew();
var ocr = await engine.RecognizeAsync(softwareBitmap);
ocrSw.Stop();

int wordCount = ocr.Lines.Sum(l => l.Words.Count);
Console.WriteLine();
Console.WriteLine($"OCR dili         : {engine.RecognizerLanguage.LanguageTag} ({engine.RecognizerLanguage.DisplayName})");
Console.WriteLine($"OCR suresi       : {ocrSw.ElapsedMilliseconds} ms   <-- kritik sayi");
Console.WriteLine($"Satir / kelime   : {ocr.Lines.Count} / {wordCount}");

Console.WriteLine();
Console.WriteLine("--- ilk 15 kelime + koordinat (cift tik metin secme icin sart) ---");
foreach (var word in ocr.Lines.SelectMany(l => l.Words).Take(15))
{
    var r = word.BoundingRect;
    Console.WriteLine($"  {word.Text,-22} x={r.X,7:F1} y={r.Y,7:F1} w={r.Width,6:F1} h={r.Height,6:F1}");
}

Console.WriteLine();
Console.WriteLine("--- ilk 8 satir ---");
foreach (var line in ocr.Lines.Take(8))
    Console.WriteLine($"  {line.Text}");

string txtPath = Path.Combine(outDir, $"metin-{stamp}.txt");
File.WriteAllText(txtPath, string.Join(Environment.NewLine, ocr.Lines.Select(l => l.Text)));
Console.WriteLine();
Console.WriteLine($"Tam metin        : {txtPath}");
Console.WriteLine("== bitti ==");
return 0;
