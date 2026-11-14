# Desktop app — build, release, troubleshooting

The site ships as a portable Windows application: `TercihPusula.exe`, no installer, no local
server, no network. This document covers how the shell works, how to build and verify it, and
what to do when it misbehaves.

Design decisions and the feasibility measurements behind them: [`desktop-app-plan.md`](desktop-app-plan.md).

## What the shell is

| Piece | Implementation |
|---|---|
| Runtime | .NET 11 (`net11.0-windows`), WinForms, single-file publish |
| Renderer | Microsoft Edge WebView2 (`Microsoft.Web.WebView2`) — already installed on Windows 10/11 |
| Content | `dist/` zipped into the exe as `dist.zip`, extracted to `%LOCALAPPDATA%\TercihPusula\app\<sha8>\` |
| Origin | `http://127.0.0.1:47821` — a loopback-only HTTP server (`desktop/LoopbackServer.cs`). Fixed port so the origin, and therefore the saved preference list, survives restarts. |
| Update | New exe, or drop a full web build into `<exeDir>\data-override\` |

`%LOCALAPPDATA%\TercihPusula` layout:

```
app\<sha8>\            extracted bundle (one folder per embedded zip hash; old ones are removed)
WebView2\              WebView2 profile — holds localStorage, i.e. the saved preference list
selfcheck-profile\     isolated profile used by --self-check
settings.json          window size/position
```

The origin host name is **frozen**. Changing it silently resets every user's saved preference list
because `localStorage` is origin-scoped; `--self-check` asserts the origin.

## Build

```bash
npm run build                 # dist/ (the site)
npm run desktop:build         # dist.zip → icon → dotnet publish → build/desktop + portable zip
npm run desktop:check         # runs build/desktop/TercihPusula.exe --self-check
npm run gate:desktop          # npm run gate && desktop:build && desktop:check
```

`desktop:build` flags: `--skip-web` (reuse the current `dist/`), `--self-contained` (bundles the
.NET runtime, ~118 MB instead of ~2.2 MB), `--no-zip`.

Artefacts:

```
build/desktop/TercihPusula.exe                 framework-dependent single file (~2.2 MB)
build/desktop/README.txt                       user-facing notes shipped in the zip
build/TercihPusula-win-x64-<round>.zip         portable package (~1.3 MB)
```

The exe name, icon and title bar come from `desktop/TercihPusula.Desktop.csproj`; `ApplicationIcon`
uses `desktop/Resources/app.ico`, regenerated from `dist/assets/favicon.svg` by
`npm run desktop:icon -- --force`.

## Native chrome

The window frame follows the site, not the Windows default:

| Piece | Where |
|---|---|
| Palette (dark/light) | `desktop/Theme.cs` — colours copied from `web/assets/site.css` tokens; follows the Windows app theme, like the page's `prefers-color-scheme` |
| Menu strip + dropdown | `desktop/MenuRenderer.cs` — mono uppercase labels, 4 px radius chips, hairline separators, accent hover, no image gutter |
| Title bar | `DwmSetWindowAttribute` dark-mode flag |

Menu items are plain `ToolStripMenuItem`s built in `MainForm.BuildMenu()`; the renderer paints them, so a new item needs no styling code. Keep labels uppercase in source — the dropdown width is measured from the text as stored, so mixed case gets clipped once the renderer uppercases it.

**Docking rule:** the WebView2 must be at the front of the z-order (`View.BringToFront()` in `Shell.InitializeAsync`). WinForms lays out docked controls in *reverse* z-order, so a `Dock.Fill` control added after the menu is laid out first and covers it — which silently hides the top ~34 px of the page (it hid the site's own "Tercih Pusulası" brand line).

## Verification

`--self-check` is the desktop gate. It drives the real shell off-screen and asserts:

| Check | What it proves |
|---|---|
| `page-load` | bundled `index.html` loads under the local origin |
| `data-fetch` | `/data/lisans.json` is served from the bundle (HTTP 200, matching round) |
| `app-render` | the preference builder renders every row (555 = 555) |
| `list-persist` | add → localStorage → reload → still there → clear |
| `kadrolar-dizin` | the cadre index renders and its filters are present |
| `dir-redirect` | `/kadrolar/` is redirected to `index.html` (WebView2 has no directory index) |
| `sitemap` | 140 URLs are present in the bundle |
| `no-external-resources` | browsing the app never requests an external host |
| `external-blocked` | `location.href = https://…` is cancelled, origin unchanged |
| `print-bridge` | `window.print()` reaches the host (native print dialog) |
| `js-errors` | no uncaught JS errors during the run |
| `path-traversal` | `/../../package.json` answers 404 |
| `shell-budget` | WebView2 ready + first paint under 5 s |
| `page-timings` | every page navigates in under 800 ms (the shell serves from disk, so this is the "does it feel instant" gate) |

`--self-check --report <file>` also writes the JSON report. Exit codes: `0` all checks passed,
`1` a check failed, `2` setup problem (missing bundle, WebView2 runtime, no desktop session).

The self-check needs an interactive Windows session (it creates a window). On a headless CI agent
run `npm run gate` only; `gate:desktop` is meant for a developer machine or a desktop runner.

## Data refresh without a rebuild

```bash
npm run build
# copy the *contents* of dist/ next to the exe as data-override/
Robocopy dist "C:\path\to\app\data-override" /E
"C:\path\to\app\TercihPusula.exe" --self-check     # "paket: data-override"
```

