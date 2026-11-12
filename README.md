# Tercih Pusulası — KPSS preference decision support

Unofficial decision-support tool for ÖSYM KPSS central placement (tercih). Not affiliated with ÖSYM.
Binding source is always the current ÖSYM tercih kılavuzu and `ais.osym.gov.tr`.

## What it does (v1)

- Ingests official ÖSYM result documents per placement round and stores immutable snapshots.
- Cross-checks every parsed row against an independent CC BY 4.0 dataset (Gate D).
- (planned) Eligibility engine: programme -> nitelik kodu, so a candidate only sees rows they can legally write.
- (planned) Ordered 30-slot preference list with risk bands and a calibrated placement probability.

## Pipeline

```
node pipeline/run.mjs fetch    # download + hash raw documents for every registered round
node pipeline/run.mjs parse    # PDF text -> normalised JSON snapshots
node pipeline/run.mjs gate     # Gate A (arithmetic) / B (schema) / C (diff) / D (cross-source)
npm test                       # parser + gate unit tests
```

Data layout: `data/raw/<round>/` holds untouched bytes (gitignored), `data/rounds/<round>/` holds the normalised, committed snapshots.

## Notes that cost real debugging time

- `dokuman.osym.gov.tr` serves an "Erişim Engellendi" HTML page to plain curl. It needs a browser UA **and** `Referer: https://www.osym.gov.tr/`; the fetcher also verifies the `%PDF` magic bytes, never just HTTP 200.
- Current rounds are PDF only. `pdftotext -layout` output wraps long rows onto a second line (cadre code + institution on line 1, job title + numbers on line 2), so the parser is stateful rather than column-offset based.
- Unplaced rows carry `--` in the score columns; `0` is never a valid score.

## Turkish

**Tercih Pusulası** — ÖSYM KPSS merkezî yerleştirmesi için resmî olmayan karar destek aracı. ÖSYM ile bağlantılı değildir; bağlayıcı kaynak her zaman güncel ÖSYM tercih kılavuzu ve `ais.osym.gov.tr`'dir.

v1'de: dönem başına resmî ÖSYM sonuç belgelerini alıp değişmez snapshot olarak saklar, her satırı bağımsız bir CC BY 4.0 veri setiyle çapraz doğrular (Kapı D). Sıradaki adımlar: uygunluk motoru (mezun olunan program → nitelik kodu) ve 30 slotlu, risk bantlı tercih listesi.
