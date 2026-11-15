# Multi-source intake — detailed plan

Status: **draft for approval** · written 2026-11-14 · scope: extend Tercih Pusulası beyond ÖSYM
central placement (Sağlık Bakanlığı appointments + other public-sector recruitment channels).
Nothing in this document is implemented yet. Every "verified" line below was executed on
2026-11-14 on this machine; artefacts are in `.tmp/` (gitignored).

Related: `plani.md` (MVP history), `RUNBOOK.md` (term operations), `README.md` § Limits.

---

## 0. Why: measured coverage gap

Field report 2026-11-14: a nurse searched for "hemşire" and got an empty screen. Measured, not guessed:

| round | HEMŞİRE lise | HEMŞİRE önlisans | HEMŞİRE lisans | EBE lisans | source of truth |
|---|---|---|---|---|---|
| 2025/1 | 2 | 0 | 7 | 0 | `pdftotext -table -enc UTF-8` over `data/raw/*/guide/tablo*.pdf` |
| 2025/2 | 2 | 0 | 8 | 1 (Afyonkarahisar) | same |
| 2026/1 | **0** | 0 | **1** (Eskişehir Osmangazi, 2 kontenjan, taban 77,466 → tahmin 77,242 σ 7,16) | **0** | same |

Parsed rows equal the PDF counts, so our pipeline is faithful — the gap is **scope**, not data
quality. Nursing and midwifery hiring in Turkey mostly runs outside ÖSYM central placement:
notary-lottery appointments (4924 / 1219 additional article), 4/B contracted staff via Kariyer
Kapısı, and institutional announcements in the Official Gazette. A tool that only reads ÖSYM
Tablo-1/2/3 will keep showing an empty screen to that user.

The product question is therefore not "fix the search" (Phase 0 does that) but **"do we cover the
channels where these vacancies actually exist, and can we say honestly what we cannot predict?"**

---

## 1. Source inventory (recon 2026-11-14)

| # | Source | What it publishes | Machine-readability (evidence) | Cadence | Etiquette / legal | Tier | Verdict |
|---|---|---|---|---|---|---|---|
| S1 | **Resmî Gazete — ilanlar** (`resmigazete.gov.tr`) | Every public personnel recruitment announcement (4/B, sürekli işçi, 2547 academic). Legally binding publication channel. | Verified: front page links daily section `…/ilanlar/eskiilanlar/2026/11/20261114-4.htm`; that page lists relative PDFs (`20261114-4-1.pdf`, 16 PDFs in one section that day). Sample `ilanlar/eskiilanlar/2026/09/20260914-4-1.pdf` (123 476 B) → `pdftotext -table -enc UTF-8` → 662 lines, contains "53 adet personel alınacaktır", "KPSSP3 … asgari 70", "KPSSP93 … asgari 60", per-position requirement blocks. | daily (weekdays) | `robots.txt` contains only `Noindex:` entries, no `Disallow` → fetching allowed; PDFs are public works of the state | **T1** | **Build first.** Same PDF→text→cell-parse mechanism we already have. |
| S2 | **Sağlık Bakanlığı appointment pages** (`erisilebilir.saglik.gov.tr`, il sağlık müdürlükleri, `dosyasb.saglik.gov.tr/Eklenti/<id>/0/<slug>`) | Lottery rounds: announcement PDF, **münhal (vacant) positions XLSX**, result XLSX, notary-approved results PDF. | Verified: `TR-118266` page → attachments; `…55191/0/…munhal-webxlsx.xlsx` (78 660 B) = **2 179 rows**, header `İL ADI · UNVAN · BRANŞ · BİRİM ADI · MÜNHAL SAYISI · AÇIKLAMA`. Result file `…55423/0/sonucxlsx.xlsx` (89 844 B) header includes **`Ad Soyad`** → personal data. | ~twice a year nationally + per-province rounds | no `robots.txt` served (404); files are official announcements; **result lists contain named individuals** | **T1** | **Second source.** Münhal XLSX is exactly our cadre-index shape. Result XLSX → aggregate only, never store names. |
| S3 | **ilan.gov.tr** (Resmî İlan Portalı) | Daily official announcements incl. personnel recruitment category. | Category listing page returned only 7 966 B (JS shell); `robots.txt` allows crawling and publishes 4 sitemaps (`/sitemap/daily-ads.xml`, `categories.xml`, …) | daily | explicit allow + sitemaps | **T2** | Use as **cross-check / dedup witness**, not primary parse (needs JS or sitemap walking — spike first). |
| S4 | **Kariyer Kapısı** (`kariyerkapisi.gov.tr/isealim`) | Where most institutional applications are actually filed; announcement detail incl. requirement table. | `robots.txt` empty; `/isealim` = 18 791 B jQuery shell; data endpoints **not verified**. Application flow sits behind e-Devlet. | continuous | ToS unverified; e-Devlet walls must not be bypassed | **T3 pending spike** | Only if a public read-only endpoint exists; otherwise deep-link only. |
| S5 | `kamuilan.sbb.gov.tr` (legacy DPB/SBB list) | Institution + headcount + window list. | 161 595 B ASP.NET page with `aspNetHidden` postback fields → fragile pagination | daily | government page, no robots | T3 | **Skip.** Overlaps S1 at higher fragility. |
| S6 | **İŞKUR** (`iskur.gov.tr`) | Public worker (sürekli işçi) recruitment by notary lottery. | `robots.txt` request **rejected by WAF** ("Request Rejected") | daily | blocking robots/WAF → do not fight it | — | **Out of scope** unless an official bulk/RSS channel appears. |
| S7 | MEB contracted-teacher appointments | KPSS + interview cycles, big volumes, own preference engine. | not probed in this recon | ~twice a year | official | T3 | Later; different user segment. |
| S8 | Universities, 2547 academic (ALES/YDS) | Lecturer / research assistant announcements — the shape in the friend's screenshot. | published in S1 (RG) → covered by S1 parser with an exam-type facet | weekly | same as S1 | T1 via S1 | Covered by S1 with an `exam` facet (ALES/YDS/TYT). |
| A1 | Aggregators / news (kamukadro, atanalim, memurmaas, kadroatlasi, kamusondakika, Telegram channels) | Curated lists, requirement matrices. | HTML, unstable, some paywalled | daily | copyright + instability | **cross-check only** | Cite in `veri-kaynaklari.html`; never ingest. |
| A2 | kpssden.com (CC BY 4.0) | ÖSYM-derived dataset | already used as gate D cross-check | per term | CC BY 4.0, attribution kept | cross-check | Keep as-is. |

