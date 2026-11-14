using System.Drawing.Drawing2D;

namespace TercihPusula.Desktop;

/// <summary>
/// Shown while a page is being fetched/parsed, so a slow navigation never looks like a frozen app.
/// Painted in the site's language (mono uppercase label over an accent rule) instead of a native
/// progress bar.
/// </summary>
internal sealed class LoadingOverlay : Control
{
    private readonly Palette _palette;
    private readonly Font _font;

    public LoadingOverlay(Palette palette)
    {
        _palette = palette;
        _font = new Font("Consolas", 10f, FontStyle.Regular, GraphicsUnit.Point);
        Dock = DockStyle.Fill;
        Visible = false;
        BackColor = palette.Strip;
        DoubleBuffered = true;
        SetStyle(
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint,
            true);
        AccessibleName = "Yükleniyor";
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        using (var background = new SolidBrush(_palette.Strip))
        {
            e.Graphics.FillRectangle(background, ClientRectangle);
        }

        var text = "YÜKLENİYOR";
        var size = TextRenderer.MeasureText(e.Graphics, text, _font, new Size(int.MaxValue, int.MaxValue), TextFormatFlags.NoPadding);
        var left = (Width - size.Width) / 2;
        var top = (Height - size.Height) / 2;
        TextRenderer.DrawText(
            e.Graphics,
            text,
            _font,
            new Rectangle(left, top, size.Width, size.Height),
            _palette.TextMuted,
            TextFormatFlags.NoPadding);

        // Accent rule above the label, the same 2px marker the site uses on tiles.
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var accent = new SolidBrush(_palette.Accent);
        using var bar = Theme.RoundedRect(new Rectangle(left, top - 14, Math.Max(24, size.Width / 3), 2), 1f);
        e.Graphics.FillPath(accent, bar);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _font.Dispose();
        base.Dispose(disposing);
    }
}
