// Kadro dizini ve kurum alımları sayfaları: listeyi tarayıcıda süzer.
// Sunucu yok, ek istek yok — birkaç yüz satır için tamamen yeterli.
// Hedef `data-target` bir tbody ya da birden çok tabloyu saran bir kapsayıcı olabilir;
// süzgeç yalnız `data-name` taşıyan satırlara dokunur (başlık satırları yerinde kalır).
import { foldTr } from './fold.js';

for (const input of document.querySelectorAll('.dizin-filter')) {
  const body = document.getElementById(input.dataset.target);
  const counter = document.getElementById(input.dataset.count);
  if (!body) continue;
  const rows = [...body.querySelectorAll('[data-name]')];
  const isTbody = body.tagName === 'TBODY';
  const empty = document.createElement('tr');
  empty.innerHTML = '<td colspan="8" class="empty" style="color:var(--ink-soft)">eşleşen kayıt yok</td>';
  empty.hidden = true;
  if (isTbody) body.append(empty);

  const apply = () => {
    // Katlama şart: `muhendis` yazımı MÜHENDİS'i, `hemsire` yazımı HEMŞİRE'yi bulmalı.
    const needle = foldTr(input.value.trim());
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || foldTr(row.dataset.name).includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    empty.hidden = shown > 0;
    if (counter) counter.textContent = needle ? `${shown}/${rows.length}` : String(rows.length);
  };
  input.addEventListener('input', apply);
  apply();
}
