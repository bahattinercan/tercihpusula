using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TercihPusula.Desktop;

internal sealed class ShellOptions
{
    public bool EnableDevTools { get; init; }
    public bool OpenExternalInBrowser { get; init; } = true;
    public bool ShowPrintDialog { get; init; } = true;
    public string? ProfileFolder { get; init; }
}

internal sealed record NavigationResult(bool Ok, string Url, string? Error);

/// <summary>
/// Owns the WebView2 wiring: local origin, navigation allow-list, print bridge, JS error capture.
/// MainForm and self-check share it so the gate exercises the real shell, not a copy.
/// </summary>
internal sealed class Shell : IDisposable
{
    private readonly string _folder;
    private readonly ShellOptions _options;
    private LoopbackServer? _server;
    private bool _redirecting;
    private TaskCompletionSource<NavigationResult>? _pending;

    public WebView2 View { get; } = new() { Dock = DockStyle.Fill };
    public CoreWebView2 Core => View.CoreWebView2;
    /// <summary>
    /// Loopback HTTP on purpose. The WebView2 virtual-host mapping cost ~2 s per request here
    /// (measured: about:blank 5 ms, a 95-byte file through the mapping 2015 ms, the same file
    /// through <see cref="LoopbackServer"/> ~2 ms), which made every page feel frozen.
    /// The origin is pinned by a fixed port so saved preference lists survive restarts.
    /// </summary>
    public string Origin => _server?.Origin ?? "about:blank";
    public List<string> PrintRequests { get; } = new();
    public List<string> BlockedExternal { get; } = new();
    public List<string> BlockedResources { get; } = new();
    public string? LastNavigationError { get; private set; }

    public Shell(string distFolder, ShellOptions options)
    {
        _folder = distFolder;
        _options = options;
    }

    public async Task InitializeAsync(Control owner)
    {
        var profile = _options.ProfileFolder ?? AppPaths.WebViewProfile;
        Directory.CreateDirectory(profile);
        var environment = await CoreWebView2Environment.CreateAsync(null, profile);
        await View.EnsureCoreWebView2Async(environment);

        var settings = Core.Settings;
        settings.AreDevToolsEnabled = _options.EnableDevTools;
        settings.AreDefaultContextMenusEnabled = _options.EnableDevTools;
        settings.AreDefaultScriptDialogsEnabled = true;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = true;
        settings.AreBrowserAcceleratorKeysEnabled = true; // Ctrl+F, F5, Ctrl+P behave as users expect
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsWebMessageEnabled = true; // print bridge only
        settings.AreHostObjectsAllowed = false;
        settings.IsSwipeNavigationEnabled = false;

        _server = new LoopbackServer(_folder);
        _server.Start();

        Core.NavigationStarting += OnNavigationStarting;
        Core.NavigationCompleted += OnNavigationCompleted;
        Core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            var uri = TryParse(args.Uri);
            if (uri is null) return;
            BlockedExternal.Add(uri.ToString());
            OpenExternal(uri);
        };
        Core.DownloadStarting += (_, args) => args.Cancel = true; // nothing in the app downloads
        Core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        Core.WebMessageReceived += OnWebMessage;
        Core.AddWebResourceRequestedFilter("http://*/*", CoreWebView2WebResourceContext.All);
        Core.AddWebResourceRequestedFilter("https://*/*", CoreWebView2WebResourceContext.All);
        Core.WebResourceRequested += OnWebResourceRequested;
        // The bridge is installed after the document is parsed instead of through
        // AddScriptToExecuteOnDocumentCreatedAsync: a document-created script runs *before* parsing,
        // so every host hiccup there delays DOMContentLoaded for the whole page.
        Core.DOMContentLoaded += OnDocumentReady;
        // Resolve the awaited navigation first: the bridge handler must never delay (or throw before)
        // the completion that a caller is waiting on.
        Core.NavigationCompleted += OnNavigationCompleted;
        Core.NavigationCompleted += OnNavigationCompletedForBridge;

