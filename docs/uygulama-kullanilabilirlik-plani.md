# Preference page usability plan (`/uygulama.html`)

Status: **plan only — nothing implemented** · written 2026-11-15 · owner: product
Evidence base: the 2026-11-15 screenshot (EBELİK selected, "geçen dönem boş kalanlar" ticked)
plus measurements from `npm run test:uygulama` (54 checks) and the data in `dist/data/*.json`.

## 1. What the screenshot proves

The page is not broken — it is **legible only to someone who already knows the domain**.

| Observation | Why a first-time user gets lost |
|---|---|
| EBELİK selected, "geçen dönem boş kalanlar" ticked → 1 row: **BİLGİSAYAR İŞLETMENİ** (YÖK, Ankara) | That cadre requires an *İspanyol Dili ve Edebiyatı* degree (nitelik 4038). An ebelik graduate cannot apply. Nothing on the row says so; the only hint is a grey `KONTROL ET` chip. |
| "sadece yazabileceklerim" is **unchecked** in the screenshot | The list silently shows ineligible cadres. The user reads it as "these are my options". |
| Column headers: `GEÇEN TABAN`, `ÖNCEKİ DÖNEMLER`, `TAHMİN`, `DURUM` | Four words with domain meaning (last round's closing score / older rounds' min–max / model estimate / band). A newcomer reads none of them. |
| Chips: `TAHMİN YOK`, `BOŞ KALDI`, `KONTROL ET` | Three different kinds of judgement (model unavailable / last round unplaced / manual check needed) rendered identically. |
| "1 nitelik kodu bu programla eşleşiyor." | "Nitelik kodu" is ÖSYM jargon; and the sentence explains a filter, not the user's task. |
| Right panel: "Liste boş. Tablodan 'ekle' ile tercih ekleyin (en fazla 30)." | Instructions after the fact; the user has to guess the order of operations. |
| "TAHMİN" cell 81,199 vs "GEÇEN TABAN" — | No visual link between *this* number and *my* score, and no explanation of the ±7 band already used in the code. |

## 2. Principles

1. **A row that cannot be written must never look like a row that can.** Distinguish "yazabilirsin" from "şartı oku" from "yazamazsın" by more than a grey chip.
2. **Name the task, not the data.** Labels follow the user's questions ("Geçen dönem kaçla kapandı?", "Yazabilir miyim?") instead of schema names.
3. **One obvious next step on every screen state** — empty table, empty list, OK state.
4. **Show the reason, not just the verdict.** Every exclusion or empty cell carries a one-line cause.
5. **Progressive disclosure.** Default view answers "what can I write?"; the analytical columns stay one click away.
6. Keep the existing honesty rules: no invented scores, group matches labelled, kura channels never predicted.

## 3. Phases

### Phase A — guidance and defaults (highest value, lowest risk)

| Change | Detail |
|---|---|
| Step header | Replace the lede with three numbered steps that light up as they are completed: **1 programını seç · 2 puanını gir · 3 yazabileceğin kadroları işaretle**. Step 1/2 done when a programme and a score exist. |
| Default "yazabileceklerim" | Tick `sadece yazabileceklerim` **when a programme is selected**, and show a persistent banner when it is off: "Kapalı: yazamayacağın kadrolar da listede." |
| Row-level eligibility | Add a left status column: `yazabilirsin` (green), `şartı oku` (amber, certificate/unknown code), `yazamazsın` (muted + reason). Rows that are ineligible are visually recessed and say why: "İspanyol Dili ve Edebiyatı mezuniyeti istiyor (kod 4038)". |
| Explain the chips | One-line legend under the table: `TAHMİN YOK` = model bu kadro için tahmin üretmedi · `BOŞ KALDI` = geçen dönem kimse yerleşmedi · `KONTROL ET` = sertifika/özel şart var. |
| Column language | `GEÇEN TABAN` → **Geçen dönem kaçla kapandı**; `ÖNCEKİ DÖNEMLER` → **Daha eski dönemler**; `TAHMİN` → **Bu dönem tahmini (±x)**. `title` attributes keep the precise wording. |
| Empty states | Table: "Bu filtrelerle kadro yok" + the two most likely fixes as buttons (filtreleri temizle / düzeyi değiştir). List: "Henüz tercih eklemedin. Tablodaki **ekle** ile başla." |

### Phase B — the right panel becomes a checklist, not a form footer

* Show a 3-line summary of the list: tercih sayısı, en yüksek/en düşük tahmin, ve "puanın bu listede kaç satırın altında/üstünde".
* Replace the bare `%99` with a sentence: "Puanın 82,457 · listedeki 3 satırın tahmini bunun altında → garanti bölgesi".
* Keep `paylaşılabilir bağlantı` and `yazdır`, but move them under a "Listeyi dışa aktar" disclosure.

### Phase C — explain the score columns in place

* Hover/tap on `TAHMİN`: a small popover — "Üç çapa (aynı kadro kodu, aynı kurum+unvan, il ortancası) ve ölçülen σ = 7,16; geçen 3 dönemde %80 aralığın içinde kaldı."
* Hover on `ÖNCEKİ DÖNEMLER`: the existing `döküm` drill-down stays the canonical view.
* A single "Bu tablo nasıl okunur?" link to `/metodoloji.html`.

### Phase D — mobile and keyboard polish

* On < 640px, the row becomes a card: unvan + kurum on line 1, `yazabilirsin` badge and score on line 2, actions on line 3 (no horizontal table scroll).
* Focus order = visual order; the combobox already has correct ARIA; add `aria-describedby` from the score input to the band explanation.

## 4. Acceptance criteria

| Phase | Criterion | Verified by |
|---|---|---|
| A | With EBELİK + "boş kalanlar" the BİLGİSAYAR İŞLETMENİ row is visibly marked `yazamazsın` with the reason "İspanyol Dili ve Edebiyatı (4038)"; with "sadece yazabileceklerim" on it disappears | browser test (new checks in `npm run test:uygulama`) |
| A | A first-time user can name the 3 steps from the page alone (step header present, steps reflect state) | test asserts step states |
| B | Panel shows count + sentence with the user's score; no bare percentage | test asserts sentence pattern |
| C | `TAHMİN` has a popover with σ and the anchor list; `metodoloji` link reachable from the table | test asserts popover text |
| D | 390px: no table scroll, card layout, all actions reachable | layout checks at 390/768 |
| all | Honesty rules intact: no score invented, group matches labelled, kura channels untouched | existing unit tests + `npm run gate` |

## 5. Risks

* **Colour-only encoding** would fail accessibility: every status gets text + icon + colour.
* Marking rows "yazamazsın" must use the same `inProgramme` logic as the filter, otherwise the page contradicts itself — implement one function and reuse it.
* More copy risks clutter on mobile: cap the legend at three items and collapse it into a `<details>` on small screens.
* Score wording ("geçen dönem kaçla kapandı") must not imply a promise for this round; keep the existing σ text.

## 6. Open questions

1. Do we rename `TAHMİN` to "beklenen taban" (closer to user language) or keep "tahmin" and explain it?
2. Should ineligible rows be hidden by default (i.e. `sadece yazabileceklerim` forced on when a programme is chosen)?
3. Is a compact onboarding (3-step overlay on first visit, dismissed and stored) wanted, or is the static step header enough?
4. Priority: A only now, or A+B together?