---

## 2. Scope decisions needed before code (blocking)

| ID | Question | Default if you say nothing |
|---|---|---|
| D1 | Which sources ship in v1 of this extension? | **S1 + S2 + S3 witness + a Kariyer Kapısı endpoint spike** (decided 2026-11-14) |
| D1b | Scheduler | **GitHub Actions cron**, output as a PR with the gate report (decided 2026-11-14) |
| D1c | Preference lists | **Two separate lists**: the ÖSYM 30-slot list stays as-is, institutional/kura applications get their own list (decided 2026-11-14) |
| D2 | Do we include non-KPSS channels (ALES/YDS academic, TYT-based, sürekli işçi)? | Show them as announcements with eligibility, **no score prediction** |
| D3 | Information architecture: separate `/ilanlar/` island, or merge into the existing table? | **Separate island** + one shared folded search; existing `/uygulama.html` untouched || D4 | Where does the scheduled intake run? | GitHub Actions cron (repo-local, no secrets); if output must stay private, move to the Mint node (serverPC) systemd timer + rsync |
| D5 | Do we store raw PDFs/XLSX in git? | **No** — normalised JSON committed, raw kept as CI artefact 30 days |
| D6 | Licence for the code | unchanged decision (still "not chosen"), but a public licence becomes urgent once we publish scraped datasets |

---

## 3. Domain model extension

Existing (unchanged): `CadreRow { kod, kurum, il, tes, unvan, knt, nit[], taban, bos, tahmin }`,
round-scoped under `data/rounds/<term>/`.

New, source-agnostic entities (proposed file `pipeline/lib/schema.mjs`):

```
Source          { id, name, url, kind: gazette|ministry|portal|agency, fetchedAt }
Announcement    { id = <sourceId>:<nativeId>, sourceId, issuer, title, publishedAt,
                  applyFrom, applyTo, channelUrl, kind: central|apply|kura|mülakat,
                  artefacts: [{ url, sha256, bytes, mediaType }] }
Vacancy         { announcementId, institution, unit, il, ilce?, unvan, branch?,
                  level: lisans|onlisans|ortaogretim, count,
                  examTypes: [KPSS_P3|KPSS_P93|KPSS_P94|TYT|ALES|YDS|NONE],
                  minScores: { exam: minScore }, requirementText, requirementCodes[] }
Requirement     { rawText, facets: { level, programmeCodes[], certificate?, licence?,
                                    ageMax?, gender?, other[] }, resolved: bool }
OutcomeAggregate{ sourceId, period, il, unvan, level, quota, placed, empty,
                  scoreMin?, scoreMax?, n }     # no person-level fields, by construction
```

