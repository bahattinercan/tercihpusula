# KPSS Tercih Asistanı — Implementation Plan (MVP, KPSS-2026/2)

Status: awaiting approval. Research basis: `docs/arastirma/kpss-tercih-uygulamasi-arastirmasi.md`.
Decisions (2026-11-12): scope = static data + eligibility + risk bands; platform = web PWA; pricing = free for 2026/2; audience = all three levels (lisans / ön lisans / ortaöğretim).

## 0. Verified environment and source facts (recon + M1, 2026-11-12)

Each of these cost real debugging time and is now encoded in the pipeline:

| Fact | Evidence | Consequence |
|---|---|---|
| Current rounds are published **as PDF only**; the HTML `<table>` pages that look like result tables are **legacy rounds** | 3A page served 155 rows = an old round, not the 554+ lisans rows of 2026/1 | no HTML scraping path; PDF text extraction is mandatory |
| `dokuman.osym.gov.tr` **blocks plain curl** (HTTP 200 with a 2.7 KB "Erişim Engellendi" page) and serves the real PDF only with a browser UA **and `Referer: https://www.osym.gov.tr/`** | header matrix; then 200 / 670 KB `application/pdf` | fetcher sends a referer and verifies `%PDF-` magic bytes, never just HTTP 200 |
| ÖSYM uses **two document naming schemes**: `…-en-kucuk-ve-en-buyuk-puanlar-lsans-<hash>.pdf` (2026/1) and `…/TERCIH2/minmaxlisans<date>.pdf` (2025/2, with `minmaxonl…`, `minmaxort…`, `sayisalbil…`) | both landing pages | discovery matches on filename families, not on fixed URLs; the hash suffix makes URLs unguessable |
| **`pdftotext -layout` is unusable here**: it wraps rows onto 1–3 lines, drops score cells for ~44% of rows and reorders columns | 555 rows → 309 complete, 246 with missing scores | use **`pdftotext -table`**, which emits exactly one line per table row (555/555 complete) |
| `-table` **justifies text**, so a cell can contain 5+ spaces ("VERİ  HAZIRLAMA VE KONTROL İŞLETMENİ") | cell histogram: 2 cells 507 rows, 3 cells 47, 1 cell 1 | split at 5+ spaces and re-join the title from the tail cells; a single-cell row falls back to the ` / İL / TEŞKİLAT` anchor |
| `pdftotext` exists **only inside Git's MSYS2 tree** (`C:\Program Files\Git\ucrt64\bin\pdftotext.exe`), on Git-Bash's PATH but not on the PATH Node inherits | `which pdftotext` → `/ucrt64/bin/pdftotext` | `pdftotext.mjs` resolves the binary explicitly (`PDFTOTEXT_BIN` override) — **zero npm dependencies** |
| ÖSYM's own **summary PDF is the arithmetic ground truth** and is parseable: LİSANS 104.148 / 977 / 976 / 1, TOPLAM 249.297 / 2.083 / 2.082 / 1 | parsed 2026/1 summary | Gate A reconciles every level's totals against it instead of trusting the row parser |
| `kpssden.com` API is keyless, CC BY 4.0, and **missing one cadre row** for 2026/1 lisans (`301017843`) | row-by-row diff | Gate D: missing rows fail, extra rows warn (our totals match ÖSYM's summary, so ours is right) |
| Scores can exist with `boş > 0` (kontenjan 2, yerleşen 1, boş 1) | 2025/2 rows 302016093/302016100 | the "no score" rule keys on `yerleşen === 0`, never on `boş > 0` |

## 0.1 M1 status (done)

`npm run all` is green for 2025/1, 2025/2, 2026/1 × 3 levels: 9 snapshots, 4 gates each.

| Round | Lisans | Ön lisans | Ortaöğretim | Gate A vs summary | Gate D |
|---|---|---|---|---|---|
| 2026/1 | 555 rows · 977 kontenjan · 976 yerleşen | 410 · 828 · 828 | 141 · 278 · 278 | ✓ | ✓ |
| 2025/2 | 990 · 1781 · 1778 | 570 · 1262 · 1262 | 248 · 689 · 689 | ✓ | ✓ |
| 2025/1 | 798 · 1593 · 1575 | 418 · 689 · 689 | 175 · 391 · 391 | ✓ | ✓ |

## 1. Target and hard deadline

| Item | Value |
|---|---|
| Launch | **2026-12-17**, the day the KPSS-2026/2 tercih kılavuzu publishes |
| Window | 17–24 December 2026 (8 days) |
| Working days from plan approval | ~24 |
| Non-negotiable | the product must be correct on day 1 with the *2026/2* table; every other feature is secondary |

If the guide publishes late or its layout differs, the fallback is: same codebase, 2026/1 snapshot, banner "2026/2 tablosu henüz yayımlanmadı — geçen dönem verisiyle çalışıyorsunuz". Launch is never blocked by the guide.

## 2. Repository layout

Command Center holds documents only, so the product lives in `projects/kpss-tercih/` (same pattern as `bakimpilot`, `video-hat`).

```
projects/kpss-tercih/
  README.md                 # bilingual (EN + TR) per repo rule
  plani.md                  # this file
  data/
    raw/<round>/            # untouched fetched bytes + sha256 (never edited)
    rounds/<round>/
      kadro.json            # normalised cadre rows (forward-looking)
      results.json          # realised min/max puan per kadro kodu
      nitelik.json          # code -> definition text -> parsed programmes
      meta.json             # source urls, hashes, gate results, parser version
    reference/
      programmes.json       # YÖK/ÖSYM programme names + level + aliases
      overrides.json        # curated corrections (eligibility, special conditions)
  pipeline/                 # Node, zero-dependency where possible
    fetch.mjs               # per-round fetch, hash, store raw
    parse-kadro.mjs         # table -> kadro.json
    parse-results.mjs       # TABLO-3A/3B/3C -> results.json
    parse-nitelik.mjs       # nitelik dictionary -> code/programme graph (LLM-assisted, reviewed)
    gates.mjs               # Gate A/B/C, exit code != 0 blocks publish
    predict.mjs             # T0 predictor -> predictions.json
    backtest.mjs            # rolling-origin backtest -> dist/backtest.json
  web/                      # Astro (static) + islands; no SSR server
  tests/                    # node:test
  dist/                     # build output (not committed)
```

Stack: **Astro + TypeScript + Tailwind**, static output, client islands only for the list builder. No DB, no auth, no server runtime in v1 (decided: free, no accounts → no KVKK data-processing exposure beyond analytics). Local storage holds the user's list; sharing is via URL-encoded list.

## 3. Work breakdown

### M1 — Data spine (Nov 13–19)

1. `fetch.mjs` for rounds 2024/1, 2024/2, 2025/1, 2025/2, 2026/1 (+ 2026/2 when published). Raw bytes + sha256 in `data/raw/`.
2. `parse-kadro.mjs` / `parse-results.mjs` → normalised JSON. `kadro_kodu` stays a **string**; `.........` (unplaced) becomes `null`, never `0`.
3. `gates.mjs`:
   - **A (arithmetic):** Σ kontenjan and Σ yerleşen per level must equal the official "sayısal bilgiler" page. Mismatch ⇒ exit 1.
   - **B (schema):** every nitelik code exists in the dictionary; no duplicate kadro kodu; every result row resolves to a kadro row; counts per level match `meta.json`.
   - **C (diff):** per (kurum, unvan) bucket, a >30% change vs the previous round must be acknowledged in `overrides.json` before publish (catches column-shift parser regressions).
4. `reference/programmes.json`: programme list per level with aliases, seeded from the guide's own programme names. Searchable picker in the UI reads this file.
5. Acceptance: `npm run gate:data` green for all five historical rounds; 2026/1 row counts match ÖSYM (lisans 554, ön lisans 410, ortaöğretim 141).

### M2 — Eligibility engine (Nov 20–26)

The only genuinely hard part, and the moat.

1. `parse-nitelik.mjs`: extract distinct nitelik codes used in the current table (expected order of a few hundred per level), pull each definition text from the guide annexes.
2. **LLM-assisted extraction, human-reviewed:** each definition ("Hemşirelik, Sağlık Memurluğu veya Sağlık Teknikerliği ön lisans programlarının birinden mezun olmak") → structured `{kind: 'programme'|'certificate'|'any_of_level'|'pointer', programmes: [...], confidence}`. Every extraction gets a review state: `auto` / `reviewed` / `needs_human`.
3. Fuzzy + alias matching of extracted programme names to `programmes.json`; unmatched names go to a review queue, never silently dropped.
4. Special conditions: codes like `6262` ("Bakınız Başvurma Özel Şartları") and certificate codes `62xx`/`73xx` are **flagged, not auto-passed**; the row shows "ek şart var — kılavuz md. X" with the exact clause text.
5. Output artefact: `eligibility.json` = `programme → writable kadro kodu set`, per round, plus the reason for every exclusion (`program uyuşmuyor` / `sertifika gerekli` / `özel şart`).
6. Acceptance gates:
   - coverage: ≥95% of rows in the current table have a confident (non-`needs_human`) mapping;
   - **precision 100%** on a 30-row random audit per level (a row marked writable must be writable — a false positive is the failure mode that hurts users);
   - recall ≥95% on the same audit;
   - fixtures: `3001` (any ön lisans) must accept every ön lisans programme and reject lisans-only rows; `3017` must reject a non-listed health programme (kılavuz md. 3.13 example).

### M3 — Decision product (Nov 27 – Dec 3)

1. **Score entry**: level + score (4-decimal accepted, comma/dot tolerant) + programme picker + optional conditions (birth date, certificates, licence class).
2. **Row explorer**: filter by il/unvan/kurum/istihdam şekli/band; sort by predicted taban; row card shows kontenjan, last-round taban (with round label), band, "geçen dönem boş kaldı" badge, and the eligibility reason if not writable.
3. **List builder**: 30 slots (hard cap, mirrors md. 3.4), drag/reorder, per-row band recomputation on every change, `P(placed)` for the whole list, warning when a bottom safety row has negative expected value ("bu satır puanını yakabilir").
4. **T0 predictor** (`predict.mjs`): features = last taban for the same kadro kodu, same unvan+il median, same unvan national median, kontenjan delta, level. Output = point estimate + interval + band. Method label shown on every number.
5. **Backtest** (`backtest.mjs`): rolling origin (2025/1→2025/2, 2025/2→2026/1, 2026/1→2026/2 when known). Metrics: MAE (puan and log-puan) per level, band hit-rate, reliability table. Published verbatim on `/metodoloji`.
6. Acceptance: builder state survives reload and URL round-trip; `P(placed)` deterministic for the same input (seeded); backtest report generated by a single command.

### M4 — Surface, trust, SEO (Dec 4–10)

1. SEO pages generated from the snapshot: per-unvan, per-kurum, per-il, per-kadro-kodu, plus **"2026/1'de boş kalan kadrolar"** (highest-intent page set). Each page must carry at least one computed value (band, prediction, eligibility note) — no thin pages.
2. PWA: installable, offline shell, list stored in `localStorage`, share link (`?l=code,code,...&p=82.5`).
3. Trust layer: visible disclaimer on every page ("resmî kaynak değildir; bağlayıcı olan ÖSYM/ais.osym.gov.tr'dir; yerleşme garantisi yoktur"), `/metodoloji` with backtest numbers, `/veri-kaynaklari` with attribution, no ÖSYM logo/trademark, distinct brand name.
4. Analytics: privacy-friendly, cookie-free; track funnel (score entered → rows filtered → list built → share clicked).
5. Acceptance: LCP < 2.5 s on throttled mobile, initial data payload < 300 KB gzip, all disclaimer/attribution pages reachable from every page footer.

### M5 — Freeze and swap (Dec 11–17)

1. Code freeze Dec 11. Dry-run the whole pipeline against the 2026/1 snapshot as if it were 2026/2.
2. Dec 17: fetch the real guide → parse → gates → review queue → publish. Target: live within 6 hours of publication.
3. On-call checklist for the window: gate failure runbook, manual table entry fallback, cache purge, error-page copy ("veri güncelleniyor").

## 4. Verification (the gate that must pass to say "done")

```
cd projects/kpss-tercih
npm run gate        # = gate:data && typecheck && lint && test && build
```

- `gate:data` — Gates A/B/C over every round in `data/rounds/`, exit code enforced.
- `typecheck` — `tsc --noEmit`, no `any`, no `@ts-ignore`.
- `lint` — ESLint flat config.
- `test` — `node:test`: parser fixtures (Turkish casing `İ/ı`, `.........` → `null`, 9-digit codes), eligibility fixtures (above), simulation/predictor determinism, URL list encoding round-trip.
- `build` — Astro build must produce the SEO page set without warnings.

Additional manual gates before launch: 30-row eligibility audit per level (recorded in `meta.json`), backtest report read end-to-end, mobile check on a real device.

## 5. Rollback

- Data: every round is an immutable snapshot; rollback = revert the `data/rounds/<round>` commit and rebuild (static, minutes).
- App: static build; previous build artifact can be re-deployed unchanged.
- Nothing irreversible in this plan: no migration, no push to a shared branch without approval, no external service with a lock-in.

## 6. Out of scope for this MVP (deliberate)

Crowd-sourced simulation, accounts, community/chat, AI chat, native apps, rent/cost-of-living data, danışman (B2B) panel, Sağlık Bakanlığı EKİP channel, EKPSS. Each is listed in the research doc with its own rationale; the ones worth revisiting for 2027/1 are crowd simulation (needs traffic first) and the danışman panel (better ARPU, less seasonal).

## 7. Risks specific to this plan

| Risk | Mitigation |
|---|---|
| Guide structure differs from 2026/1 | parser is config-driven (column map per round); manual-entry fallback path is part of M5 |
| Eligibility extraction quality | LLM output is never published unreviewed; precision gate at 100% on audit, `needs_human` rows are hidden from "writable" and shown as "kontrol et" |
| Over-promising on predictions | bands + published backtest + "tahmindir" copy; no "yerleşirsin" language anywhere |
| Traffic spike | fully static, no DB, edge cache; the list lives in the browser |
| Free tier ⇒ no revenue | accepted for 2026/2; the asset built is the eligibility graph + backtest credibility, monetised in 2027/1 |
