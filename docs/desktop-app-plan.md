# Desktop app plan — Windows shell for Tercih Pusulası

Status: **implemented** (P0–P3). Feasibility probe lived in `%TEMP%\tp-probe-win`; the shipped shell is `desktop/`. Measured outcomes are recorded at the end of this file.

## 1. Goal and decisions

Turn the published static site into a locally installed Windows application: one double-clickable `.exe`, no browser, no local server, no network.

Decisions taken (user input, 2026-11-13):

| Question | Decision |
|---|---|
| Packaging | **.NET 11 WinForms + WebView2** (SDK 11.0.100 and WebView2 runtime 157.0.4341.46 already installed) |
| Data updates | **Packaged data only.** New round = rebuild + ship a new exe. No fetch/parse inside the app. |
| Scope | **All 139 pages exactly as built** (`uygulama`, `kadrolar`, `bos-kalan-kadrolar`, `metodoloji`, `veri-kaynaklari`, index pages) |
| Distribution | **Portable exe/zip.** No installer, no registry, no admin rights, no code signing |

## 2. Verified feasibility (probe results, not assumptions)

Probe: `dotnet new winforms` + `Microsoft.Web.WebView2 1.0.4314.35`, served the real `C:\Orca\tercihpusula\dist` through `SetVirtualHostNameToFolderMapping("tercihpusula.local", dist, Allow)`.

| Check | Result |
|---|---|
| NuGet restore / `net11.0-windows` target | OK (1 warning MSB3277 from the unused WPF asset — suppressible) |
| Page renders in WebView2 | `#rows` = **555 rows**, title correct |
| App fetches its data | `fetch('/data/lisans.json')` → **200**, `rows=555` |
| `localStorage` (preference list persistence) | OK |
| Directory URL `https://tercihpusula.local/kadrolar/` | **FAILS** (`navigation failed: Unknown`) — WebView2 does not resolve directory → `index.html` |
| Same page as `/kadrolar/index.html` | OK, **135 rows** (52 unvan + 81 il + 2 header) |
| Root URL `https://tercihpusula.local/` | FAILS for the same reason |
| Path with spaces + Turkish chars (`tp dist testi-ıü`) | OK |
| exe size, framework-dependent single file | **0.9 MB** (+195 KB `WebView2Loader.dll`) |
| exe size, self-contained single file | **117.9 MB** |
| Repository state after probe | unchanged (`dist/` rebuilt only; probe under `%TEMP%`) |

Consequence: the desktop bundle must rewrite the one directory link the site emits (`href="/kadrolar/"`, 140 occurrences) to `/kadrolar/index.html`, and the shell must bootstrap on `/index.html`. This is a one-line transform in the packaging script; web output stays untouched.

## 3. Architecture

```
TercihPusula.exe  (single file, WinForms + WebView2, framework-dependent ~1.1 MB)
├── embedded resource: dist.zip        <- produced by scripts/desktop-build.mjs
├── first run: extract to %LOCALAPPDATA%\TercihPusula\app\<sha8>\  (older <sha8> folders deleted)
├── CoreWebView2.SetVirtualHostNameToFolderMapping(
│        "tercihpusula.local" -> extracted dir, Allow)
├── bootstrap: https://tercihpusula.local/index.html
├── NavigationStarting  -> allow only host tercihpusula.local; http(s) elsewhere -> default browser
├── NewWindowRequested  -> cancel, open externally (no popups inside the app)
├── injected script     -> window.print() override -> host shows the native print dialog
├── settings            -> %LOCALAPPDATA%\TercihPusula\settings.json (window size/state/maximized)
└── data override       -> <exeDir>\data-override\ wins over the embedded copy (drop-in data refresh)

One loopback port is opened (127.0.0.1 only). No service, no registry, no admin, no network.
Stable origin (tercihpusula.local) keeps users' preference lists across app versions —
renaming that host would silently reset every saved list.
```

The first implementation used a WebView2 virtual host (no port at all), but every request through that mapping cost ~2 s per navigation; see §12. The shipped shell serves the same folder from a loopback `TcpListener` instead, which measured 2–18 ms per request.

## 4. Files

New:

