using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TercihPusula.Desktop;

internal sealed record CheckResult(string Name, bool Ok, string Detail);

internal sealed record SelfCheckReport(
    bool Ok,
    Bundle Bundle,
    long ColdStartMs,
    long ShellReadyMs,
    long FirstPaintMs,
    IReadOnlyList<CheckResult> Checks);

/// <summary>
/// Desktop equivalent of <c>web/smoke.mjs</c>: drives the real WebView2 shell and asserts the
/// invariants that only exist once the site is packaged (local origin, bundled data, print bridge,
/// external-navigation blocking). Exit code 0 = every check passed.
/// </summary>
internal static class SelfCheck
{
    /// <summary>Budget for "what the user waits on every launch": WebView2 init + first paint.</summary>
    private const long ShellBudgetMs = 5000;

    public static int Run(Bundle bundle, CommandLineOptions options)
    {
        var results = new List<CheckResult>();
        var exitCode = 1;
        var timings = new long[3]; // shellReady, firstPaint, coldTotal

        var form = new Form
        {
            Text = "Tercih Pusulası — self-check",
            StartPosition = FormStartPosition.Manual,
            Location = new Point(-32000, -32000), // off-screen: renders, never flashes
            ShowInTaskbar = false,
            Size = new Size(1280, 1000),
        };
        var shell = new Shell(
            bundle.Folder,
            new ShellOptions
            {
                EnableDevTools = false,
                OpenExternalInBrowser = false,
                ShowPrintDialog = false,
                ProfileFolder = Path.Combine(AppPaths.Root, "selfcheck-profile"),
            });

        form.Shown += async (_, _) =>
        {
            try
            {
                await shell.InitializeAsync(form);
                timings[0] = Program.ElapsedMs;
                var firstNav = await shell.NavigateAsync("index.html");
                timings[1] = Program.ElapsedMs;
                timings[2] = timings[1];
                exitCode = await RunChecksAsync(shell, bundle, firstNav, results, timings[0], timings[1]) ? 0 : 1;
            }
            catch (Exception error)
            {
                results.Add(new CheckResult("shell", false, error.GetType().Name + ": " + error.Message));
                exitCode = 1;
            }
            finally
            {
                Report(
                    new SelfCheckReport(exitCode == 0, bundle, timings[2], timings[0], timings[1], results),
                    options.ReportPath);
                form.Close();
            }
        };

        try
        {
            Application.Run(form);
        }
        finally
        {
            shell.Dispose();
        }
        return exitCode;
    }