Rules:

* **Identity.** Row identity is `(sourceId, nativeId)`. Cross-source matching (same announcement on
  RG + ministry + portal) uses a soft key `issuer ∩ unvan ∩ il ∩ count ∩ window`; the winning record
  keeps a `provenance[]` list, never merges silently.
* **Vocabulary.** `unvan` strings differ per channel (`HEMŞİRE` vs `HEMŞİRE (SAĞLIK …)`,
  `EBE` vs `EBELİK` position text). Add `data/reference/unvan-aliases.json` (curated, reviewable) +
  the same Turkish-folded matcher from Phase 0 as the join key. Unmapped values surface as-is and are
  counted in a gate — never dropped.
* **Nothing is skipped silently.** This is the existing "kontrol et" principle extended: unresolved
  requirement text is flagged, and the flag rate is published per source.
* **Backward compatibility.** `/data/<level>.json` contract stays byte-compatible; new island reads
  `/data/ilanlar/*.json`.

---

## 4. Pipeline architecture

```
pipeline/sources/
  rg.mjs          discover(since) → announcement refs; fetch PDF; parse
  saglik.mjs      discover kura/münhal pages → artefact refs; fetch XLSX/PDF; parse
  ilangovtr.mjs   sitemap walk → cross-check witness (announcement existence + window)
  index.mjs       source registry (id, entrypoint, schedule, retention)
pipeline/intake.mjs   orchestrator: fetch → hash → parse → gate → snapshot
pipeline/lib/xlsx.mjs dependency-free xlsx reader (prototype: .tmp/xlsx-peek.mjs, works on both
                      real workbooks; ~40 lines, no npm)
```

Adapter contract (all sources implement it — mirrors how `parse-guide.mjs` exports pure functions):

```
discover({ since, http })      -> [{ ref, publishedAt, hints }]
fetch(ref, http)               -> { bytes, sha256, mediaType }
parse(artefact)                -> { announcements[], vacancies[], rejectedLines[], stats }
```

Snapshot layout (immutable, mirrors `data/rounds/`):

```
data/intake/<sourceId>/<YYYY-MM-DD>/
   manifest.json     refs, sha256, bytes, parse stats, gate report
   normalized.json   announcements + vacancies (committed, small)
data/intake/index.json          last-seen native ids per source (incremental)
```

Retention: raw PDFs/XLSX stay in the runner workspace / CI artefact (30 days) and are gitignored.
Size estimate: RG ~20–80 PDFs/day × ~150 KB ≈ 3–12 MB/day of raw (never committed); normalised
JSON ≈ 5–40 KB/day (committed) → a year of announcements stays in the low MB range.

Gates (named G1…G7, same philosophy as A–F in `pipeline/gates.mjs`; `npm run gate` fails the build):

| Gate | Check | Fail action |
|---|---|---|
| G1 | Declared total vs Σ count (announcement says "53 adet" → Σ 53) | fail that announcement, keep others |
| G2 | Schema/enum validity (level, exam code, il in 81-province list, dates) | fail row, log `rejectedLines` |
| G3 | Date sanity (`applyFrom ≤ applyTo`, publication within ±7 d of run) | warn / fail |
| G4 | Requirement-text resolution ≥ 80 % | warn, publish the rate |
| G5 | unvan+il coverage ≥ 99 % of vacancy rows | **block publish** (like F) |
| G6 | Cross-source existence (S1 vs S3): missing announcement → warn, extra → warn | warn |
| G7 | **PII tripwire**: any `Ad Soyad`-shaped column, `\b\d{11}\b` (TCKN), birth-date column | **hard fail**, nothing written |

Scheduling (D4 default): GitHub Actions cron `0 6 * * 1-6` for S1, `0 7 * * 6` for S2; the job opens
a PR with the normalised diff and the gate report, so a bad parse never reaches `dist/` without a
human. Outage policy: keep the last snapshot and print **"veri şu tarihe kadar güncel"** on the page;
never silently drop a source.

---

## 5. Prediction semantics per channel (the honesty part)

| Channel | Score prediction? | What we show | Data needed |
|---|---|---|---|
| ÖSYM central (today) | yes — 3 anchors + σ, published error | as now | unchanged |
| Institutional 4/B ranked by KPSS | **only once we own the history** — build `OutcomeAggregate` from published result lists; show cell only when n ≥ 20 for (unvan, level, il), publish n and σ | eligibility first, score later | result lists from institutions / RG / S2 |
| Notary lottery (Sağlık Bakanlığı 4924 / 1219) | **no** — selection is a lottery | münhal inventory (il, unvan, unit, count), kura calendar, application window, "yazılabilir misin" check | S2 münhal XLSX |
| Interview-based (mülakat) | **no** | eligibility + timeline | S1 |