        owner.Controls.Add(View);
        // Docking is applied in reverse z-order: the fill control must be at the front so it is laid
        // out last, otherwise it covers the menu strip above it.
        View.BringToFront();
    }

    private const string ErrorCaptureScript = """
        (() => {
          if (window.__tpBridge) return;          // idempotent: DOMContentLoaded and NavigationCompleted both call this
          window.__tpBridge = true;
          window.__tpErrors = window.__tpErrors || [];
          window.addEventListener('error', (event) => window.__tpErrors.push(String(event.message || event.type)));
          window.addEventListener('unhandledrejection', (event) => window.__tpErrors.push('rejection: ' + String(event.reason)));
          window.print = function () {
            try { window.chrome.webview.postMessage({ type: 'print' }); }
            catch (error) { window.__tpErrors.push('print-bridge: ' + error.message); }
          };
        })();
        """;

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        var uri = TryParse(args.Uri);
        if (uri is null)
        {
            args.Cancel = true;
            return;
        }

        if (IsAppHost(uri))
        {
            // WebView2's folder mapping does not resolve directory URLs ("/kadrolar/");
            // redirect to the explicit index document instead of failing the navigation.
            if (_redirecting || !uri.AbsolutePath.EndsWith('/')) return;
            _redirecting = true;
            args.Cancel = true;
            var index = new UriBuilder(uri) { Path = uri.AbsolutePath + "index.html" }.Uri;
            // Keep the pending navigation alive: its cancelled completion is ignored below and
            // the redirect's own completion resolves it.
            BeginInvoke(() => Core.Navigate(index.AbsoluteUri));
            return;
        }

        args.Cancel = true;
        BlockedExternal.Add(uri.ToString());
        OpenExternal(uri);
    }

    private void OpenExternal(Uri uri)
    {
        if (!_options.OpenExternalInBrowser) return;
        if (uri.Scheme is not ("http" or "https" or "mailto")) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            // No default browser registered — the navigation is still blocked, nothing to recover.
        }
    }

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        var uri = TryParse(args.Request.Uri);
        if (uri is null || IsAppHost(uri)) return; // local content is served by the loopback server
        BlockedResources.Add(uri.ToString());
        args.Response = Core.Environment.CreateWebResourceResponse(
            new MemoryStream(),
            403,
            "Blocked",
            "Content-Type: text/plain; charset=utf-8");
    }

    private void OnDocumentReady(object? sender, CoreWebView2DOMContentLoadedEventArgs args) => InstallBridge();

    // NavigationCompleted also installs the bridge: a page can finish loading without raising
    // DOMContentLoaded in the same tick (cached documents, cancelled navigations).
    private void OnNavigationCompletedForBridge(object? sender, CoreWebView2NavigationCompletedEventArgs args) => InstallBridge();

    private void InstallBridge()
    {
        // Fire-and-forget: the script is idempotent, and a failure here must never break navigation.
        try
        {
            _ = Core.ExecuteScriptAsync(ErrorCaptureScript);
        }
        catch (Exception error) when (error is InvalidOperationException or COMException or ObjectDisposedException)
        {
            // Navigation is already committed to another document; the next completion retries.
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        string? type = null;
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(args.WebMessageAsJson);
            if (document.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object &&
                document.RootElement.TryGetProperty("type", out var property))
            {
                type = property.GetString();
            }
        }
        catch (System.Text.Json.JsonException)
        {
            return;
        }

        if (type != "print") return;
        PrintRequests.Add(type);
        if (!_options.ShowPrintDialog) return;
        try
        {
            Core.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
        }
        catch (InvalidOperationException)
        {
            // Print UI is unavailable in this composition state; the request is still recorded.
        }
    }

    public Task<NavigationResult> NavigateAsync(string pathAndQuery, int timeoutMs = 20000)
    {
        var url = pathAndQuery.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? pathAndQuery
            : $"{Origin}/{pathAndQuery.TrimStart('/')}";
        var completion = new TaskCompletionSource<NavigationResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending = completion;
        Core.Navigate(url);
        var timeout = Task.Delay(timeoutMs).ContinueWith(
            _ => new NavigationResult(false, url, "timeout"),
            TaskScheduler.Default);
        return Task.WhenAny(completion.Task, timeout).Unwrap();
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (!args.IsSuccess) LastNavigationError = args.WebErrorStatus.ToString();
        // The cancelled directory URL is not a real failure; the redirect that follows it is.
        if (_redirecting && !args.IsSuccess) return;
        _redirecting = false;
        var pending = _pending;
        _pending = null;
        pending?.TrySetResult(new NavigationResult(args.IsSuccess, Core.Source, args.WebErrorStatus.ToString()));
    }

    /// <summary>Evaluates JS and decodes the JSON the WebView2 bridge returns.</summary>
    public async Task<string?> EvalAsync(string script)
    {
        var raw = await Core.ExecuteScriptAsync(script);
        return raw is null or "null" ? null : System.Text.Json.JsonSerializer.Deserialize<string>(raw);
    }

    public async Task<bool> EvalBoolAsync(string script) => await EvalAsync(script) == "true";

    public async Task<double?> EvalNumberAsync(string script)
    {
        var raw = await Core.ExecuteScriptAsync(script);
        return double.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : null;
    }

    public Task<string?> EvalRawAsync(string script) => Core.ExecuteScriptAsync(script);

    private void BeginInvoke(Action action)
    {
        if (View.IsHandleCreated) View.BeginInvoke(action);
        else View.HandleCreated += (_, _) => View.BeginInvoke(action);
    }

    private static Uri? TryParse(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) ? uri : null;

    private bool IsAppHost(Uri uri) =>
        uri.Port == (_server?.Port ?? -1) &&
        uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase);

    public void Dispose()
    {
        View.Dispose();
        _server?.Dispose();
    }
}
