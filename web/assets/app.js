// Tercih Pusulası — uygulama adası. Çerçeve yok, bağımlılık yok.
// Veri /data/<seviye>.json içinde; 555 satırlık en büyük liste tarayıcıda rahat.

const MAX_TERCIH = 30;
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
  il: '',
  unvan: '',
  kurum: '',
  onlyWritable: true,
  onlyEmpty: false,
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

function filteredRows() {
  const sigma = state.data.sigma ?? 6;
  const needle = state.query.trim().toLocaleLowerCase('tr');
  return state.data.rows.filter((row) => {
    if (state.onlyWritable && !isWritable(row)) return false;
    if (state.onlyEmpty && !row.bos) return false;
    if (state.il && row.il !== state.il) return false;
    if (state.unvan && row.unvan !== state.unvan) return false;
    if (state.kurum && row.kurum !== state.kurum) return false;
    if (needle) {
      const haystack = `${row.kurum} ${row.unvan} ${row.il} ${row.kod}`.toLocaleLowerCase('tr');
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

function renderTable() {
  const sigma = state.data.sigma ?? 6;
  const rows = filteredRows();
  const body = $('#rows');
  const frag = document.createDocumentFragment();
  for (const row of rows.slice(0, 400)) {
    const tr = document.createElement('tr');
    const band = bandOf(state.puan, row.tahmin, sigma);
    const meta = BANDS[band];
    const manual = manualCodes(row);
    const inList = state.list.includes(row.kod);
    tr.innerHTML = `
      <td>
        <strong>${row.unvan ?? '—'}</strong>
        <div class="sub">${row.kurum ?? '—'} · ${row.il ?? '—'}${row.tes ? ` / ${row.tes}` : ''}</div>
      </td>
      <td class="num">${row.knt ?? '—'}</td>
      <td class="num dim">${fmt(row.taban)}</td>
      <td class="num">${fmt(row.tahmin?.puan)}</td>
      <td><span class="chip ${band}" title="çapa: ${row.tahmin?.source ?? 'yok'}">${meta.label}</span>
        ${row.bos ? '<span class="chip">boş kaldı</span>' : ''}
        ${manual.length ? '<span class="chip manual" title="Bu satırda sertifika/özel şart var">kontrol et</span>' : ''}
      </td>
      <td><button class="ghost small" data-add="${row.kod}" ${inList || state.list.length >= MAX_TERCIH ? 'disabled' : ''}>${inList ? 'listede' : 'ekle'}</button></td>`;
    frag.append(tr);
  }
  body.replaceChildren(frag);
  $('#count').textContent = `${rows.length} satır${rows.length > 400 ? ' (ilk 400 gösteriliyor)' : ''}`;
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
          <strong>${row?.unvan ?? kod}</strong>
          <div class="sub">${row?.kurum ?? ''} · ${row?.il ?? ''} · taban ${fmt(row?.taban)}</div>
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
  $('#probability').textContent = hasEstimate ? 'tahmin · satır olasılıklarının birleşimi' : 'puan ve tercih girildikçe hesaplanır';
  $('#listMeta').textContent = `${state.list.length}/${MAX_TERCIH}`;
  save();
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

function fillProgrammes() {
  const select = $('#program');
  const groups = new Map();
  for (const p of state.data.programmes) {
    const key = p.a[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  select.innerHTML =
    '<option value="">Mezun olduğunuz programı seçin</option>' +
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b, 'tr'))
      .map(
        ([key, items]) =>
          `<optgroup label="${key}">${items
            .sort((a, b) => a.a.localeCompare(b.a, 'tr'))
            .map((p) => `<option value="${p.k}">${p.a}</option>`)
            .join('')}</optgroup>`,
      )
      .join('');
  if (state.programKod) select.value = String(state.programKod);
}

function fillSelects() {
  const uniq = (field) => [...new Set(state.data.rows.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const fill = (id, values, current, placeholder) => {
    const select = $(id);
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map((v) => `<option>${v}</option>`).join('');
    select.value = current;
  };
  fill('#il', uniq('il'), state.il, 'Tüm iller');
  fill('#unvan', uniq('unvan'), state.unvan, 'Tüm unvanlar');
  fill('#kurum', uniq('kurum'), state.kurum, 'Tüm kurumlar');
}

function applyProgramme() {
  state.writable = new Set();
  state.manual = new Map();
  if (state.programKod) {
    const codes = state.data.programNitelik[String(state.programKod)] ?? [];
    for (const code of codes) state.writable.add(code);
    const known = state.data.programmes.some((p) => p.k === state.programKod);
    $('#programNote').textContent = known
      ? `${codes.length} nitelik kodu bu programla eşleşiyor.`
      : 'Bu program kılavuzda bulunamadı.';
  } else {
    $('#programNote').textContent = '';
  }
}

async function loadLevel(level) {
  const res = await fetch(`/data/${level}.json`);
  if (!res.ok) throw new Error(`veri yüklenemedi: ${res.status}`);
  state.data = await res.json();
  state.level = level;
  try {
    const stored = JSON.parse(localStorage.getItem(`tp:list:${level}`) ?? '[]');
    state.list = Array.isArray(stored) ? stored.slice(0, MAX_TERCIH) : [];
  } catch {
    state.list = [];
  }
  $('#round').textContent = state.data.round;
  fillProgrammes();
  fillSelects();
  applyProgramme();
  renderTable();
  renderList();
}

function bind() {
  $('#puan').addEventListener('input', (event) => {
    const value = Number(String(event.target.value).replace(',', '.'));
    state.puan = Number.isFinite(value) && value > 0 ? value : null;
    renderTable();
    renderList();
    syncUrl();
  });
  $('#level').addEventListener('change', (event) => loadLevel(event.target.value).catch(showError));
  $('#program').addEventListener('change', (event) => {
    state.programKod = event.target.value ? Number(event.target.value) : null;
    applyProgramme();
    renderTable();
    syncUrl();
  });
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
  $('#query').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderTable();
  });
  $('#clear').addEventListener('click', () => {
    state.list = [];
    renderList();
    renderTable();
    syncUrl();
  });

  document.addEventListener('click', (event) => {
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
  level = level ?? 'lisans';
  $('#level').value = level;
  const puan = params.get('puan');
  if (puan) {
    state.puan = Number(puan);
    $('#puan').value = puan;
  }
  if (params.get('program')) state.programKod = Number(params.get('program'));
  // kadro dizini sayfalarından gelen derin bağlantılar
  if (params.get('il')) state.il = params.get('il');
  if (params.get('unvan')) state.unvan = params.get('unvan');
  await loadLevel(level);
  const list = params.get('l');
  if (list) {
    state.list = list.split(',').filter(Boolean).slice(0, MAX_TERCIH);
    renderList();
    renderTable();
  }
  syncUrl();
}

main().catch(showError);
