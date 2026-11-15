// Tercih Pusulası — uygulama adası. Çerçeve yok, bağımlılık yok.
// Veri /data/<seviye>.json içinde; 555 satırlık en büyük liste tarayıcıda rahat.
import { foldTr } from './fold.js';

// Geçmiş dönem dökümü (build: pipeline/lib/past-terms.mjs). Aynı kural burada da geçerli:
// en az bir dönemde kontenjanı dolmuş satır "dolan" sayılır.
const filledInPast = (entries) => Array.isArray(entries) && entries.some((entry) => (entry.yer ?? 0) > 0);

const MAX_TERCIH = 30;
// 2025/2 lisans 990 satır: tavan tüm dönemleri kapsar, hiçbir satır gizlenmez
const MAX_ROWS = 1200;
const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];

// innerHTML'e giren her değer kaçırılır: ?l= bağlantısı gibi dış girdiler
// satır verisiyle eşleşmezse ham metin olarak DOM'a yazılmamalı.
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Durum dili katalogdan: LED (CSS ::before) + etiket + satırdaki eşik değeri.
const BANDS = {
  garanti: { label: 'garanti' },
  hedef: { label: 'hedef' },
  riskli: { label: 'riskli' },
  uzak: { label: 'uzak' },
  bilinmiyor: { label: 'tahmin yok' },
};

const state = {
  level: 'lisans',
  puan: null,
  programKod: null,
  programSearch: '',
  hints: null,
  il: '',
  unvan: '',
  kurum: '',
  onlyWritable: true,
  onlyEmpty: false,
  onlyFilled: false,
  expanded: new Set(),
  query: '',
  list: [],
  data: null,
  writable: new Set(),
  manual: new Map(),
};

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

/** Lojistik yaklaşımla tek satırın yerleşme olasılığı. */
function rowProbability(score, prediction, sigma) {
  if (!prediction || prediction.puan === null || score === null) return null;
  const z = (score - prediction.puan) / sigma;
  return 1 / (1 + Math.exp(-1.702 * z));
}

function bandOf(score, prediction, sigma) {
  if (!prediction || prediction.puan === null || score === null) return 'bilinmiyor';
  if (score >= prediction.puan + sigma) return 'garanti';
  if (score >= prediction.puan) return 'hedef';
  if (score >= prediction.puan - sigma) return 'riskli';
  return 'uzak';
}

function listProbability() {
  const sigma = state.data?.sigma ?? 6;
  let remaining = 1;
  for (const kod of state.list) {
    const row = state.data.rows.find((r) => r.kod === kod);
    const p = rowProbability(state.puan, row?.tahmin, sigma);
    if (p !== null) remaining *= 1 - p;
  }
  return 1 - remaining;
}

function isWritable(row) {
  if (!state.programKod) return true;
  return row.nit.every((code) => {
    const entry = state.data.nitelik[code];
    if (!entry) return true; // unknown code: shown, but flagged
    if (entry.k === 'any_level') return true;
    if (entry.k === 'programmes') return state.writable.has(code);
    return true; // certificate / pointer: the candidate must verify
  });
}

function manualCodes(row) {
  return row.nit.filter((code) => {
    const entry = state.data.nitelik[code];
    return !entry || entry.k === 'certificate' || entry.k === 'pointer';
  });
}

// Kadro gerçekten bu programın alanında mı? `isWritable` bilinçli olarak gevşek (sertifika/şart
// satırlarını "kontrol et" diye gösterir); burada ise "alan" tanımı dar: kadronun nitelik
// kodlarından en az biri `programmes` tipinde ve seçili programı içeriyor olmalı.
function inProgramme(row) {
  if (!state.programKod) return true;
  return row.nit.some((code) => {
    const entry = state.data.nitelik[code];
    return entry?.k === 'programmes' && state.writable.has(code);
  });
}

function programmeRows() {
  return state.programKod ? state.data.rows.filter(inProgramme) : state.data.rows;
}