Hard rule: every number cell carries `source` and `n`; empty cells carry a **reason string**
("2026/1'de bu unvanda kadro yok · 2025/2'de 1 kadro vardı · kura ile alım, puan tahmini yapılmaz").
That is the Phase-0 empty-state work extended to the new island.

---

## 6. Product surface

* `/ilanlar/` — announcement list with source chips, application-window countdown, folded search
  shared with the existing app, and a source/level/il facet set.
* `/ilanlar/unvan-<slug>.html` — per-title page (reuses the existing cadre-index generator in
  `web/build.mjs`): how many vacancies, which institutions, which window, is it score- or
  lottery-based.
* Eligibility panel: reuse `pipeline/eligibility.mjs` idea but parse requirement **text** (RG blocks
  are prose, not nitelik codes) → facets + "kontrol et" chips for certificates/licences/age.
* Methodology: one section per source with its own measured error or an explicit "we do not predict".
* `veri-kaynaklari.html` and README Limits/Non-goals updated (README stays bilingual).
* SEO: sitemap grows; `tanitim.html` FAQ gets "Sağlık Bakanlığı alımları burada neden farklı?"
* Desktop app: `dist.zip` grows → re-run `npm run desktop:build && npm run desktop:check`; if the
  budget breaks, ship the island web-only first and gate the exe behind `TP_SOURCES`.

---

## 7. Legal, KVKK and crawling etiquette (non-negotiable rules)

1. **Official channels first**; aggregators are cited, never ingested.
2. `robots.txt` respected: S1 (no Disallow) and S3 (explicit allow) are usable; **S6 İŞKUR is
   blocked → out of scope**; S4 needs a ToS review before any request beyond a spike.
3. **KVKK: aggregate, never store people.** No names, no TCKN, no birth dates, no application
   numbers. G7 hard-fails the pipeline if such a column appears (verified risk: `sonuc.xlsx` has
   `Ad Soyad`).
4. Politeness: 1 request/s, conditional GET (ETag/Last-Modified cache in `lib/http.mjs`), honest UA
   with a contact address, retry budget, no parallel hammering, no captcha/2FA/login bypass.
5. Attribution per source; keep the kpssden CC BY 4.0 line.
6. Before publishing scraped datasets outside the app, pick a code/data licence (D6).

---

## 8. Milestones, acceptance, verification

