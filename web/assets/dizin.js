// Kadro dizini sayfası: unvan ve il listelerini tarayıcıda süzer.
// Sunucu yok, ek istek yok — 57 + 81 satır için tamamen yeterli.
for (const input of document.querySelectorAll('.dizin-filter')) {
  const body = document.getElementById(input.dataset.target);
  const counter = document.getElementById(input.dataset.count);
  if (!body) continue;
  const rows = [...body.querySelectorAll('tr')];
  const empty = document.createElement('tr');
  empty.innerHTML = '<td colspan="5" class="empty" style="color:var(--ink-soft)">eşleşen kayıt yok</td>';
  empty.hidden = true;
  body.append(empty);

  const apply = () => {
    const needle = input.value.trim().toLocaleLowerCase('tr');
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || (row.dataset.name ?? row.textContent).toLocaleLowerCase('tr').includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    empty.hidden = shown > 0;
    if (counter) counter.textContent = needle ? `${shown}/${rows.length}` : String(rows.length);
  };
  input.addEventListener('input', apply);
}