function filteredRows() {
  const sigma = state.data.sigma ?? 6;
  const needle = foldTr(state.query.trim());
  // "Geçmiş dönemde dolanlar" tek başına tüm alanları getiriyordu. Program seçiliyken bu filtre
  // adayın kendi alanına daralır: kadro, seçilen programın nitelik kodlarıyla yazılabilir olmalı.
  // (Bu yüzden "sadece yazabileceklerim" işaretli olmasa da program süzgeci uygulanır.)
  const scopeToProgramme = state.onlyFilled && Boolean(state.programKod);
  return state.data.rows.filter((row) => {
    if ((state.onlyWritable || scopeToProgramme) && !isWritable(row)) return false;
    if (scopeToProgramme && !inProgramme(row)) return false;
    if (state.onlyEmpty && !row.bos) return false;
    if (state.onlyFilled && !filledInPast(row.gecmis)) return false;
    if (state.il && row.il !== state.il) return false;
    if (state.unvan && row.unvan !== state.unvan) return false;
    if (state.kurum && row.kurum !== state.kurum) return false;
    if (needle) {
      const haystack = foldTr(`${row.kurum} ${row.unvan} ${row.il} ${row.kod}`);
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }).sort((a, b) => {
    const pa = a.tahmin?.puan ?? 101;
    const pb = b.tahmin?.puan ?? 101;
    return pa - pb || a.unvan.localeCompare(b.unvan, 'tr');
  });
}

function fmt(value) {
  return value === null || value === undefined ? '—' : value.toFixed(3).replace('.', ',');
}

const MATCH_LABEL = { kod: 'aynı kadro kodu', grup: 'aynı kurum/unvan' };
const pair = (entry) => (entry.taban === null || entry.taban === undefined ? 'boş kaldı' : `${fmt(entry.taban)}–${fmt(entry.tavan)}`);

// Geçmiş dönem hücresi: en yeni dönemin taban–tavan çifti + dönem etiketi.
// Tüm dönemler `title` içinde; tıklanabilir döküm satırı ayrı düğmede.
function historyCell(history) {
  if (!history?.length) return '<td class="num dim">—</td>';
  const latest = history[0];
  const title = history.map((entry) => `${entry.d} (${MATCH_LABEL[entry.es] ?? entry.es}): ${pair(entry)}`).join(' · ');
  const more = history.length > 1 ? ` <span class="more">+${history.length - 1}</span>` : '';
  return `<td class="num dim" title="${esc(title)}">${pair(latest)} <span class="term">${esc(latest.d)}</span>${more}</td>`;
}

function historyRow(row, history) {
  const cells = history
    .map(
      (entry) => `<tr><td>${esc(entry.d)}</td><td class="sub">${esc(MATCH_LABEL[entry.es] ?? entry.es)}</td>` +
        `<td class="num">${entry.knt ?? '—'}</td><td class="num">${entry.yer ?? 0}</td>` +
        `<td class="num">${fmt(entry.taban)}</td><td class="num">${fmt(entry.tavan)}</td>` +
        `<td class="num">${entry.knt === null || entry.knt === undefined ? '—' : (entry.knt - (entry.yer ?? 0))}</td></tr>`,
    )
    .join('');
  return `<tr class="histo"><td colspan="7">
    <table class="mini"><thead><tr><th>dönem</th><th>eşleşme</th><th class="num">kont.</th><th class="num">yerleşen</th><th class="num">taban</th><th class="num">tavan</th><th class="num">boş</th></tr></thead>
    <tbody>${cells}</tbody></table></td></tr>`;
}

function renderTable() {
  const sigma = state.data.sigma ?? 6;
  const rows = filteredRows();
  const body = $('#rows');
  const frag = document.createDocumentFragment();
  for (const row of rows.slice(0, MAX_ROWS)) {
    const tr = document.createElement('tr');
    const band = bandOf(state.puan, row.tahmin, sigma);
    const meta = BANDS[band];
    const manual = manualCodes(row);
    const inList = state.list.includes(row.kod);
    const history = row.gecmis ?? [];
    const open = state.expanded.has(row.kod) && history.length > 0;
    tr.innerHTML = `
      <td>
        <strong>${esc(row.unvan ?? '—')}</strong>
        <div class="sub">${esc(row.kurum ?? '—')} · ${esc(row.il ?? '—')}${row.tes ? ` / ${esc(row.tes)}` : ''}</div>
      </td>
      <td class="num">${row.knt ?? '—'}</td>
      <td class="num dim">${fmt(row.taban)}</td>
      ${historyCell(history)}
      <td class="num">${fmt(row.tahmin?.puan)}</td>
      <td><span class="chip ${band}" title="çapa: ${esc(row.tahmin?.source ?? 'yok')}">${meta.label}</span>
        ${row.bos ? '<span class="chip">boş kaldı</span>' : ''}
        ${manual.length ? '<span class="chip manual" title="Bu satırda sertifika/özel şart var">kontrol et</span>' : ''}
      </td>
      <td class="row-actions">
        <button class="ghost small" data-add="${row.kod}" ${inList || state.list.length >= MAX_TERCIH ? 'disabled' : ''}>${inList ? 'listede' : 'ekle'}</button>
        ${history.length ? `<button class="ghost small" data-histo="${row.kod}" aria-expanded="${open}" title="Geçmiş dönem dökümü">döküm</button>` : ''}
      </td>`;
    frag.append(tr);
    if (open) {
      const sub = document.createElement('tbody');
      sub.innerHTML = historyRow(row, history);
      frag.append(...sub.children);
    }
  }
  body.replaceChildren(frag);
  renderSteps();
  $('#count').textContent = `${rows.length} satır${rows.length > MAX_ROWS ? ` (ilk ${MAX_ROWS} gösteriliyor, filtreyi daraltın)` : ''}`;
  renderEmptyNote(rows);
}

function renderList() {
  const ul = $('#list');
  const sigma = state.data?.sigma ?? 6;
  if (!state.list.length) {
    ul.innerHTML = '<li class="empty">Liste boş. Tablodan “ekle” ile tercih ekleyin (en fazla 30).</li>';
  } else {
    ul.innerHTML = state.list.map((kod, index) => {
      const row = state.data.rows.find((r) => r.kod === kod);
      const band = bandOf(state.puan, row?.tahmin, sigma);
      return `<li>
        <span class="text">
          <strong>${esc(row?.unvan ?? kod)}</strong>
          <div class="sub">${esc(row?.kurum ?? '')} · ${esc(row?.il ?? '')} · taban ${fmt(row?.taban)}</div>
        </span>
        <span class="chip ${band}">${BANDS[band].label}</span>
        <span class="actions">
          <button class="ghost small" data-up="${index}" aria-label="Yukarı taşı" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="ghost small" data-down="${index}" aria-label="Aşağı taşı" ${index === state.list.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="ghost small" data-remove="${index}" aria-label="Listeden çıkar">×</button>
        </span>
      </li>`;
    }).join('');
  }
  const p = listProbability();
  const hasEstimate = state.list.length > 0 && state.puan !== null;
  $('#probabilityValue').textContent = hasEstimate ? `%${Math.round(p * 100)}` : '—';
  $('#probability').textContent = hasEstimate
    ? listSentence()
    : 'Puanını ve tercihlerini gir; listendeki her satır için tahmini tabanla karşılaştırıp yerleşme olasılığını gösterir.';
  $('#listMeta').textContent = `${state.list.length}/${MAX_TERCIH}`;
  save();
}

// Panelde çıplak yüzde yerine cümle: puanın liste içinde nerede durduğunu söyler.
function listSentence() {
  const rows = state.list.map((kod) => state.data.rows.find((row) => row.kod === kod)).filter(Boolean);
  if (state.puan === null || !rows.length) return '';
  const below = rows.filter((row) => row.tahmin?.puan !== null && row.tahmin?.puan !== undefined && row.tahmin.puan < state.puan).length;
  const known = rows.filter((row) => row.tahmin?.puan !== null && row.tahmin?.puan !== undefined).length;
  if (!known) return 'Listedeki satırlar için tahmin üretilmedi.';
  return `Puanın ${fmt(state.puan)} · listedeki ${known} tahminin ${below} tanesi puanının altında.`;
}

function save() {
  try {
    localStorage.setItem(`tp:list:${state.level}`, JSON.stringify(state.list));
  } catch {
    /* storage kapalı olabilir; liste yine de çalışır */
  }
}

function syncUrl() {
  const next = new URLSearchParams();
  if (state.level) next.set('seviye', state.level);
  if (state.puan !== null) next.set('puan', String(state.puan));
  if (state.programKod) next.set('program', String(state.programKod));
  if (state.il) next.set('il', state.il);
  if (state.unvan) next.set('unvan', state.unvan);
  if (state.list.length) next.set('l', state.list.join(','));
  history.replaceState(null, '', `?${next}`);
  const share = $('#share');
  if (share) share.value = `${location.origin}${location.pathname}?${next}`;
}

// Program seçici: tek dropdown, içinde arama.
// Eski hâli iki ayrı alandı (arama kutusu + select). Şimdi ARIA combobox: yazdıkça liste süzülür,
// ok tuşları gezer, Enter seçer, Esc kapatır; seçim state.programKod'da tutulur.
const COMBO_LIMIT = 60;

function programmeMatches(needle) {
  const all = state.data?.programmes ?? [];
  const key = foldTr(needle);
  return (key ? all.filter((p) => foldTr(p.a).includes(key)) : all).sort((a, b) => a.a.localeCompare(b.a, 'tr'));
}

function setComboOpen(open) {
  const input = $('#programSearch');
  const list = $('#programList');
  if (!input || !list) return;
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (!open) {
    state.comboActive = -1;
    input.removeAttribute('aria-activedescendant');
  }
}

function comboOpen() {
  const list = $('#programList');
  return Boolean(list) && !list.hidden;
}

/** Listeyi yazar; `open` verilirse odağı ilk eşleşmeye alır. */
function renderProgrammes({ open = false } = {}) {
  const list = $('#programList');
  if (!list) return;
  const matches = programmeMatches(state.programSearch);
  const shown = matches.slice(0, COMBO_LIMIT);
  const chosenKod = state.programKod ? String(state.programKod) : null;
  state.comboMatches = shown;
  list.innerHTML =
    `<li class="combo-note" role="presentation">${matches.length} program${matches.length > COMBO_LIMIT ? ` · ilk ${COMBO_LIMIT} gösteriliyor` : ''}</li>` +
    shown
      .map(
        (p, index) =>
          `<li role="option" id="program-option-${index}" data-kod="${p.k}" aria-selected="${String(p.k) === chosenKod}">${esc(p.a)}</li>`,
      )
      .join('');
  if (open) {
    setComboOpen(true);
    // "Seçili" satır varsa ondan başla, yoksa ilk eşleşmeden.
    const start = shown.findIndex((p) => String(p.k) === chosenKod);
    highlightCombo(start >= 0 ? start : 0);
  } else if (comboOpen()) {
    highlightCombo(state.comboActive ?? -1);
  }
}

function highlightCombo(index) {
  const list = $('#programList');
  const input = $('#programSearch');
  if (!list || !input) return;
  const options = [...list.querySelectorAll('[role="option"]')];
  if (!options.length) {
    state.comboActive = -1;
    input.removeAttribute('aria-activedescendant');
    return;
  }
  const next = Math.max(0, Math.min(index, options.length - 1));
  state.comboActive = next;
  for (const [i, option] of options.entries()) option.classList.toggle('active', i === next);
  const active = options[next];
  input.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
}

function chooseProgramme(kod) {
  const programme = state.data?.programmes.find((p) => String(p.k) === String(kod)) ?? null;
  state.programKod = programme ? programme.k : null;
  state.programSearch = programme ? programme.a : '';
  $('#programSearch').value = state.programSearch;
  setComboOpen(false);
  renderProgrammes();
  applyProgramme();
  fillSelects();
  renderTable();
  syncUrl();
}

const LEVEL_NAME = { lisans: 'lisans', onlisans: 'ön lisans', ortaogretim: 'lise' };
const periodLabel = (period) => (period === 'buDonem' ? state.data?.round ?? 'bu dönem' : period.replace('-', '/'));

// Arama boş döndüğünde tek tuşla tüm daraltıcıları gevşet: kullanıcı "çalışmıyor" derken
// çoğu zaman görünmez bir filtre (il/unvan/program) kesişimi kastedilir.
function clearFilters() {
  state.query = '';
  state.il = '';
  state.unvan = '';
  state.kurum = '';
  state.programKod = null;
  state.programSearch = '';
  $('#programSearch').value = '';
  setComboOpen(false);
  renderProgrammes();
  applyProgramme();
  fillSelects();
  state.onlyWritable = false;
  state.onlyEmpty = false;
  state.onlyFilled = false;
  $('#query').value = '';
  for (const id of ['#il', '#unvan', '#kurum']) $(id).value = '';
  $('#onlyWritable').checked = false;
  $('#onlyEmpty').checked = false;
  $('#onlyFilled').checked = false;
  renderTable();
}

async function ensureHints() {
  if (state.hints !== null) return state.hints;
  try {
    const res = await fetch('/data/search-hints.json');
    state.hints = res.ok ? await res.json() : {};
  } catch {
    state.hints = {};
  }
  return state.hints;
}

const bucketTotal = (bucket) =>
  Object.values(bucket?.counts ?? {}).reduce((sum, byLevel) => sum + Object.values(byLevel).reduce((s, n) => s + n, 0), 0);

const levelCountLine = (byLevel) =>
  LEVELS.filter((level) => byLevel?.[level]).map((level) => `${LEVEL_NAME[level]} ${byLevel[level]}`).join(' · ') || 'yok';

function activeFilterLine() {
  const parts = [];
  if (state.il) parts.push(`il: ${esc(state.il)}`);
  if (state.unvan) parts.push(`unvan: ${esc(state.unvan)}`);
  if (state.kurum) parts.push(`kurum: ${esc(state.kurum)}`);
  if (state.programKod) parts.push('program seçili');
  if (state.onlyWritable) parts.push('sadece yazabileceklerim');
  if (state.onlyEmpty) parts.push('boş kalanlar');
  if (state.onlyFilled) parts.push(state.programKod ? 'geçmiş dönemde dolanlar (program alanı)' : 'geçmiş dönemde dolanlar');
  return parts;
}

// Sessiz boş tablo yerine gerekçe: aranan unvan bu dönemde hiç mi açılmadı, başka düzeyde mi
// var, geçmiş dönemde kaç kadroydu. Yanıt /data/search-hints.json'dan gelir.
async function renderEmptyNote(rows) {
  const box = $('#emptyNote');
  if (!box) return;
  if (rows.length > 0) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const asked = state.query.trim();
  const levelAtStart = state.level;
  const lines = [`<p><button class="ghost small" type="button" data-clear-filters>filtreleri temizle</button></p>`];
  if (!asked) {
    const filters = activeFilterLine();
    lines.unshift(
      `<p>${filters.length ? `Filtrelerin kesişimi boş: ${filters.join(' · ')}.` : 'Bu düzeyde kayıtlı kadro yok.'}</p>`,
    );
    box.innerHTML = lines.join('');
    box.hidden = false;
    return;
  }
  const needle = foldTr(asked);
  const head =
    `<p><strong>“${esc(asked)}”</strong> ${LEVEL_NAME[levelAtStart]} düzeyinde satır bulamadı. ` +
    `Arama kurum, unvan, il ve kadro kodunu tarar; ş/ğ/ü/ö/ç/ı/İ fark etmez.</p>`;
  const programmeHits = (state.data?.programmes ?? [])
    .filter((p) => foldTr(p.a).includes(needle))
    .slice(0, 3)
    .map(
      (p) =>
        `<p>Mezuniyet programı eşleşmesi: <strong>${esc(p.a)}</strong> ` +
        `<button class="ghost small" type="button" data-program="${p.k}">programı seç</button></p>`,
    );
  const hints = await ensureHints();
  // Bu bekleyiş arasında kullanıcı filtre değiştirdiyse çıktı bayattır, yazmayın.
  if (state.query.trim() !== asked || state.level !== levelAtStart) return;
  const crossLines = [];
  for (const field of ['unvan', 'il']) {
    const entries = Object.entries(hints?.[field] ?? {})
      .filter(([key]) => key.includes(needle) || needle.includes(key))
      .sort((a, b) => bucketTotal(b[1]) - bucketTotal(a[1]))
      .slice(0, 2);
    for (const [, bucket] of entries) {
      const thisRound = bucket.counts?.buDonem ?? {};
      const switches = LEVELS.filter((level) => level !== levelAtStart && thisRound[level])
        .map(
          (level) =>
            `<button class="ghost small" type="button" data-switch-level="${level}">${LEVEL_NAME[level]} (${thisRound[level]})</button>`,
        )
        .join(' ');
      const history = Object.entries(bucket.counts ?? {})
        .filter(([period]) => period !== 'buDonem')
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 3)
        .map(([period, byLevel]) => `${periodLabel(period)}: ${levelCountLine(byLevel)}`)
        .join(' · ');
      crossLines.push(
        `<p><strong>${esc(bucket.label)}</strong> · ${state.data?.round ?? 'bu dönem'}: ${levelCountLine(thisRound)}` +
          (switches ? ` — ${switches}` : '') +
          (history ? `<br><span class="hint">geçmiş dönemler: ${history}</span>` : '') +
          `</p>`,
      );
    }
  }
  box.innerHTML = head + crossLines.join('') + programmeHits.join('') + lines[0];
  box.hidden = false;
}