    private static async Task<bool> RunChecksAsync(
        Shell shell,
        Bundle bundle,
        NavigationResult firstNav,
        List<CheckResult> results,
        long shellReadyMs,
        long firstPaintMs)
    {
        var allOk = true;
        void Add(string name, bool ok, string detail)
        {
            results.Add(new CheckResult(name, ok, detail));
            allOk &= ok;
        }

        async Task Check(string name, Func<Task<(bool Ok, string Detail)>> body)
        {
            try
            {
                var (ok, detail) = await body();
                Add(name, ok, detail);
            }
            catch (Exception error)
            {
                Add(name, false, error.GetType().Name + ": " + error.Message);
            }
        }

        var dataRows = 0;
        var dataRound = "—";

        await Check("page-load", async () =>
        {
            var title = await shell.EvalAsync("document.title") ?? string.Empty;
            var ok = firstNav.Ok && title.Contains("Tercih Pusulası", StringComparison.Ordinal);
            return (ok, $"{(firstNav.Ok ? "200" : firstNav.Error)} · \"{title}\"");
        });

        await Check("data-fetch", async () =>
        {
            var payload = await EvalJson(
                shell,
                "(()=>{const x=new XMLHttpRequest();x.open('GET','/data/lisans.json',false);x.send();" +
                "const j=JSON.parse(x.responseText);return JSON.stringify({status:x.status,rows:j.rows.length,round:j.round});})()");
            if (payload is null) return (false, "veri okunamadı");
            dataRows = payload.Value.GetProperty("rows").GetInt32();
            dataRound = payload.Value.GetProperty("round").GetString() ?? "—";
            var status = payload.Value.GetProperty("status").GetInt32();
            var ok = status == 200 && dataRows > 0 &&
                     Regex.IsMatch(dataRound, @"^\d{4}/\d+$") &&
                     dataRound == bundle.DataRound;
            return (ok, $"HTTP {status} · {dataRows} satır · dönem {dataRound}");
        });

        await Check("app-render", async () =>
        {
            var nav = await shell.NavigateAsync("uygulama.html?seviye=lisans&puan=85");
            await WaitForAsync(shell, "document.querySelectorAll('#rows tr').length", 10000);
            var rows = await shell.EvalNumberAsync("document.querySelectorAll('#rows tr').length") ?? -1;
            var count = await shell.EvalAsync("document.querySelector('#count').textContent") ?? string.Empty;
            var ok = nav.Ok && rows > 0 && (int)rows == dataRows && count.Contains(dataRows.ToString());
            return (ok, $"{rows}/{dataRows} satır · \"{count.Trim()}\"");
        });

        await Check("list-persist", async () =>
        {
            await shell.EvalAsync("localStorage.clear(); 'ok'");
            await shell.EvalAsync("(()=>{const b=document.querySelector('#rows button[data-add]');if(b)b.click();return 'ok'})()");
            var saved = await shell.EvalNumberAsync("JSON.parse(localStorage.getItem('tp:list:lisans')||'[]').length") ?? -1;
            var reload = await shell.NavigateAsync("uygulama.html?seviye=lisans&puan=85");
            await WaitForAsync(shell, "document.querySelectorAll('#list li:not(.empty)').length", 10000);
            var restored = await shell.EvalNumberAsync("document.querySelectorAll('#list li:not(.empty)').length") ?? -1;
            await shell.EvalAsync("(()=>{document.querySelector('#clear').click();return 'ok'})()");
            var cleared = await shell.EvalNumberAsync("JSON.parse(localStorage.getItem('tp:list:lisans')||'[]').length") ?? -1;
            var ok = saved == 1 && reload.Ok && restored == 1 && cleared == 0;
            return (ok, $"kaydedilen {saved} · yeniden yükleme {restored} · temizleme {cleared}");
        });

        await Check("kadrolar-dizin", async () =>
        {
            var nav = await shell.NavigateAsync("kadrolar/index.html");
            await WaitForAsync(shell, "document.querySelectorAll('.dizin-grid tbody tr').length", 10000);
            var rows = await shell.EvalNumberAsync("document.querySelectorAll('.dizin-grid tbody tr').length") ?? -1;
            var unvan = await shell.EvalNumberAsync("document.querySelectorAll('.dizin-grid .dizin-filter').length") ?? -1;
            var ok = nav.Ok && rows >= 133 && unvan >= 2;
            return (ok, $"{rows} satır · {unvan} süzgeç");
        });

        await Check("dir-redirect", async () =>
        {
            var nav = await shell.NavigateAsync("kadrolar/");
            await WaitForAsync(shell, "document.querySelectorAll('.dizin-grid tbody tr').length", 10000);
            var rows = await shell.EvalNumberAsync("document.querySelectorAll('.dizin-grid tbody tr').length") ?? -1;
            var ok = nav.Ok && nav.Url.EndsWith("/kadrolar/index.html", StringComparison.Ordinal) && rows >= 133;
            return (ok, $"{nav.Url.Replace(shell.Origin, string.Empty)} · {rows} satır");
        });

        await Check("path-traversal", async () =>
        {
            var status = await shell.EvalNumberAsync(
                "(()=>{const x=new XMLHttpRequest();try{x.open('GET','/../../package.json',false);x.send();return x.status;}catch(e){return -1}})()") ?? -1;
            return (status == 404, $"HTTP {status} (404 bekleniyor)");
        });

        await Check("sitemap", async () =>
        {
            var count = await shell.EvalNumberAsync(
                "(()=>{const x=new XMLHttpRequest();x.open('GET','/sitemap.xml',false);x.send();" +
                "return (x.responseText.match(/<loc>/g)||[]).length;})()") ?? -1;
            return (count >= 140, $"{count} URL");
        });

        await Check("no-external-resources", async () =>
        {
            var blocked = string.Join(", ", shell.BlockedResources.Take(3));
            return (shell.BlockedResources.Count == 0, blocked.Length == 0 ? "dış kaynak isteği yok" : blocked);
        });

        await Check("external-blocked", async () =>
        {
            var before = shell.BlockedExternal.Count;
            await shell.EvalAsync("location.href='https://example.com/'; 'ok'");
            await Task.Delay(700);
            var origin = await shell.EvalAsync("location.origin") ?? string.Empty;
            var ok = origin == shell.Origin && shell.BlockedExternal.Count > before;
            return (ok, $"origin {origin} · {shell.BlockedExternal.Count} dış gezinme engellendi");
        });

        await Check("print-bridge", async () =>
        {
            var before = shell.PrintRequests.Count;
            await shell.EvalAsync("window.print(); 'ok'");
            await Task.Delay(400);
            var ok = shell.PrintRequests.Count == before + 1;
            return (ok, $"{shell.PrintRequests.Count} yazdırma isteği yakalandı");
        });

        await Check("js-errors", async () =>
        {
            var errors = await shell.EvalAsync("JSON.stringify(window.__tpErrors||[])") ?? "[]";
            return (errors == "[]", errors == "[]" ? "hata yok" : errors);
        });

        await Check("shell-budget", async () =>
        {
            var ok = shellReadyMs < ShellBudgetMs && firstPaintMs < ShellBudgetMs;
            return (ok, $"WebView2 hazır {shellReadyMs} ms · ilk boyama {firstPaintMs} ms (bütçe {ShellBudgetMs})");
        });

        // Navigation cost per page: the shell serves from disk with no HTTP cache, so this is the
        // number that decides whether the app feels instant or sluggish.
        await Check("page-timings", async () =>
        {
            var pages = new[]
            {
                "index.html",
                "uygulama.html?seviye=lisans&puan=85",
                "kadrolar/index.html",
                "kadrolar/il-ankara.html",
                "kadrolar/unvan-tekniker.html",
                "metodoloji.html",
                "veri-kaynaklari.html",
                "bos-kalan-kadrolar.html",
            };
            var timings = new List<string>();
            var failures = 0;
            var slowest = 0L;
            foreach (var page in pages)
            {
                var watch = Stopwatch.StartNew();
                var nav = await shell.NavigateAsync(page);
                watch.Stop();
                if (!nav.Ok) failures += 1;
                slowest = Math.Max(slowest, watch.ElapsedMilliseconds);
                timings.Add($"{page.Split('?')[0].Replace(".html", string.Empty)}={watch.ElapsedMilliseconds}ms");
            }

            var ok = failures == 0 && slowest < 800;
            return (ok, $"en yavaş {slowest} ms (bütçe 800) · {string.Join(" ", timings)}");
        });

        return allOk;
    }

