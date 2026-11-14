using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace TercihPusula.Desktop;

internal sealed class MainForm : Form
{
    private readonly Bundle _bundle;
    private readonly CommandLineOptions _options;
    private readonly WindowSettings _settings;
    private Shell? _shell;
    private LoadingOverlay? _loading;
    private readonly System.Windows.Forms.Timer _loadingDelay = new() { Interval = 150 };
    private bool _firstNavigation = true;
    private bool _overlayTimerWired;

    public MainForm(Bundle bundle, CommandLineOptions options)
    {
        _bundle = bundle;
        _options = options;
        _settings = SettingsStore.Load();

        Text = "Tercih Pusulası";
        MinimumSize = new Size(900, 600);
        Size = new Size(_settings.Width, _settings.Height);
        StartPosition = FormStartPosition.CenterScreen;
        var bounds = SettingsStore.Clamp(_settings);
        if (bounds != Rectangle.Empty)
        {
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
        }
        if (_settings.Maximized) WindowState = FormWindowState.Maximized;

        Controls.Add(BuildMenu());
        KeyPreview = true;
        KeyDown += (_, args) =>
        {
            if (args.Control && args.KeyCode == Keys.R) Reload();
            else if (args.Control && args.KeyCode == Keys.O) OpenDataFolder();
            else if (args.KeyCode == Keys.F1) ShowAbout();
            else if (args.KeyCode == Keys.F11) ToggleFullScreen();
            else if (args.KeyCode == Keys.Escape && _fullScreen) ToggleFullScreen();
        };
    }

    private MenuStrip BuildMenu()
    {
        var palette = Theme.Current;
        var menuFont = new Font("Consolas", 9f, FontStyle.Regular, GraphicsUnit.Point);
        var menu = new MenuStrip
        {
            Dock = DockStyle.Top,
            AutoSize = false,
            Height = 34,
            GripStyle = ToolStripGripStyle.Hidden,
            Renderer = new MenuRenderer(palette),
            BackColor = palette.Strip,
            ForeColor = palette.Text,
            Font = menuFont,
            Padding = new Padding(10, 0, 0, 0),
            ShowItemToolTips = false,
        };

        ToolStripMenuItem Item(string text, Action action, FontStyle style = FontStyle.Regular)
        {
            var item = new ToolStripMenuItem(text, null, (_, _) => action())
            {
                Font = new Font(menuFont, style),
                Padding = new Padding(12, 6, 22, 6),
                Margin = new Padding(4, 0, 4, 0),
            };
            return item;
        }

        ToolStripMenuItem Section(string text)
        {
            var item = new ToolStripMenuItem(text)
            {
                Font = new Font(menuFont, FontStyle.Regular),
                Padding = new Padding(10, 5, 10, 5),
                Margin = new Padding(0, 4, 2, 4),
                DropDownDirection = ToolStripDropDownDirection.BelowRight,
            };
            if (item.DropDown is ToolStripDropDownMenu dropDown) dropDown.ShowImageMargin = false;
            item.DropDown.BackColor = palette.Surface;
            item.DropDown.ForeColor = palette.Text;
            item.DropDown.Font = menuFont;
            item.DropDown.Padding = new Padding(0, 4, 0, 4);
            return item;
        }

        var app = Section("&UYGULAMA");
        app.DropDownItems.Add(Item("YENİDEN YÜKLE · CTRL+R", Reload));
        app.DropDownItems.Add(Item("VERİ KLASÖRÜNÜ AÇ · CTRL+O", OpenDataFolder));
        app.DropDownItems.Add(new ToolStripSeparator { Margin = new Padding(0, 4, 0, 4) });
        app.DropDownItems.Add(Item("HAKKINDA · F1", ShowAbout));
        app.DropDownItems.Add(new ToolStripSeparator { Margin = new Padding(0, 4, 0, 4) });
        app.DropDownItems.Add(Item("ÇIKIŞ", Close));
        menu.Items.Add(app);

        var view = Section("&GÖRÜNÜM");
        view.DropDownItems.Add(Item("NORMAL BOYUT", () => SetZoom(1.0)));
        view.DropDownItems.Add(Item("YAKINLAŞTIR", () => SetZoom(0.1, relative: true)));
        view.DropDownItems.Add(Item("UZAKLAŞTIR", () => SetZoom(-0.1, relative: true)));
        view.DropDownItems.Add(new ToolStripSeparator { Margin = new Padding(0, 4, 0, 4) });
        view.DropDownItems.Add(Item("TAM EKRAN · F11", ToggleFullScreen));
        menu.Items.Add(view);

        MainMenuStrip = menu;
        return menu;
    }

    private bool _fullScreen;
    private FormBorderStyle _restoreBorder;
    private FormWindowState _restoreState;

    private void ToggleFullScreen()
    {
        if (_fullScreen)
        {
            FormBorderStyle = _restoreBorder;
            WindowState = _restoreState;
            _fullScreen = false;
            return;
        }

        _restoreBorder = FormBorderStyle;
        _restoreState = WindowState == FormWindowState.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        _fullScreen = true;
    }