| Phase | Work | Files | Acceptance criterion | Verification command | Est. |
|---|---|---|---|---|---|
| **0 · search honesty** | Turkish-folded matcher in the search box and the cadre index (`hemsire`→HEMŞİRE, `muhendis`→211 rows), programme picker rebuilt (the old `p.a[0]` grouping scattered 1 269 programmes into single-letter optgroups and made HEMŞİRELİK unfindable), searchable programme box, empty-state diagnosis from `/data/search-hints.json` (other levels + previous terms + one-click switches) | `web/assets/fold.js`, `web/assets/app.js`, `web/assets/dizin.js`, `pipeline/lib/search-hints.mjs`, `web/build.mjs`, `tests/fold.test.mjs`, `tests/search-hints.test.mjs`, `web/smoke.mjs` | smoke: `muhendis` = `mühendis` = 211, `hemsire` = 1 at lisans, `saglik` > 0 at ön lisans, ortaöğretim `hemşire` shows the diagnosis with “2025/2: lisans 8” and a switch button, programme search finds HEMŞİRELİK (3204) | `npm test && npm run build && npm run smoke` | **DONE 2026-11-14** (45 unit · 44 browser · build green) |
| **1 · RG spike** | `pipeline/sources/rg.mjs` + PDF parser for 4/B announcements; 30-day backfill; hand-check 20 announcements | `pipeline/sources/rg.mjs`, `pipeline/lib/parse-announcement.mjs`, `tests/announcement.test.mjs` | ≥ 90 % of {unvan, count, level, exam min score, window} correct on 20 hand-checked ilans; G1/G2/G7 pass | `node pipeline/intake.mjs --source=rg --since=2026-10-15 && npm test` | 1 day |
| **2 · RG in production** | snapshot dir, gates G1–G6, `/ilanlar/` list + per-announcement pages, unvan alias file, cron + PR flow | `web/build.mjs`, `pipeline/intake.mjs`, `pipeline/gates.mjs`, `.github/workflows/intake.yml` | site shows every personnel announcement published in the last 7 days with window and eligibility facets; gate report published on the page | `npm run gate && npm run smoke` | 1–2 weeks |
| **3 · Sağlık Bakanlığı** | `sources/saglik.mjs`, XLSX reader in `pipeline/lib/`, münhal inventory pages (il × unvan), kura calendar, G7 wired | `pipeline/lib/xlsx.mjs`, `pipeline/sources/saglik.mjs`, `web/build.mjs` | for `HEMŞİRE` and `EBE`: the page answers "kaç münhal kadro, hangi ilde, hangi birimde, kura ne zaman"; zero person-level fields in any committed file | `node pipeline/intake.mjs --source=saglik && npm run gate && grep -RIn "Ad Soyad" data/ tests/` returns nothing | 1–2 weeks |
| **3a · ÖSYM kurum dönemleri (done 2026-11-15)** | Reuse the existing results parser on non-central ÖSYM rounds: `channel` in the manifest/meta, same-channel history in the app, `pipeline/lib/kurum-summary.mjs` + `/kurum-alimlari.html` | `pipeline/run.mjs`, `pipeline/parse-results.mjs`, `pipeline/lib/kurum-summary.mjs`, `web/build.mjs`, `tests/kurum-summary.test.mjs` | Sağlık Bakanlığı 2025/5 + 2025/4 ingested: HEMŞİRE lisans 12 226 kadro, taban 73,880 / tavan 95,253, 81 il; totals equal the official summaries; EBE 2 085 kadro | `npm run gate` (54 unit, 63 browser) | **done** |
| **4 · Cross-check + dedup** | S3 witness, provenance list, duplicate UI | `pipeline/sources/ilangovtr.mjs` | same announcement seen once with ≥ 2 provenance links; G6 report clean for 30 days | `node pipeline/intake.mjs --all && npm run gate` | 1 week |
| **5 · Outcome archive** | aggregate institutional result lists → `OutcomeAggregate`; per-source error table; enable score cells at n ≥ 20 | `pipeline/aggregate-outcomes.mjs`, `pipeline/predict.mjs` | methodology page shows n, σ, hit-rate per source; no score cell without n | `node pipeline/backtest.mjs && npm run gate` | 2 weeks |
| **6 · Optional channels** | Kariyer Kapısı (if ToS allows), MEB, üniversite 2547 refinement, İŞKUR replacement channel | — | decided in review after Phase 3 metrics | — | TBD |

Dependency order: 0 → 1 → 2 → 3 → 4 → 5. Phase 3 does not depend on Phase 2 UI being finished.

---

## 9. Risks

| Risk | Evidence / why | Mitigation |
|---|---|---|
| RG layout drift (PDF cell wrapping) | our ÖSYM guide parser already fights wrapped cells (`attachWrappedPrefixes`) | reuse the wrap-reattach code; G1 arithmetic gate; keep `rejectedLines` |
| Repo bloat from raw documents | 3–12 MB/day raw | D5: raw never committed, normalised only |
| Requirement text is prose, not codes | verified in `20260914-4-1.pdf` | facet parser + "kontrol et" flag + published resolution rate (G4) |
| Unvan vocabulary explosion | 66 distinct unvan today across 3 terms; channels add per-institution phrasing | alias file + folded matcher + gate on unmapped rate |
| Kura has no closing score | verified: notary lottery lists | explicit "no prediction" state; publish inventory + calendar instead |
| KVKK breach | `sonuc.xlsx` has `Ad Soyad` | G7 hard fail, aggregation-only schema, no artefact retention for result files |
| Kariyer Kapısı anti-bot / ToS | unverified, e-Devlet walls | spike behind a flag; default = deep link only |
| Two "truths" (RG vs ministry) | same vacancy, different counts | never merge silently; provenance + G6 diff report |
| Scope creep into job-board product | aggregator feature set | limits section + Phase 6 gated by a review |

---

## 10. What is *not* in this plan

Accounts, saved profiles, alerts/push notifications, mobile apps, application filing, any write-access
to any official system, crowd/pool simulation, paid data, and any channel that needs a login.

---

## 11. Open questions for you

1. D1 confirmation — S1+S2 for the first release, or is Sağlık Bakanlığı optional for now?
2. D4 — GitHub Actions or the Mint node (serverPC) for the cron?
3. D6 — do we finally pick a code/data licence?
4. Should the new island share the 30-slot preference list with ÖSYM rows, or keep two lists
   (ÖSYM preferences vs institutional applications)? Default: **two lists**, because the two channels
   are not mutually exclusive but have different rules.
