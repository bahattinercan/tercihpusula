import test from 'node:test';
import assert from 'node:assert/strict';
import { predictRows, band, indexRound } from '../pipeline/predict.mjs';

const row = (over) => ({
  kod: '100000001',
  unvan: 'MEMUR',
  il: 'ANKARA',
  kontenjan: 1,
  yerlesen: 1,
  bosKalan: 0,
  minPuan: 80,
  maxPuan: 80,
  ...over,
});

test('aynı unvan + il ortancası, aynı kadro kodundan önce gelir', () => {
  const history = [
    [
      row({ kod: '100000009', unvan: 'MEMUR', il: 'ANKARA', minPuan: 84 }),
      row({ kod: '100000010', unvan: 'MEMUR', il: 'ANKARA', minPuan: 86 }),
      row({ kod: '100000001', unvan: 'TEKNİKER', il: 'ANKARA', minPuan: 60 }),
    ],
  ];
  const predictions = predictRows([row({ unvan: 'MEMUR', il: 'ANKARA' })], history, 2.5);
  const prediction = predictions.get('100000001');
  assert.equal(prediction.source, 'unvan_il');
  assert.equal(prediction.puan, 85);
});

test('aynı kadro kodu, unvan+il yoksa kullanılır', () => {
  const history = [[row({ kod: '100000001', unvan: 'BAŞKA', il: 'İZMİR', minPuan: 77 })]];
  const prediction = predictRows([row({ unvan: 'MEMUR', il: 'ANKARA' })], history, 2.5).get('100000001');
  assert.equal(prediction.source, 'same_kod');
  assert.equal(prediction.puan, 77);
});

test('kontenjan artışı tahmini aşağı çeker, aralık hesaplanır', () => {
  const history = [[row({ kontenjan: 1, minPuan: 85 })]];
  const prediction = predictRows([row({ kontenjan: 4 })], history, 2.5).get('100000001');
  assert.ok(prediction.puan < 85, 'kontenjan 4 katına çıkınca tahmin düşmeli');
  assert.equal(prediction.ust - prediction.puan, 2.5);
});

test('geçmişi olmayan satır tahmin üretmez', () => {
  const prediction = predictRows([row({ unvan: 'YENİ UNVAN', il: 'AĞRI', kod: '999999999' })], [[]], 2.5).get('999999999');
  assert.equal(prediction.puan, null);
  assert.equal(prediction.source, 'none');
});

test('bant eşikleri simetrik', () => {
  const prediction = { puan: 80, alt: 75, ust: 85 };
  assert.equal(band(86, prediction), 'garanti');
  assert.equal(band(80, prediction), 'hedef');
  assert.equal(band(77, prediction), 'riskli');
  assert.equal(band(70, prediction), 'uzak');
  assert.equal(band(80, { puan: null }), 'bilinmiyor');
});

test('indexRound puansız satırları dışlar', () => {
  const index = indexRound([row({ minPuan: null }), row({ kod: '100000002' })]);
  assert.equal(index.byKod.size, 1);
});