function fillSelects() {
  // Ünvan/kurum/il seçenekleri mezuniyet programına göre değişir: HEMŞİRELİK seçilince listede
  // yalnız o alanın kadroları kalır. Seçili bir değer yeni listede yoksa sıfırlanır (sessiz boş tablo olmasın).
  const rows = programmeRows();
  const uniq = (field) => [...new Set(rows.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const fill = (id, values, field, placeholder) => {
    const select = $(id);
    if (state[field] && !values.includes(state[field])) state[field] = '';
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('');
    select.value = state[field];
  };
  fill('#il', uniq('il'), 'il', 'Tüm iller');
  fill('#unvan', uniq('unvan'), 'unvan', 'Tüm unvanlar');
  fill('#kurum', uniq('kurum'), 'kurum', 'Tüm kurumlar');
}

function applyProgramme() {
  state.writable = new Set();
  state.manual = new Map();
  if (state.programKod) {
    const codes = state.data.programNitelik[String(state.programKod)] ?? [];
    for (const code of codes) state.writable.add(code);
  }
  renderProgrammeNote();
}

// Not: seçili programın kaç nitelik koduyla eşleştiği + "dolanlar" filtresinin alanla sınırlı olduğu.
// 1-2-3 adımları: tamamlanan işaretlenir, sıradaki vurgulanır.
function renderSteps() {
  if (!document.getElementById('steps')) return;
  const done = [Boolean(state.programKod), state.puan !== null, state.list.length > 0];
  done.forEach((isDone, index) => {
    const step = document.getElementById(`step${index + 1}`);
    if (!step) return;
    step.classList.toggle('done', isDone);
    step.classList.toggle('next', done.slice(0, index).every(Boolean) && !isDone);
  });
}

function renderProgrammeNote() {
  const note = $('#programNote');
  if (!note) return;
  if (!state.programKod) {
    note.textContent = '';
    note.hidden = true;
    return;
  }
  const codes = state.data.programNitelik[String(state.programKod)] ?? [];
  const known = state.data.programmes.some((p) => p.k === state.programKod);
  const parts = [known ? `${codes.length} nitelik kodu bu programla eşleşiyor.` : 'Bu program kılavuzda bulunamadı.'];
  if (state.onlyFilled) parts.push('“geçmiş dönemde dolanlar” yalnız bu alanla sınırlı.');
  note.textContent = parts.join(' ');
  note.hidden = false;
}

async function loadLevel(level) {
  const res = await fetch(`/data/${level}.json`);
  if (!res.ok) throw new Error(`veri yüklenemedi: ${res.status}`);
  state.data = await res.json();
  state.level = level;
  try {
    const stored = JSON.parse(localStorage.getItem(`tp:list:${level}`) ?? '[]');
    const known = new Set(state.data.rows.map((row) => row.kod));
    state.list = Array.isArray(stored) ? stored.filter((kod) => known.has(kod)).slice(0, MAX_TERCIH) : [];
  } catch {
    state.list = [];
  }
  $('#round').textContent = state.data.round;
  if (state.programKod) {
    const chosen = state.data.programmes.find((p) => p.k === state.programKod);
    if (chosen) state.programSearch = chosen.a;
    $('#programSearch').value = state.programSearch;
  }
  renderProgrammes();
  applyProgramme();
  fillSelects();
  renderTable();
  renderList();
}

function bind() {
  // onclick yerine dinleyici: CSP inline handler'ları bloklar
  const share = document.getElementById('share');
  if (share) share.addEventListener('click', () => share.select());
  const filters = document.getElementById('filters');
  if (filters) filters.addEventListener('submit', (event) => event.preventDefault());
  const printButton = document.getElementById('print');
  if (printButton) printButton.addEventListener('click', () => window.print());
  $('#puan').addEventListener('input', (event) => {
    const value = Number(String(event.target.value).replace(',', '.'));
    state.puan = Number.isFinite(value) && value > 0 ? value : null;
    renderTable();
    renderList();
    syncUrl();
  });
  $('#level').addEventListener('change', (event) => loadLevel(event.target.value).catch(showError));
  for (const [id, field] of [['#il', 'il'], ['#unvan', 'unvan'], ['#kurum', 'kurum']]) {
    $(id).addEventListener('change', (event) => {
      state[field] = event.target.value;
      renderTable();
    });
  }
  $('#onlyWritable').addEventListener('change', (event) => {
    state.onlyWritable = event.target.checked;
    renderTable();
  });
  $('#onlyEmpty').addEventListener('change', (event) => {
    state.onlyEmpty = event.target.checked;
    renderTable();
  });
  $('#onlyFilled').addEventListener('change', (event) => {
    state.onlyFilled = event.target.checked;
    renderProgrammeNote();
    renderTable();
  });
  $('#query').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderTable();
  });
  $('#programSearch').addEventListener('input', (event) => {
    state.programSearch = event.target.value;
    // Seçili programın adı değiştirildiyse seçim düşer: yazılan metin artık o program değil.
    const chosen = state.programKod ? state.data?.programmes.find((p) => p.k === state.programKod) : null;
    if (chosen && event.target.value.trim() !== chosen.a) {
      state.programKod = null;
      applyProgramme();
      fillSelects();
      renderTable();
      syncUrl();
    }
    renderProgrammes({ open: true });
  });
  $('#programSearch').addEventListener('keydown', (event) => {
    const open = comboOpen();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        renderProgrammes({ open: true });
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlightCombo((state.comboActive ?? -1) + step);
      return;
    }
    if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      const picked = state.comboMatches?.[state.comboActive ?? 0];
      if (picked) chooseProgramme(picked.k);
      return;
    }
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      setComboOpen(false);
    }
  });
  $('#programSearch').addEventListener('blur', () => setComboOpen(false));
  // Tıklama/odak listeyi açar; ayrı ▾ düğmesi yok (tarayıcının kendi temizleme ×'i ile çakışıyordu).
  $('#programSearch').addEventListener('focus', () => renderProgrammes({ open: true }));
  $('#programSearch').addEventListener('click', () => {
    if (!comboOpen()) renderProgrammes({ open: true });
  });
  $('#programList').addEventListener('mousedown', (event) => {
    // mousedown: blur'dan önce yakala, aksi halde liste kapanıp tıklama kaybolur.
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    event.preventDefault();
    chooseProgramme(option.dataset.kod);
    $('#programSearch').focus();
  });
  $('#clear').addEventListener('click', () => {
    state.list = [];
    renderList();
    renderTable();
    syncUrl();
  });

  document.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-clear-filters]');
    if (clear) {
      clearFilters();
      return;
    }
    const switchLevel = event.target.closest('[data-switch-level]');
    if (switchLevel) {
      const level = switchLevel.dataset.switchLevel;
      if (LEVELS.includes(level)) {
        $('#level').value = level;
        loadLevel(level).catch(showError);
      }
      return;
    }
    const pickProgram = event.target.closest('[data-program]');
    if (pickProgram) {
      chooseProgramme(Number(pickProgram.dataset.program));
      return;
    }
    const histo = event.target.closest('[data-histo]');
    if (histo) {
      const kod = histo.dataset.histo;
      if (state.expanded.has(kod)) state.expanded.delete(kod);
      else state.expanded.add(kod);
      renderTable();
      return;
    }
    const add = event.target.closest('[data-add]');
    if (add) {
      const kod = add.dataset.add;
      if (!state.list.includes(kod) && state.list.length < MAX_TERCIH) {
        state.list.push(kod);
        renderList();
        renderTable();
        syncUrl();
      }
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      state.list.splice(Number(remove.dataset.remove), 1);
      renderList();
      renderTable();
      syncUrl();
      return;
    }
    const up = event.target.closest('[data-up]');
    if (up) {
      const index = Number(up.dataset.up);
      [state.list[index - 1], state.list[index]] = [state.list[index], state.list[index - 1]];
      renderList();
      syncUrl();
      return;
    }
    const down = event.target.closest('[data-down]');
    if (down) {
      const index = Number(down.dataset.down);
      [state.list[index + 1], state.list[index]] = [state.list[index], state.list[index + 1]];
      renderList();
      syncUrl();
    }
  });
}

