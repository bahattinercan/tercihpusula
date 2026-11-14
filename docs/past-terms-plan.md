# Past-term fill history ("geçmiş dönemde dolanlar") — detailed plan

Status: **approved by the user in chat, implemented in this change** · written 2026-11-14 · scope:
the KPSS preference screen (`/uygulama.html`).

## 1. Request and the measured gap

Field request (2026-11-14, screenshot of the live site): *put a checkbox "geçmiş dönemde dolanlar";
when I tick it, let me see with what score those cadres closed last time — taban and tavan.*

Today the table has one history number: `taban` (`row.taban`), a single column headed "geçen taban".
There is no `tavan`, and there is no way to ask "which cadres actually filled in an earlier term".

What the committed data already holds (`data/rounds/<period>/<level>.json`, per row):
`kontenjan`, `yerlesen`, `bosKalan`, `minPuan`, `maxPuan` — i.e. **everything needed**, for three
rounds. Measured on 2026-11-14:

| level | current rows (2026/1) | same `kod` in 2025/1 | same `kod` in 2025/2 | filled among matched (2025/1) |
|---|---|---|---|---|
| lisans | 555 | 321 | 0 | 321 |
| onlisans | 410 | 402 | 0 | 402 |
| ortaöğretim | 141 | 20 | 20 | 20 |

| level | same `kurum`+`il`+`unvan` in 2025/2 | filled | same group in 2025/1 | filled |
|---|---|---|---|---|
| lisans | 200 | 200 | 268 | 262 |
| onlisans | 118 | 118 | 93 | 93 |
| ortaöğretim | 65 | 65 | 45 | 45 |

Two facts drive the design:

1. **Cadre codes are period-scoped.** 2025/1 codes look like `301…`, 2025/2 like `302…`, 2026/1 like
   `301…` again — hence the exact-code join yields 0 hits between 2026/1 and 2025/2, while the
   *same* institution/unit/title still appears there (200 lisans rows). A code-only history would
   silently report "no history" for the period the user is actually preparing for.
2. **Group matching finds the rest.** Joining on `kurum|il|unvan` recovers 200 lisans rows against
   2025/2 that the code join misses.

## 2. Data contract

New optional field per row in `dist/data/<level>.json` (absent when there is no history, so the
payload does not grow for rows without it):

```
gecmis: [
  { d: "2025/1", es: "kod" | "grup", knt: 22, yer: 22, taban: 74.6197, tavan: 77.89499, bos: 0 },
  ...
]
```

* `d` — previous round as `YYYY/N`, newest first, **at most three** terms (bounded payload).
* `es` — how the row was matched: `kod` (same cadre code, strongest) or `grup`
  (`kurum|il|unvan` equal, weaker — the UI says so in the drill-down and in a `title`).
* `taban`/`tavan` — `minPuan`/`maxPuan` of that term; `null` when the cadre closed empty.
* `bos` — `bosKalan` (quota − placed); `yer` — `yerlesen`.

Builder: `pipeline/lib/past-terms.mjs` (pure, unit-tested), consumed by `web/build.mjs`
(`buildLevelData`), which already loads every older round for the fallback fill — the same rows are
reused, so no extra I/O. Payload measured after the change (2026/1 snapshots): lisans 307 → 358 KB
(+16.7 %, 57 KB gzipped), ön lisans +19.8 %, ortaöğretim +15.1 %. Kept inline rather than in a second
file because it saves a request on mobile and stays inside the existing `data/*.json` contract; scores
are rounded to the three decimals the UI prints and `bos` is derived (`knt − yer`) instead of stored.

## 3. UI contract (`web/assets/app.js`, markup in `web/build.mjs`)

1. Toolbar gets a checked-false checkbox `#onlyFilled`, label **"geçmiş dönemde dolanlar"**,
   `title="En az bir geçmiş dönemde kontenjanı dolan kadrolar"`. Filter rule:
   keep a row when any `gecmis` entry has `yer > 0`. Rows without history drop out — the empty
   state explains why (`renderEmptyNote` already lists active filters; the new flag joins that list).
2. New column **"önceki dönemler"** after "geçen taban": shows the newest past term as
   `81,399 – 81,617` plus a term chip (`2025/1`) and `+n` when more terms exist; `—` when none.
   `title` carries every term, so hovering needs no click.
3. Per-row **"döküm"** button (`aria-expanded`) when history exists: expands a sub-row
   (`<td colspan="7">`) with a compact table — dönem · eşleşme · kontenjan · yerleşen · taban ·
   tavan · boş — one line per past term. Expanded codes live in `state.expanded` (a `Set`) so a
   re-render (filter change) restores the same open rows.
4. Copy rule: the column never claims a score for a cadre that closed empty; empty past terms read
   "boş kaldı".

## 4. Honesty rules

* Group matches are labelled; the UI never presents a group match as the same cadre.
* No score is invented: only published `minPuan`/`maxPuan` appear, and `tavan` is never shown
  without its `taban`.
* The prediction column and its σ stay untouched — this feature is history, not forecast.
* The existing "geçen dönem boş kalanlar" checkbox keeps its meaning (current round's `bos`).

## 5. Tests and verification

| Layer | Assertion |
|---|---|
| Unit (`tests/past-terms.test.mjs`) | lisans: 321 rows matched by code against 2025/1, 200 rows group-matched against 2025/2, 459 rows with at least one filled past term; every entry has `tavan ≥ taban` when filled, an unfilled term carries no score, at most 3 terms newest-first, scores at 3 decimals |
| Build | `dist/data/<level>.json` gains `gecmis`; payload growth measured at +16.7 / +19.8 / +15.1 % (207 → 358 KB raw, 57 KB gzipped for lisans) |
| Browser (`web/smoke.mjs`) | checkbox exists and is off by default; ticking it shrinks the list (555 → 459 at lisans); a row renders a `taban – tavan` pair with a term chip; “döküm” opens exactly one sub-row with aria-expanded, closes on second click; unticking restores 555 |
| Full gate | `npm run gate` — unit + data gates + build + browser, all green |

## 6. Rollback

The change is additive: drop the `gecmis` field and the checkbox. No committed snapshot under
`data/rounds/` is touched, so `npm run parse|guide|gate|backtest|predict` stay byte-identical.

## 7. Out of scope

Charting the score history, cross-level history, alerts on new terms, and any per-candidate data.