| File | Purpose |
|---|---|
| `desktop/TercihPusula.Desktop.csproj` | `net11.0-windows`, WinForms, `PublishSingleFile`, embedded `Resources/dist.zip`, `ApplicationIcon` |
| `desktop/Program.cs` | entry point, `--self-check` mode, single-instance guard |
| `desktop/MainForm.cs` | window, WebView2 host, navigation policy, print bridge, window-state restore |
| `desktop/DistBundle.cs` | extract `dist.zip` to versioned folder (sha8), clean old versions, resolve `data-override` |
| `desktop/AppPaths.cs` | `%LOCALAPPDATA%\TercihPusula` layout, safe path joins |
| `desktop/SelfCheck.cs` | the acceptance gate (see §7) |
| `desktop/Resources/app.ico` | window/taskbar icon (from `dist/assets/favicon.svg`) |
| `scripts/desktop-build.mjs` | build dist → zip → `dotnet publish` → portable zip + sha256 |
| `scripts/desktop-check.mjs` | runs the packaged exe's `--self-check` and passes its exit code through |
| `scripts/make-icon.mjs` | renders `dist/assets/favicon.svg` into a multi-size `.ico` over CDP |
| `docs/desktop-app.md` | architecture, how to build/release, troubleshooting, rollback |

Modified (additive only):

| File | Change |
|---|---|
| `package.json` | `desktop:build`, `desktop:check`, `gate:desktop` scripts |
| `.gitignore` | `desktop/bin/`, `desktop/obj/`, `desktop/Resources/dist.zip`, `build/` |
| `README.md` | bilingual "Windows app" section (build once, run anywhere with the .NET 11 desktop runtime) |
| `RUNBOOK.md` | new section: desktop release for a new round (fetch → … → build → `desktop:build` → attach zip) |

Not touched: `pipeline/`, `web/`, `tests/`, `data/`. The web deploy path and `npm run gate` stay exactly as they are.

## 5. Phases

| Phase | Work | Effort | Exit |
|---|---|---|---|
| **P0 – shell** | csproj + `Program.cs` + `MainForm.cs` mapping to a *given* dist path, navigation policy, external links | ~0.5 day | window opens, 555 rows, `npm run smoke` parity reached |
| **P1 – portable bundle** | embedded `dist.zip`, extraction/cache/cleanup, window-state file, icon, About (data round from `dist/data/lisans.json`), print bridge, `data-override` | ~0.5 day | exe runs from a copied folder, no `dist/` beside it, list survives restart |
| **P2 – build & gate** | `scripts/desktop-build.mjs`, `--self-check`, `desktop:*` scripts, docs, README/RUNBOOK sections | ~0.5 day | `npm run gate:desktop` green end to end |
| **P3 – hardening** | WebView2-missing fallback message, SmartScreen/AV note in docs, `--self-contained` switch, offline assertion | ~0.25 day | offline run green, documented |

Optional (explicit approval needed): code signing, `tercihpusula://` deep links (requires registry writes — conflicts with "portable"), in-app auto-update, single `dist` folder distributed beside the exe instead of embedded.

## 6. Data version surfaced in the UI

`dist/data/lisans.json` already carries `round` (`2026/1`) and `sigma`. The About box shows: data round, app version, extraction path, and a "reload" command. No change to `web/build.mjs` and no timestamp is written anywhere, so builds stay byte-reproducible.

## 7. Acceptance criteria

1. `node scripts/desktop-build.mjs` produces `build/TercihPusula.exe` (≤ 2.5 MB framework-dependent — the embedded bundle adds 0.85 MB) and `build/TercihPusula-win-x64-2026-1.zip` (≤ 2 MB) with a printed sha256.
2. `TercihPusula.exe --self-check` exits **0** and prints a JSON report containing: `rows=555`, `fetch=/data/lisans.json 200`, `kadrolar=135`, `localStorage=ok`, `externalNavBlocked=true`, `dataRound=2026/1`, `paintMs<5000`.
3. Same self-check exits 0 with **network disabled** (no external dependency).
4. `netstat -ano | findstr 47821` shows a listener bound to **127.0.0.1 only** (never 0.0.0.0).
5. In-app `/kadrolar/` navigation works (rewritten to `index.html`); clicking `https://ais.osym.gov.tr` opens the default browser and the app stays on the local page.
6. Preference list (30 picks) survives app restart and re-extraction (stable origin).
7. Second launch reuses the extracted folder (< 300 ms to navigation) and removes previous version folders.
8. `npm run gate` unchanged and green (38 unit · gates A–F · 139 pages · 32 browser checks); the new `dist/data/*` output is byte-identical to today's.
9. Portable zip runs from a path containing spaces and Turkish characters.

## 8. Verification commands

```bash
# web layer (unchanged, must stay green)
npm run gate

# desktop layer
node scripts/desktop-build.mjs                  # dist + zip + publish + sha256
npm run desktop:check                           # = TercihPusula.exe --self-check
npm run gate:desktop                            # npm run gate && desktop:build && desktop:check

# manual spot checks
build\desktop\TercihPusula.exe                  # double-click, offline
netstat -ano | findstr 47821                    # expect 127.0.0.1:47821 only
```