`data-override` wins over the embedded copy and is served as-is, so the same directory-index rule
applies (the shell redirects `/kadrolar/` at runtime, nothing to rewrite).

## Command line

```
TercihPusula.exe                      open the app
TercihPusula.exe --self-check         run the desktop gate (exit 0/1)
TercihPusula.exe --self-check --report report.json
TercihPusula.exe --dist <folder>      dev: serve an arbitrary build instead of the embedded one
TercihPusula.exe --devtools           enable WebView2 devtools + context menu
TercihPusula.exe --version | --help
```

## Startup and navigation feedback

| Piece | Behaviour |
|---|---|
| Loading overlay | `desktop/LoadingOverlay.cs` — painted in the site's language (mono uppercase label + accent rule). Shown immediately for the first navigation, otherwise only if a navigation is still running after 150 ms, so fast pages do not flicker. Hidden on `NavigationCompleted`. |
| Print / error bridge | Installed after the document is parsed (`DOMContentLoaded`, with `NavigationCompleted` as a fallback), **not** through `AddScriptToExecuteOnDocumentCreatedAsync`: a document-created script runs before parsing and any host hiccup there delays `DOMContentLoaded` for the whole page. |

### Why a loopback server instead of the WebView2 virtual host

The first version served the extracted folder through `SetVirtualHostNameToFolderMapping`. Every request on that host cost **~2 s**, so each page felt frozen while the spinner never appeared:

| Measurement (same run) | Result |
|---|---|
| `about:blank` | 5 ms |
| `https://tercihpusula.local/robots.txt` (95 bytes, mapped) | 2015 ms |
| `http://…/robots.txt` (mapped) | 2017 ms |
| `https://…/assets/site.css` (mapped) | 2019 ms |
| `http://127.0.0.1:47821/robots.txt` (this server) | **2–18 ms** |

Page size and content did not matter (6 KB and 73 KB pages identical), which isolated the cost to the mapping itself. After the switch, `page-timings` reports **24–292 ms** per page and the first paint went from 2560 ms to ~720 ms.

Consequences of the change, all deliberate:

- The app now opens **one loopback port** (`47821`, fixed; a free port is used if it is busy). Nothing is reachable from another machine; no firewall prompt appears on Windows for a 127.0.0.1 listener.
- The origin changed from `https://tercihpusula.local` to `http://127.0.0.1:47821`, so preference lists saved by the previous build are not carried over (localStorage is origin-scoped). The port is fixed precisely so this does not happen again.
- The server answers only `GET`/`HEAD` under the extracted folder (`AppPaths.SafeJoin` rejects anything else — `path-traversal` asserts the 404), sends `nosniff` and `Cache-Control: no-store`.
- `HttpListener` was tried first and answered 400 for a non-elevated user (http.sys URL reservation), which is why the server is a raw `TcpListener`.

### Smart App Control blocks unsigned builds

On a Windows 11 machine with **Smart App Control enabled** (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 1`), every newly built unsigned exe is refused:

```
CodeIntegrity 3118 "Smart App Control Block Details"
3077 ... did not meet the Enterprise signing level requirements or violated code integrity policy
Permission denied / 0x800711C7 (assembly load)
```

It is intermittent: the same build may run a few minutes after publish, then be blocked again after a rebuild. `npm run desktop:check` detects this case and prints the two options (turn SAC off — one-way — or sign the exe). Practical consequence: **unsigned local builds are not a reliable distribution channel**; plan for code signing before handing the exe to anyone.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "WebView2 çalışma zamanı bulunamadı" | WebView2 Runtime missing (old Win10 image) | Install the Evergreen bootstrapper: <https://go.microsoft.com/fwlink/p/?LinkId=2124703> |
| Window opens blank / white | Extraction or virtual host failure | Run `TercihPusula.exe --self-check`; the report names the failing check |
| "zaten açık" on launch | Single-instance mutex | Close the other window |
| Saved list disappeared | Different origin (custom build changed `DistBundle.Host`) or a fresh Windows profile | Keep the host constant; the list lives in `WebView2\` |
| List/edit not restored after moving the exe | The profile is per-Windows-user, not per-folder (by design) | Nothing to do — the list follows the user |
| SmartScreen "unknown publisher" | Unsigned portable exe | "More info → Run anyway"; signing is a separate, optional step |
| Antivirus quarantines a freshly built exe | New unsigned single-file binary | Rebuild and allow; do not disable protection |
| Corrupt profile after a crash | WebView2 user data damage | Delete `%LOCALAPPDATA%\TercihPusula\WebView2` (saved list is lost) and restart |
| `--self-check` prints nothing | Launched without a console and the console bridge failed | Run it from `cmd`/PowerShell; it allocates a console when needed |
| `Permission denied` when launching the exe | Smart App Control / Device Guard blocked the unsigned binary (CodeIntegrity 3118/3077) | Turn SAC off or sign the exe — see above |
| Pages feel slow | Regression in the loopback server or a new dependency in the page | `--self-check` prints `page-timings` (budget 800 ms per page) |

Logs: nothing is logged by default. Startup failures show a dialog with the failing folder path.

## Rollback

The desktop layer is additive:

```bash
git rm -r desktop scripts/desktop-build.mjs scripts/desktop-check.mjs scripts/make-icon.mjs docs/desktop-app.md
git checkout -- package.json .gitignore README.md RUNBOOK.md
rm -rf build
```

Web output and the deploy path are unaffected throughout: `npm run gate` and
`npx wrangler pages deploy dist` keep working exactly as before.
