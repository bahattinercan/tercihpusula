namespace TercihPusula.Desktop;

/// <summary>Filesystem layout. Everything the app writes lives under %LOCALAPPDATA%; the exe folder stays read-only.</summary>
internal static class AppPaths
{
    public static string ExeDir => AppContext.BaseDirectory;

    public static string Root =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TercihPusula");

    /// <summary>Versioned extractions of the embedded bundle.</summary>
    public static string AppRoot => Path.Combine(Root, "app");

    /// <summary>WebView2 user data (cookies, localStorage holding the preference list).</summary>
    public static string WebViewProfile => Path.Combine(Root, "WebView2");

    public static string SettingsFile => Path.Combine(Root, "settings.json");

    public static string LogFile => Path.Combine(Root, "app.log");

    /// <summary>Drop-in data refresh: a full dist folder next to the exe wins over the embedded copy.</summary>
    public static string DataOverride => Path.Combine(ExeDir, "data-override");

    /// <summary>Rejects paths that escape <paramref name="root"/> after normalisation.</summary>
    public static string SafeJoin(string root, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        var normalRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(normalRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"path escapes the app folder: {relative}");
        return full;
    }
}
