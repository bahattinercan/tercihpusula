# Tercih Pusulası — KPSS preference decision support

Unofficial decision-support tool for ÖSYM KPSS central placement (tercih). Not affiliated with ÖSYM.
The binding source is always the current ÖSYM tercih kılavuzu and `ais.osym.gov.tr`.

## What it does

- Ingests official ÖSYM result documents per placement round and stores immutable snapshots.
- Builds the **eligibility graph** from the guide package: diploma programme → nitelik code → cadre rows.
  Certificate / special-condition codes never pass silently; they are flagged "kontrol et".
- Predicts a closing score per cadre row from previous rounds (historical anchor) and publishes
  the measured error on `/metodoloji`.
- Ships a static site: 30-slot preference list builder, shareable links, risk bands,
  "geçen dönem boş kalan kadrolar", per-unvan and per-il pages.

## Commands

```
node pipeline/run.mjs fetch     # download + hash raw documents for every registered round
node pipeline/run.mjs parse     # result PDFs -> normalised JSON snapshots
node pipeline/run.mjs guide     # nitelik dictionaries + cadre tables -> eligibility graph
node pipeline/run.mjs gate      # gates A (official totals) B (schema) C (diff) D (cross-source) E (table vs results) F (field accuracy)
node pipeline/run.mjs backtest  # rolling-origin backtest -> data/rounds/backtest.json
node pipeline/run.mjs predict   # predictions for the newest round
npm run build                   # static site -> dist/
npm run smoke                   # headless-browser checks + screenshots (dist/.shots/)
npm test                        # parser, gate, eligibility and predictor tests
npm run gate                    # everything above, in order
```

Zero runtime dependencies. `pdftotext` (xpdf) is used as a subprocess; `PDFTOTEXT_BIN` overrides
its path (on this machine it only exists inside Git's MSYS2 tree).

## Data layout

`data/raw/<round>/` untouched bytes (gitignored) · `data/rounds/<round>/` committed snapshots ·
`data/reference/` curated fallbacks (guide document map, province list).

## Hard-won notes

- `dokuman.osym.gov.tr` answers plain requests with a 2.7 KB "Erişim Engellendi" HTML page while
  returning HTTP 200, so the fetcher validates the `%PDF-` magic bytes instead of the status code.
- Current rounds are PDF only; `pdftotext -layout` drops score cells on these exports, `-table` does not.
- ÖSYM uses two document naming schemes; the 2026/1 one drops the i in "lsans" (see `pipeline/rounds.mjs`).
- The guide landing page sometimes serves a generic document listing under automated requests;
  `data/reference/guide-docs.json` is the fallback map.
- Unplaced rows carry `--`; `0` is never a valid score. A partially filled cadre (kontenjan 2,
  yerleşen 1) does have a score, so the rule keys on `yerleşen`, never on `boş`.

See `RUNBOOK.md` for the day-of-launch procedure and `plani.md` for the plan and measured findings.

## Türkçe

**Tercih Pusulası** — ÖSYM KPSS merkezî yerleştirmesi için resmî olmayan karar destek aracı. ÖSYM ile bağlantılı değildir; bağlayıcı kaynak her zaman güncel ÖSYM tercih kılavuzu ve `ais.osym.gov.tr`'dir.

Ne yapar: dönem başına resmî belgeleri alıp değişmez anlık görüntü olarak saklar; kılavuzun nitelik kodlarından **mezuniyet programı → yazılabilir kadro** grafiğini kurar (sertifika ve özel şart kodları otomatik geçmez, “kontrol et” olarak işaretlenir); satır bazında tahmini kapanış puanı üretir ve ölçülen hata payını `/metodoloji` sayfasında yayımlar; 30 tercihli liste kurucu, paylaşılabilir bağlantı, risk bantları ve “geçen dönem boş kalan kadrolar” sayfasıyla birlikte tamamen statik bir site üretir.

Komutlar: `npm run gate` (test + tüm veri hattı + build + tarayıcı kontrolü). Yeni dönem yayına alma adımları `RUNBOOK.md` içinde; plan ve ölçümler `plani.md` dosyasında.