function showError(error) {
  const box = $('#error');
  box.hidden = false;
  box.textContent = `Bir sorun çıktı: ${error.message}`;
}

async function main() {
  bind();
  // seviye verilmemişse ve dizinden gelinmişse (unvan/il), o grubun en çok
  // kadro verdiği seviyeyi seç — yoksa TEKNİKER gibi bir unvan lisansa düşer
  let level = params.get('seviye');
  const unvanParam = params.get('unvan');
  const ilParam = params.get('il');
  if (!level && (unvanParam || ilParam)) {
    try {
      const hint = await (await fetch('/data/dizin.json')).json();
      level = (unvanParam && hint.unvan?.[unvanParam]) || (ilParam && hint.il?.[ilParam]) || null;
    } catch {
      level = null;
    }
  }
  level = LEVELS.includes(level) ? level : 'lisans';
  $('#level').value = level;
  const puan = Number(params.get('puan'));
  if (Number.isFinite(puan) && puan > 0 && puan <= 100) {
    state.puan = puan;
    $('#puan').value = String(puan);
  }
  const program = Number(params.get('program'));
  if (Number.isFinite(program) && program > 0) state.programKod = program;
  // kadro dizini sayfalarından gelen derin bağlantılar
  if (params.get('il')) state.il = params.get('il');
  if (params.get('unvan')) state.unvan = params.get('unvan');
  await loadLevel(level);
  const list = params.get('l');
  if (list) {
    const known = new Set(state.data.rows.map((row) => row.kod));
    state.list = list.split(',').filter((kod) => known.has(kod)).slice(0, MAX_TERCIH);
    renderList();
    renderTable();
  }
  syncUrl();
}

main().catch(showError);
