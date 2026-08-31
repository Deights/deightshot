using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace DeightShot.Native;

internal sealed record OcrWordDto(string Text, double X, double Y, double W, double H);
internal sealed record OcrLineDto(string Text, List<OcrWordDto> Words);
internal sealed record OcrResultDto(string Language, int Ms, string Text, List<OcrLineDto> Lines);

/// <summary>
/// Windows.Media.Ocr sarmalayicisi.
/// Kelime koordinatlari (BoundingRect) cift tik -> metin secme icin sart.
/// </summary>
internal static class Ocr
{
    public static List<string> AvailableLanguages()
        => OcrEngine.AvailableRecognizerLanguages.Select(l => l.LanguageTag).ToList();

    private static OcrEngine CreateEngine(string langTag)
    {
        if (!string.IsNullOrWhiteSpace(langTag))
        {
            var e = OcrEngine.TryCreateFromLanguage(new Language(langTag));
            if (e is not null) return e;
            throw new InvalidOperationException(
                $"'{langTag}' icin OCR motoru yok. Kurulu diller: {string.Join(", ", AvailableLanguages())}");
        }

        var d = OcrEngine.TryCreateFromUserProfileLanguages()
            ?? throw new InvalidOperationException("Kullanici dilleri icin OCR motoru olusturulamadi.");
        return d;
    }

    private static async Task<IRandomAccessStream> ToStreamAsync(byte[] bytes)
    {
        var ras = new InMemoryRandomAccessStream();
        var writer = new DataWriter(ras.GetOutputStreamAt(0));
        writer.WriteBytes(bytes);
        await writer.StoreAsync();
        await writer.FlushAsync();
        ras.Seek(0);
        return ras;
    }

    /// <summary>
    /// PNG dosyasini oku, istege bagli bir dikdortgeni kirp, OCR calistir.
    /// </summary>
    /// <param name="scale">
    /// Ön işleme: OCR'dan önce büyütme çarpanı (1 = kapalı, 2 = iki katı).
    /// Küçük arayüz/oyun fontlarında belirgin fark yaratabiliyor — tasarım
    /// notundaki "2x büyüt" önerisi. Ölçülmeden varsayılan yapılmadı.
    /// </param>
    public static async Task<OcrResultDto> FromPngAsync(
        string path, string langTag,
        int? cropX = null, int? cropY = null, int? cropW = null, int? cropH = null,
        double scale = 1.0)
    {
        var engine = CreateEngine(langTag);
        var bytes = await File.ReadAllBytesAsync(path);
        using var ras = await ToStreamAsync(bytes);

        var decoder = await BitmapDecoder.CreateAsync(ras);

        // Kirpma + buyutme tek transform'da; WIC'in kendi olcekleyicisi kullaniliyor.
        int kx = Math.Max(0, cropX ?? 0);
        int ky = Math.Max(0, cropY ?? 0);
        bool kirp = cropW is > 0 && cropH is > 0;
        int kw = kirp ? Math.Min(cropW.Value, (int)decoder.PixelWidth - kx) : (int)decoder.PixelWidth;
        int kh = kirp ? Math.Min(cropH.Value, (int)decoder.PixelHeight - ky) : (int)decoder.PixelHeight;

        SoftwareBitmap bmp;
        if (kirp || scale > 1.0)
        {
            // ⚠️ WIC'te sira: ONCE olcekleme, SONRA kirpma. Yani Bounds degerleri
            // de olceklenmis uzayda verilmeli — yoksa yanlis bolge kirpilir.
            uint sw = (uint)Math.Max(1, Math.Round(decoder.PixelWidth * scale));
            uint sh = (uint)Math.Max(1, Math.Round(decoder.PixelHeight * scale));

            var transform = new BitmapTransform
            {
                InterpolationMode = BitmapInterpolationMode.Fant,   // yumusak, metinde iyi
                ScaledWidth = sw,
                ScaledHeight = sh,
            };

            if (kirp)
            {
                uint bx = (uint)Math.Round(kx * scale);
                uint by = (uint)Math.Round(ky * scale);
                uint bw = (uint)Math.Max(1, Math.Round(kw * scale));
                uint bh = (uint)Math.Max(1, Math.Round(kh * scale));
                if (bx + bw > sw) bw = sw - bx;
                if (by + bh > sh) bh = sh - by;

                transform.Bounds = new BitmapBounds { X = bx, Y = by, Width = bw, Height = bh };
            }

            bmp = await decoder.GetSoftwareBitmapAsync(
                BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied,
                transform, ExifOrientationMode.IgnoreExifOrientation,
                ColorManagementMode.DoNotColorManage);
        }
        else
        {
            bmp = await decoder.GetSoftwareBitmapAsync();
        }

        using (bmp)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var result = await engine.RecognizeAsync(bmp);
            sw.Stop();

            // Buyutme yapildiysa koordinatlar olceklenmis uzayda geliyor —
            // cagirana KIRPILMIS ve OLCEKSIZ uzayda dondur, yoksa kelime
            // kutulari ekranda kayar.
            double d = scale > 0 ? scale : 1.0;
            var lines = result.Lines.Select(l => new OcrLineDto(
                l.Text,
                l.Words.Select(w => new OcrWordDto(
                    w.Text,
                    w.BoundingRect.X / d, w.BoundingRect.Y / d,
                    w.BoundingRect.Width / d, w.BoundingRect.Height / d)).ToList()
            )).ToList();

            return new OcrResultDto(
                engine.RecognizerLanguage.LanguageTag,
                (int)sw.ElapsedMilliseconds,
                string.Join(Environment.NewLine, lines.Select(l => l.Text)),
                lines);
        }
    }
}