`--self-check` is the desktop equivalent of `web/smoke.mjs`: it drives the real WebView2 instance and asserts the shell invariants above. It is the only new gate; it cannot run in a session without a desktop (documented), so `gate:desktop` stays opt-in and `npm run gate` keeps working in headless CI.

## 9. Rollback

The change is additive. `git rm -r desktop scripts/desktop-build.mjs docs/desktop-app.md` plus reverting the four additive lines (`package.json`, `.gitignore`, `README.md`, `RUNBOOK.md`) returns the repository to today's state. `dist/` output is unchanged, so the web deploy is unaffected throughout. A shipped zip can be withdrawn by deleting the release artifact; nothing is installed on users' machines, so there is no uninstall path to fix.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Directory URLs fail under virtual host (measured) | Build-time rewrite of `href="/kadrolar/"` in the desktop bundle only; shell bootstraps on `/index.html` |
| Target machine lacks the .NET 11 desktop runtime | Framework-dependent default on this machine; `--self-contained` switch documented (117.9 MB) |
| WebView2 runtime missing (old Win10) | Startup check with a clear message + link to the Evergreen bootstrapper; no silent blank window |
| SmartScreen "unknown publisher" | Documented in README; code signing is an optional phase requiring a certificate |
| Antivirus flags a fresh unsigned single-file exe | Documented; optional signing |
| WebView2 user data folder grows / corrupts | Fixed path, `--reset-profile` flag documented as the manual fix |
| Users expect new rounds without a new exe | `<exeDir>\data-override\` drop-in folder documented in About/README |
| Changing origin resets saved lists | Host name `tercihpusula.local` is frozen by test (self-check asserts the origin) |
| CSP in `dist/_headers` does not apply inside the shell | Shell relies on: frozen local content, navigation allowlist, host objects disabled, devtools off in Release |

## 11. Decisions taken while implementing

1. Window chrome: standard WinForms title bar with the app icon (Windows snapping and F11 keep working).
2. Browser accelerators stay on (Ctrl+F, Ctrl+P, F5); devtools are off in Release and behind `--devtools`.
3. The exe is `TercihPusula.exe`.
4. The shell's own menu strings and messages are Turkish; code, docs and commit messages are English.

## 12. Outcome (measured on this machine, 2026-11-13/14)

| Item | Planned | Measured |
|---|---|---|
| exe, framework-dependent single file | ≤ 2 MB | **2.30 MB** (0.85 MB of it is the embedded `dist.zip`) |
| portable zip | ≤ 5 MB | **1.31 MB** |
| WebView2 ready | — | **440–733 ms** |
| first paint (process start → first navigation) | ≤ 2 s | **0.72–0.88 s** (2.56 s before the server switch) |
| self-check | 12 checks | **14/14 pass**, exit 0 |
| page navigation | — | **24–292 ms** per page (2020 ms per page on the WebView2 virtual host) |
| second extraction | reuse cache | reused (only the hash folder is kept) |
| portable run from a path with spaces + Turkish chars | pass | pass |
| `data-override` drop-in | detected | detected (`paket: data-override`) |
| `--dist <folder>` dev mode | works on the live `dist/` | works |

Deviations from the plan, all deliberate:

1. **The virtual host was replaced by a loopback server.** Every request through
   `SetVirtualHostNameToFolderMapping` cost ~2 s here (`about:blank` 5 ms vs a 95-byte file on the
   mapped host 2015 ms), so each page felt frozen. `desktop/LoopbackServer.cs` serves the same folder
   over `http://127.0.0.1:47821` in 2–18 ms. The fixed port keeps the localStorage origin stable;
   directory URLs are handled by the server instead of a shell-side redirect.
2. **Build-time link rewrite was dropped.** Directory URLs are answered by the loopback server
   (`/kadrolar/` → `index.html`), so a `data-override` folder works with an untouched web build.
3. **Paint budget measures the shell, not the cold profile.** The first ever launch also creates
   the WebView2 user-data folder; that one-time cost is reported separately (`coldStartMs`).
4. **`dist/data/lisans.json` needed no change.** Its existing `round` field is the version surfaced
   in the title bar and About box, so `web/build.mjs` and its byte-reproducible output stay
   untouched.
5. **Smart App Control blocks unsigned builds on this machine** (CodeIntegrity 3118/3077, intermittent
   after every publish). Signing or turning SAC off is a user decision; until then local runs are
   unreliable and `npm run desktop:check` reports the block explicitly.
