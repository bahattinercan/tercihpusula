using System.Drawing.Drawing2D;
using Microsoft.Win32;

namespace TercihPusula.Desktop;

/// <summary>
/// The shell's colours come from the same tokens as <c>web/assets/site.css</c> so the native chrome
/// does not clash with the page. Both palettes are kept in sync with the site's light-dark() pairs.
/// </summary>
internal sealed record Palette(
    Color Strip,
    Color Text,
    Color TextMuted,
    Color Surface,
    Color SurfaceAlt,
    Color Line,
    Color Accent,
    Color AccentInk,
    Color Hover)
{
    public static Palette Dark { get; } = new(
        Strip: ColorTranslator.FromHtml("#0e1417"),      // --bg-2
        Text: ColorTranslator.FromHtml("#a3b3bb"),       // --ink-soft
        TextMuted: ColorTranslator.FromHtml("#6e8089"),  // --ink-faint
        Surface: ColorTranslator.FromHtml("#101820"),    // --surface
        SurfaceAlt: ColorTranslator.FromHtml("#162028"), // --surface-2
        Line: ColorTranslator.FromHtml("#26333b"),
        Accent: ColorTranslator.FromHtml("#3ec6cd"),
        AccentInk: ColorTranslator.FromHtml("#04191b"),
        Hover: ColorTranslator.FromHtml("#152229"));

    public static Palette Light { get; } = new(
        Strip: ColorTranslator.FromHtml("#eef1f4"),
        Text: ColorTranslator.FromHtml("#46585f"),
        TextMuted: ColorTranslator.FromHtml("#6b7a81"),
        Surface: ColorTranslator.FromHtml("#ffffff"),
        SurfaceAlt: ColorTranslator.FromHtml("#f6f8fa"),
        Line: ColorTranslator.FromHtml("#d6dde2"),
        Accent: ColorTranslator.FromHtml("#0b6e75"),
        AccentInk: ColorTranslator.FromHtml("#ffffff"),
        Hover: ColorTranslator.FromHtml("#e3e8ec"));
}

internal static class Theme
{
    /// <summary>Windows "app theme" setting; the site follows prefers-color-scheme, which does the same.</summary>
    public static bool IsDarkMode()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return (key?.GetValue("AppsUseLightTheme") as int? ?? 1) == 0;
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or System.IO.IOException)
        {
            return true; // the site defaults to the dark telemetry-grid look
        }
    }

    public static Palette Current => IsDarkMode() ? Palette.Dark : Palette.Light;

    public const float Radius = 4f;

    /// <summary>Rounded rectangle matching the site's 4px chip/card radius.</summary>
    public static GraphicsPath RoundedRect(Rectangle bounds, float radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        if (diameter <= 0)
        {
            path.AddRectangle(bounds);
            return path;
        }
        var arc = new RectangleF(bounds.X, bounds.Y, diameter, diameter);
        path.AddArc(arc, 180, 90);
        arc.X = bounds.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = bounds.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = bounds.X;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }
}
