using System.Drawing.Drawing2D;

namespace TercihPusula.Desktop;

/// <summary>
/// Draws the menu with the site's own visual language: mono uppercase labels, 4px radius chips,
/// accent hover, hairline separators. The default Win32 renderer cannot be recoloured cleanly,
/// so every part that matters is painted here.
/// </summary>
internal sealed class MenuRenderer : ToolStripRenderer
{
    private readonly Palette _palette;
    private readonly Font _font;

    public MenuRenderer(Palette palette)
    {
        _palette = palette;
        // The site's rail uses IBM Plex Mono; Consolas is the closest font present on every Windows box.
        _font = new Font("Consolas", 9f, FontStyle.Regular, GraphicsUnit.Point);
    }

    private static bool IsTopLevel(ToolStripItem item) => item.Owner is MenuStrip;

    private static bool IsHot(ToolStripItem item) => item.Selected || item.Pressed;

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
    {
        using var brush = new SolidBrush(e.ToolStrip is ToolStripDropDown ? _palette.Surface : _palette.Strip);
        e.Graphics.FillRectangle(brush, e.AffectedBounds);
    }

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        if (e.ToolStrip is ToolStripDropDown)
        {
            using var pen = new Pen(_palette.Line);
            var bounds = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            e.Graphics.DrawRectangle(pen, bounds);
            return;
        }

        // One hairline under the menu strip, matching the site's --line.
        using var line = new Pen(_palette.Line);
        e.Graphics.DrawLine(line, 0, e.ToolStrip.Height - 1, e.ToolStrip.Width, e.ToolStrip.Height - 1);
    }

    protected override void OnRenderImageMargin(ToolStripRenderEventArgs e)
    {
        using var brush = new SolidBrush(_palette.Surface);
        e.Graphics.FillRectangle(brush, e.AffectedBounds);
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        var hot = IsHot(e.Item);
        var background = hot ? _palette.SurfaceAlt : (e.ToolStrip is ToolStripDropDown ? _palette.Surface : _palette.Strip);
        using var brush = new SolidBrush(background);

        if (IsTopLevel(e.Item))
        {
            // Symmetric chip: the text is centred on the item, so the chip must be too.
            var chip = new Rectangle(2, 2, e.Item.Width - 4, e.Item.Height - 4);
            using var path = Theme.RoundedRect(chip, Theme.Radius);
            if (hot)
            {
                brush.Color = _palette.Hover;
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.FillPath(brush, path);
                using var pen = new Pen(hot ? _palette.Accent : _palette.Line);
                e.Graphics.DrawPath(pen, path);
            }
            else
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.DrawPath(new Pen(_palette.Strip), path); // keeps the stroke aligned with the fill
            }
            return;
        }

        // Dropdown rows: same 4px radius as the site's chips, plus an accent rule on the left.
        var row = new Rectangle(4, 2, e.Item.Width - 8, e.Item.Height - 4);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var rowPath = Theme.RoundedRect(row, Theme.Radius);
        if (hot)
        {
            using var filled = new SolidBrush(_palette.Hover);
            e.Graphics.FillPath(filled, rowPath);
            using var accent = new Pen(_palette.Accent) { Width = 1.6f };
            e.Graphics.DrawLine(accent, row.Left + 1, row.Top + 5, row.Left + 1, row.Bottom - 5);
            return;
        }
        e.Graphics.FillPath(brush, rowPath);
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        if (e.Item is null)
        {
            base.OnRenderItemText(e);
            return;
        }

        // ToolStrip draws item text top-aligned inside ContentRectangle, which leaves the label
        // sitting at the top of a padded/tall item. Draw it here instead, centred on the whole
        // item, and keep the horizontal inset the layout computed (it carries the padding).
        var colour = e.Item.Enabled
            ? (IsHot(e.Item) ? _palette.Accent : _palette.Text)
            : _palette.TextMuted;
        var text = (e.Text ?? string.Empty).ToUpperInvariant();
        var rectangle = new Rectangle(e.TextRectangle.X, 0, e.TextRectangle.Width, e.Item.Height);
        var flags = TextFormatFlags.SingleLine
            | TextFormatFlags.Left
            | TextFormatFlags.VerticalCenter
            | TextFormatFlags.EndEllipsis
            | TextFormatFlags.NoPadding;
        TextRenderer.DrawText(e.Graphics, text, e.TextFont ?? _font, rectangle, colour, flags);
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        if (e.Item is null)
        {
            base.OnRenderSeparator(e);
            return;
        }
        using var pen = new Pen(_palette.Line);
        var y = e.Item.Height / 2;
        if (e.Vertical) e.Graphics.DrawLine(pen, e.Item.Width / 2, 4, e.Item.Width / 2, e.Item.Height - 4);
        else e.Graphics.DrawLine(pen, 10, y, e.Item.Width - 10, y);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        // Small chevron instead of the default black triangle: it stays legible on both palettes.
        var colour = e.Item is not null && IsHot(e.Item) ? _palette.Accent : _palette.TextMuted;
        using var pen = new Pen(colour, 1.4f);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var centre = e.ArrowRectangle;
        var x = centre.X + 2;
        var y = centre.Y + centre.Height / 2;
        e.Graphics.DrawLines(pen, new[]
        {
            new Point(x, y - 4),
            new Point(x + 4, y),
            new Point(x, y + 4),
        });
    }

    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var pen = new Pen(_palette.Accent, 1.6f);
        var box = e.ImageRectangle;
        e.Graphics.DrawLines(pen, new[]
        {
            new Point(box.Left + 4, box.Top + box.Height / 2),
            new Point(box.Left + box.Width / 2, box.Bottom - 5),
            new Point(box.Right - 3, box.Top + 5),
        });
    }

    // The renderer lives for the lifetime of the window, so the font is not disposed here:
    // ToolStripRenderer has no overridable Dispose(bool) to hook into.
}