    private static async Task WaitForAsync(Shell shell, string script, int timeoutMs)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        while (Environment.TickCount64 < deadline)
        {
            if (await shell.EvalNumberAsync(script) is > 0) return;
            await Task.Delay(120);
        }
    }

    private static async Task<JsonElement?> EvalJson(Shell shell, string script)
    {
        var raw = await shell.Core.ExecuteScriptAsync(script);
        if (raw is null or "null") return null;
        var text = JsonSerializer.Deserialize<string>(raw);
        if (text is null) return null;
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static void Report(SelfCheckReport report, string? reportPath)
    {
        ConsoleBridge.Attach(allocateIfMissing: true);
        ConsoleBridge.Write(
            $"self-check — paket: {report.Bundle.Source}/{report.Bundle.Version} · veri: {report.Bundle.DataRound}" +
            $" · soğuk açılış {report.ColdStartMs} ms (kabuk {report.ShellReadyMs} ms, ilk boyama {report.FirstPaintMs} ms)");
        ConsoleBridge.Write($"klasör: {report.Bundle.Folder} ({(report.Bundle.Extracted ? "yeni çıkarıldı" : "önbellekten")})");
        foreach (var check in report.Checks)
        {
            ConsoleBridge.Write($"{(check.Ok ? "✓" : "✗")} {check.Name,-22} {check.Detail}");
        }

        var json = JsonSerializer.Serialize(new
        {
            ok = report.Ok,
            paintMs = report.FirstPaintMs,
            coldStartMs = report.ColdStartMs,
            bundle = new
            {
                source = report.Bundle.Source,
                version = report.Bundle.Version,
                folder = report.Bundle.Folder,
                dataRound = report.Bundle.DataRound,
                extracted = report.Bundle.Extracted,
            },
            checks = report.Checks.Select(check => new { name = check.Name, ok = check.Ok, detail = check.Detail }),
        });
        ConsoleBridge.Write(json);
        if (string.IsNullOrWhiteSpace(reportPath)) return;
        try
        {
            using var document = JsonDocument.Parse(json);
            File.WriteAllText(reportPath, JsonSerializer.Serialize(document, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            ConsoleBridge.Write($"rapor yazılamadı: {error.Message}");
        }
    }
}
