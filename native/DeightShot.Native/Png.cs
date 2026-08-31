using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace DeightShot.Native;

/// <summary>BGRA ham pikselleri PNG'ye cevirir. Diske yazar ya da bellekte tutar.</summary>
internal static class Png
{
    public static async Task<byte[]> EncodeAsync(byte[] bgra, int width, int height)
    {
        var ras = new InMemoryRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, ras);
        encoder.SetPixelData(
            BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
            (uint)width, (uint)height, 96, 96, bgra);
        await encoder.FlushAsync();

        ras.Seek(0);
        var bytes = new byte[ras.Size];
        var reader = new DataReader(ras.GetInputStreamAt(0));
        await reader.LoadAsync((uint)ras.Size);
        reader.ReadBytes(bytes);
        return bytes;
    }

    public static async Task<string> SaveAsync(byte[] bgra, int width, int height, string path)
    {
        var bytes = await EncodeAsync(bgra, width, height);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, bytes);
        return path;
    }
}
