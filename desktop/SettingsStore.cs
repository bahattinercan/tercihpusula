using System.Text.Json;

namespace TercihPusula.Desktop;

internal sealed class WindowSettings
{
    public int Width { get; set; } = 1280;
    public int Height { get; set; } = 900;
    public int X { get; set; } = int.MinValue;
    public int Y { get; set; } = int.MinValue;
    public bool Maximized { get; set; }
}

internal static class SettingsStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static WindowSettings Load()
    {
        try
        {
            var path = AppPaths.SettingsFile;
            if (!File.Exists(path)) return new WindowSettings();
            return JsonSerializer.Deserialize<WindowSettings>(File.ReadAllText(path), Options) ?? new WindowSettings();
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            // A corrupt or locked settings file must never block startup.
            return new WindowSettings();
        }
    }

    public static void Save(WindowSettings settings)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            File.WriteAllText(AppPaths.SettingsFile, JsonSerializer.Serialize(settings, Options));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Losing the window size is not worth interrupting the user with a dialog.
        }
    }

    /// <summary>Keeps a window that was saved on a monitor that is no longer attached visible.</summary>
    public static Rectangle Clamp(WindowSettings settings)
    {
        var bounds = new Rectangle(settings.X, settings.Y, settings.Width, settings.Height);
        if (settings.X == int.MinValue || settings.Y == int.MinValue) return Rectangle.Empty;
        if (bounds.Width < 640 || bounds.Height < 480) return Rectangle.Empty;
        var visible = Screen.AllScreens.Any((screen) => Rectangle.Intersect(screen.WorkingArea, bounds).Width > 160);
        return visible ? bounds : Rectangle.Empty;
    }
}
