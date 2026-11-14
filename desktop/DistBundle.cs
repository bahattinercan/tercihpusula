using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace TercihPusula.Desktop;

internal sealed class Bundle
{
    public required string Folder { get; init; }
    public required string Source { get; init; }
    public required string Version { get; init; }
    public bool Extracted { get; init; }
    public string DataRound { get; set; } = "—";
    public string EntryPoint => Path.Combine(Folder, "index.html");
}

/// <summary>
/// Resolves the folder that is served to WebView2:
///   1. <c>--dist &lt;path&gt;</c>  (development)
///   2. &lt;exeDir&gt;\data-override\  (drop-in data refresh, no rebuild)
///   3. the embedded dist.zip, extracted once per content hash
/// </summary>
internal static class DistBundle
{
    /// <summary>Origin of the app. Frozen: changing it would reset every saved preference list.</summary>
    public const string Host = "tercihpusula.local";
    private const string Marker = ".extracted";
    private const string ResourceName = "dist.zip";

    public static Bundle Prepare(string? distOverride)
    {
        Directory.CreateDirectory(AppPaths.AppRoot);

        if (!string.IsNullOrWhiteSpace(distOverride))
        {
            var folder = Path.GetFullPath(distOverride);
            if (!File.Exists(Path.Combine(folder, "index.html")))
                throw new DirectoryNotFoundException($"--dist klasöründe index.html yok: {folder}");
            return new Bundle { Folder = folder, Source = "argument", Version = "dev", Extracted = false };
        }

        var dropIn = AppPaths.DataOverride;
        if (File.Exists(Path.Combine(dropIn, "index.html")))
        {
            return new Bundle { Folder = dropIn, Source = "data-override", Version = "override", Extracted = false };
        }

        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException(
                "Gömülü uygulama verisi bulunamadı (dist.zip). Paket 'node scripts/desktop-build.mjs' ile üretilmelidir.");

        using (stream)
        {
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            var zipBytes = buffer.ToArray();
            var hash = Convert.ToHexString(SHA256.HashData(zipBytes)).ToLowerInvariant()[..8];
            var target = Path.Combine(AppPaths.AppRoot, hash);
            var extracted = !File.Exists(Path.Combine(target, Marker));

            if (extracted)
            {
                Extract(zipBytes, target);
                CleanupOtherVersions(hash);
            }

            return new Bundle
            {
                Folder = target,
                Source = "embedded",
                Version = hash,
                Extracted = extracted,
            };
        }
    }

    private static void Extract(byte[] zipBytes, string target)
    {
        var staging = $"{target}.tmp-{Environment.ProcessId}";
        if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        Directory.CreateDirectory(staging);

        using var archive = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue; // directory row
            var destination = AppPaths.SafeJoin(staging, entry.FullName);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, overwrite: true);
        }

        File.WriteAllText(Path.Combine(staging, Marker), "ok");
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
        Directory.Move(staging, target);
    }

    /// <summary>Keeps the current extraction plus anything that does not look like a version folder.</summary>
    private static void CleanupOtherVersions(string keepHash)
    {
        foreach (var directory in Directory.EnumerateDirectories(AppPaths.AppRoot))
        {
            var name = Path.GetFileName(directory);
            if (name.Equals(keepHash, StringComparison.OrdinalIgnoreCase)) continue;
            if (name.Length != 8 || !name.All(Uri.IsHexDigit)) continue; // leave hand-made folders alone
            try
            {
                Directory.Delete(directory, recursive: true);
            }
            catch (IOException)
            {
                // Another instance may still hold a file; the next launch retries.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
