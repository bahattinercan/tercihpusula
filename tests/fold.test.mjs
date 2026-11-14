// Turkish folding: the search box must not require Turkish diacritics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldTr } from '../web/assets/fold.js';

test('accents and Turkish case are folded away', () => {
  assert.equal(foldTr('HEMŞİRE'), 'hemsire');
  assert.equal(foldTr('MÜHENDİS'), 'muhendis');
  assert.equal(foldTr('SAĞLIK MEMURU'), 'saglik memuru');
  assert.equal(foldTr('IĞDIR'), 'igdir');
  assert.equal(foldTr('İzmir'), 'izmir');
});

test('ASCII query finds the Turkish title (and the reverse)', () => {
  const pairs = [
    ['hemsire', 'HEMŞİRE'],
    ['muhendis', 'MÜHENDİS'],
    ['saglik memuru', 'SAĞLIK MEMURU'],
    ['igdir', 'IĞDIR'],
    ['MUHASEBECİ', 'muhasebeci'],
  ];
  for (const [query, title] of pairs) {
    assert.ok(foldTr(title).includes(foldTr(query)), `${query} should find ${title}`);
    assert.ok(foldTr(query).length <= foldTr(title).length);
  }
});

test('dotted capital İ does not leave a combining dot behind', () => {
  // 'HEMŞİRE'.toLowerCase() yields "hemşi̇re" (i + U+0307) and then "hemşire"
  // no longer matches — the whole reason folding exists.
  assert.ok(!foldTr('HEMŞİRE').includes('\u0307'), 'combining dot must be stripped');
  assert.equal(foldTr('HEMŞİRE').normalize('NFC'), foldTr('hemşire'));
});