    /// <summary>
    /// A page that takes a second to parse must not look like a frozen window. The overlay is added
    /// after the WebView2 so it sits above it, and it only appears if the navigation is not already
    /// finished within 150 ms (the first one shows immediately: startup is the slowest).
    /// </summary>
    private void AttachLoadingOverlay()
    {
        if (_shell is null || _loading is not null) return;
        _loading = new LoadingOverlay(Theme.Current);
        Controls.Add(_loading);
        _loading.BringToFront();

        if (!_overlayTimerWired)
        {
            _overlayTimerWired = true;
            _loadingDelay.Tick += (_, _) =>
            {
                _loadingDelay.Stop();
                ShowOverlay();
            };
        }

        _shell.Core.NavigationStarting += (_, _) =>
        {
            if (_firstNavigation) ShowOverlay();
            else
            {
                _loadingDelay.Stop();
                _loadingDelay.Start();
            }
        };
        _shell.Core.NavigationCompleted += (_, _) =>
        {
            _firstNavigation = false;
            HideOverlay();
        };
    }

    private void ShowOverlay()
    {
        if (_loading is null) return;
        _loading.Visible = true;
        _loading.BringToFront();
        _loading.Invalidate();
    }

    private void HideOverlay()
    {
        _loadingDelay.Stop();
        if (_loading is not null) _loading.Visible = false;
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            _shell = new Shell(_bundle.Folder, new ShellOptions { EnableDevTools = _options.EnableDevTools });
            await _shell.InitializeAsync(this);
            AttachLoadingOverlay();
            Text = $"Tercih Pusulası — veri {_bundle.DataRound}";
            var result = await _shell.NavigateAsync("index.html");
            if (!result.Ok)
            {
                ShowStartupError($"Sayfa yüklenemedi ({result.Error}).\n\n{_bundle.Folder}");
            }
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowStartupError(
                "Microsoft Edge WebView2 çalışma zamanı bulunamadı.\n\n" +
                "Windows 10/11'de genellikle hazır gelir. Kurmak için:\n" +
                "https://go.microsoft.com/fwlink/p/?LinkId=2124703");
        }
        catch (Exception error) when (error is InvalidOperationException or IOException or UnauthorizedAccessException or COMException)
        {
            ShowStartupError($"{error.Message}\n\n{_bundle.Folder}");
        }
    }

    private void ShowStartupError(string message)
    {
        MessageBox.Show(this, message, "Tercih Pusulası", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private void Reload()
    {
        if (_shell is null) return;
        _bundle.DataRound = ReadDataRound(_bundle.Folder);
        Text = $"Tercih Pusulası — veri {_bundle.DataRound}";
        _shell.Core.Reload();
    }

    private void SetZoom(double value, bool relative = false)
    {
        if (_shell is null) return;
        var next = relative ? _shell.View.ZoomFactor + value : value;
        _shell.View.ZoomFactor = Math.Clamp(next, 0.5, 2.0);
    }

    private void OpenDataFolder()
    {
        try
        {
            Directory.CreateDirectory(_bundle.Folder);
            Process.Start(new ProcessStartInfo(_bundle.Folder) { UseShellExecute = true });
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            MessageBox.Show(this, error.Message, "Klasör açılamadı", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ShowAbout()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "?";
        var source = _bundle.Source switch
        {
            "embedded" => $"pakete gömülü ({_bundle.Version})",
            "data-override" => "data-override klasörü (exe yanında)",
            "argument" => $"--dist {_bundle.Folder}",
            _ => _bundle.Source,
        };
        var text =
            $"""
            Tercih Pusulası {version}
            Resmî olmayan karar destek aracı. Bağlayıcı kaynak ÖSYM tercih kılavuzudur.

            Veri dönemi : {_bundle.DataRound}
            Veri kaynağı: {source}
            Uygulama    : {_bundle.Folder}
            Profil      : {AppPaths.WebViewProfile}

            Yeni dönem verisi için: exe yanına data-override klasörü koyun.
            Kapılar ve hata payı: Uygulama → Hakkında değil, site içindeki
            "Metodoloji" ve "Veri kaynakları" sayfaları.
            """;
        MessageBox.Show(this, text, "Hakkında", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    internal static string ReadDataRound(string folder)
    {
        try
        {
            var path = Path.Combine(folder, "data", "lisans.json");
            if (!File.Exists(path)) return "—";
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            return document.RootElement.TryGetProperty("round", out var round) ? round.GetString() ?? "—" : "—";
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            return "—";
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyWindowTheme();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_shell is not null)
        {
            _settings.Maximized = WindowState == FormWindowState.Maximized;
            if (WindowState == FormWindowState.Normal)
            {
                _settings.Width = Width;
                _settings.Height = Height;
                _settings.X = Location.X;
                _settings.Y = Location.Y;
            }
            SettingsStore.Save(_settings);
            _shell.Dispose();
        }
        base.OnFormClosing(e);
    }

    /// <summary>Matches the title bar and menu strip to the Windows app theme, so a dark site is not framed in white.</summary>
    private void ApplyWindowTheme()
    {
        try
        {
            var dark = Theme.IsDarkMode() ? 1 : 0;
            DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ExternalException)
        {
            // Cosmetic only; a title bar that ignores the theme is acceptable.
        }
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
