// shot88-native — Electron'un yaninda calisan yardimci surec.
//
// Protokol: satir basina bir JSON. stdin'den istek, stdout'a cevap.
//   istek : {"id":1,"cmd":"capture","args":{...}}
//   cevap : {"id":1,"ok":true,"data":{...}}  |  {"id":1,"ok":false,"error":"..."}
//
// KURAL: stdout SADECE protokol icindir. Her turlu log stderr'e gider,
// yoksa Electron tarafindaki JSON ayristirici bozulur.
using System.Text.Json;
using System.Text.Json.Serialization;
using Shot88.Native;

Interop.SetProcessDpiAwarenessContext(Interop.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

var jsonOpts = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};

var stdout = Console.Out;
string tempRoot = Path.Combine(Path.GetTempPath(), "shot88");
Directory.CreateDirectory(tempRoot);

void Log(string m) => Console.Error.WriteLine("[native] " + m);

// Hook kendi thread'inden olay yolluyor; stdout'a iki yerden ayni anda
// yazilmasin diye kilit sart, yoksa satirlar birbirine girer.
var yazmaKilidi = new object();

void Send(object payload)
{
    // Tek satir, tek yazma — parcali yazim Electron tarafinda yarim satir olusturur.
    var s = JsonSerializer.Serialize(payload, jsonOpts);
    lock (yazmaKilidi)
    {
        stdout.WriteLine(s);
        stdout.Flush();
    }
}

// Klavye hook'u olaylarini stdout'a bagla.
Hotkey.OlayYolla = (o) => Send(o);

// D3D cihazini simdiden kur — ilk Ins basisinda 300ms gecikme olmasin.
try { Wgc.Warmup(); Log("D3D cihazi hazirlandi (warmup)"); }
catch (Exception ex) { Log("warmup basarisiz (yakalamada tekrar denenecek): " + ex.Message); }

Log($"hazir. pid={Environment.ProcessId} temp={tempRoot}");
Send(new { evt = "ready", pid = Environment.ProcessId, version = "0.1.0" });

string line;
while ((line = Console.ReadLine()) is not null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    int id = 0;
    try
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        id = root.TryGetProperty("id", out var idEl) ? idEl.GetInt32() : 0;
        string cmd = root.GetProperty("cmd").GetString() ?? "";
        JsonElement req = root.TryGetProperty("args", out var a) ? a : default;

        object data = await Handle(cmd, req);
        Send(new { id, ok = true, data });
    }
    catch (Exception ex)
    {
        Log($"HATA: {ex.GetType().Name}: {ex.Message}");
        Send(new { id, ok = false, error = $"{ex.GetType().Name}: {ex.Message}" });
    }
}

Log("stdin kapandi, cikiliyor.");
return 0;

// ---------------------------------------------------------------

int? Int(JsonElement req, string name)
    => req.ValueKind == JsonValueKind.Object && req.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
        ? v.GetInt32() : null;

string Str(JsonElement req, string name)
    => req.ValueKind == JsonValueKind.Object && req.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
        ? v.GetString() : null;

async Task<object> Handle(string cmd, JsonElement req)
{
    switch (cmd)
    {
        case "ping":
            return new { pong = true, wgc = Wgc.IsSupported() };

        case "ocr-langs":
            return new { languages = Ocr.AvailableLanguages() };

        case "displays":
            return new { displays = Displays.List() };

        // CPU/GPU/RAM olcumu — ceviri motorunun nerede calisacagina karar vermek icin.
        case "resources":
            return Resources.Olc();

        // SADECE on plan durumu — CPU ornekleme beklemesi yok, anlik.
        // Overlay acilirken "oyun mu acik" sorusuna 0ms'de cevap lazim:
        // oyun acikken odak CALINMAMALI (yoksa alt-tab efekti oluyor).
        case "foreground":
            return Resources.OnPlanHizli();

        // Tum monitorleri yakala. Overlay her ekran icin ayri pencere actigindan
        // hepsi ayni anda lazim.
        case "capture-all":
        {
            var dir = Str(req, "dir") ?? Path.Combine(tempRoot, "kare");
            Directory.CreateDirectory(dir);

            // Eski kareleri temizle — disk sismesin.
            foreach (var old in Directory.GetFiles(dir, "*.png")) { try { File.Delete(old); } catch { } }

            var list = Displays.List();
            var stamp = DateTime.Now.ToString("HHmmss-fff");
            var results = new List<object>();

            foreach (var d in list)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var cap = Wgc.CaptureMonitor(new IntPtr(d.Hmon));
                long capMs = sw.ElapsedMilliseconds;

                var path = Path.Combine(dir, $"ekran{d.Index}-{stamp}.png");
                sw.Restart();
                await Png.SaveAsync(cap.Bgra, cap.Width, cap.Height, path);
                long pngMs = sw.ElapsedMilliseconds;

                results.Add(new
                {
                    index = d.Index,
                    primary = d.Primary,
                    path,
                    // FIZIKSEL piksel — Electron tarafi DIP'e cevirmeli
                    x = d.X, y = d.Y,
                    width = cap.Width, height = cap.Height,
                    ms = new { capture = capMs, png = pngMs },
                });
                Log($"ekran{d.Index} {cap.Width}x{cap.Height} yakalama={capMs}ms png={pngMs}ms");
            }
            return new { frames = results };
        }

        case "ocr":
        {
            var path = Str(req, "path") ?? throw new ArgumentException("'path' gerekli");
            var lang = Str(req, "lang") ?? "";
            double olcek = 1.0;
            if (req.ValueKind == JsonValueKind.Object && req.TryGetProperty("scale", out var sc)
                && sc.ValueKind == JsonValueKind.Number)
                olcek = Math.Clamp(sc.GetDouble(), 1.0, 4.0);

            return await Ocr.FromPngAsync(path, lang,
                Int(req, "x"), Int(req, "y"), Int(req, "w"), Int(req, "h"), olcek);
        }

        // Kisayolu dinlemeye basla. yut=true ise tus odaktaki uygulamaya HIC gitmez
        // (Ins'in editorde OVR acmasi boyle engelleniyor).
        case "hotkey-start":
        {
            uint vk = (uint)(Int(req, "vk") ?? 0x2D);           // 0x2D = VK_INSERT
            bool yut = req.ValueKind == JsonValueKind.Object
                       && req.TryGetProperty("swallow", out var sw)
                       && sw.ValueKind == JsonValueKind.False ? false : true;
            Hotkey.Baslat(vk, yut);
            Log($"kisayol hook kuruldu: vk=0x{vk:X2} yut={yut}");
            return new { started = true, vk, swallow = yut };
        }

        case "hotkey-stop":
            Hotkey.Durdur();
            Log("kisayol hook kaldirildi");
            return new { stopped = true };

        case "cleanup":
        {
            int n = 0;
            foreach (var f in Directory.GetFiles(tempRoot, "*.png", SearchOption.AllDirectories))
            { try { File.Delete(f); n++; } catch { } }
            return new { deleted = n };
        }

        default:
            throw new NotSupportedException($"bilinmeyen komut: {cmd}");
    }
}
