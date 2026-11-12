import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResultsText, splitKurum } from '../pipeline/parse-results.mjs';
import { parseSummaryText } from '../pipeline/parse-summary.mjs';

const line = (...parts) => parts.join('\n');

test('parses a single-line row with both scores', () => {
  const text = line(
    'Program Kodu                    Program Adı                     Kadro Ünvanı',
    '301014021  AFET VE ACİL DURUM YÖNETİMİ BAŞKANLIĞI / AKSARAY / TAŞRA         ENFORMASYON MEMURU         1              1               0         81,63365  87,43920',
  );
  const { rows, stats } = parseResultsText(text);
  assert.equal(stats.parsed, 1);
  assert.deepEqual(rows[0], {
    kod: '301014021',
    kurum: 'AFET VE ACİL DURUM YÖNETİMİ BAŞKANLIĞI',
    il: 'AKSARAY',
    teskilat: 'TAŞRA',
    unvan: 'ENFORMASYON MEMURU',
    kontenjan: 1,
    yerlesen: 1,
    bosKalan: 0,
    minPuan: 81.63365,
    maxPuan: 87.4392,
  });
});

test('re-joins a job title that -table split across cells', () => {
  const text =
    '301015999  AMASYA İL ÖZEL İDARESİ / AMASYA / MERKEZ     VERİ HAZIRLAMA VE KONTROL     İŞLETMENİ     1  1  0     80,00000  80,00000';
  const { rows } = parseResultsText(text);
  assert.equal(rows[0].unvan, 'VERİ HAZIRLAMA VE KONTROL İŞLETMENİ');
  assert.equal(rows[0].kurum, 'AMASYA İL ÖZEL İDARESİ');
});

test('keeps unplaced rows with null scores, never 0', () => {
  const text = '301017843  YÜKSEKÖĞRETİM KURULU BAŞKANLIĞI / ANKARA / MERKEZ     BİLGİSAYAR İŞLETMENİ     1  0  1     --  --';
  const { rows } = parseResultsText(text);
  assert.equal(rows[0].minPuan, null);
  assert.equal(rows[0].maxPuan, null);
  assert.equal(rows[0].bosKalan, 1);
});

test('a partially filled cadre keeps its score (kontenjan 2, yerleşen 1)', () => {
  const text = '302016093  TARIM VE ORMAN BAKANLIĞI / ANKARA / TAŞRA     ZİRAAT MÜHENDİSİ     2  1  1     61,48915  61,48915';
  const { rows } = parseResultsText(text);
  assert.equal(rows[0].kontenjan, 2);
  assert.equal(rows[0].yerlesen, 1);
  assert.equal(rows[0].bosKalan, 1);
  assert.equal(rows[0].minPuan, 61.48915);
});

test('numeric quotas are never mistaken for scores', () => {
  // a quota tail of "1 1 0" must not become minPuan=1, maxPuan=0
  const text = '301013993  ADIYAMAN İL ÖZEL İDARESİ / ADIYAMAN / MERKEZ     ŞEHİR PLANCISI     1  1  0     80,85842  80,85842';
  const { rows } = parseResultsText(text);
  assert.equal(rows[0].kontenjan, 1);
  assert.equal(rows[0].minPuan, 80.85842);
});

test('falls back to the anchor rule when kurum and title are too close', () => {
  const text =
    '301016001  ÇALIŞMA VE SOSYAL GÜVENLİK EĞİTİM VE ARAŞTIRMA MERKEZİ BAŞKANLIĞI / ANKARA  /  MERKEZ  KÜTÜPHANECİ     1  1  0     88,10000  88,10000';
  const { rows } = parseResultsText(text);
  assert.equal(rows[0].kurum, 'ÇALIŞMA VE SOSYAL GÜVENLİK EĞİTİM VE ARAŞTIRMA MERKEZİ BAŞKANLIĞI');
  assert.equal(rows[0].il, 'ANKARA');
  assert.equal(rows[0].teskilat, 'MERKEZ');
  assert.equal(rows[0].unvan, 'KÜTÜPHANECİ');
});

test('splitKurum handles teskilat, ilce and missing teskilat', () => {
  assert.deepEqual(splitKurum('X BAKANLIĞI / ANKARA / TAŞRA'), { kurum: 'X BAKANLIĞI', il: 'ANKARA', teskilat: 'TAŞRA' });
  assert.deepEqual(splitKurum('BARTIN BELEDİYESİ / BARTIN (MERKEZ)'), { kurum: 'BARTIN BELEDİYESİ', il: 'BARTIN (MERKEZ)', teskilat: null });
  assert.deepEqual(splitKurum('AĞLASUN BELEDİYESİ / BURDUR (AĞLASUN)'), { kurum: 'AĞLASUN BELEDİYESİ', il: 'BURDUR (AĞLASUN)', teskilat: null });
});

test('parses the official summary table despite justified text', () => {
  const text = [
    'Yerleştirme T  ürü  Tercih  Yapan  Aday Sayısı  Kontenjan Sayısı  Yerleşen  Aday Sayısı  Boş Kalan Kontenj  an  Sayısı',
    'LİSANS                             104.148      977                         976                                 1',
    'ÖN LİSANS                          70.990       828                         828                                 0',
    'ORTAÖĞRETİM                        74.159       278                         278                                 0',
    'TOPLAM                             249.297      2.083                       2.082                               1',
  ].join('\n');
  const { levels } = parseSummaryText(text);
  assert.deepEqual(levels.lisans, { tercihYapan: 104148, kontenjan: 977, yerlesen: 976, bos: 1 });
  assert.deepEqual(levels.onlisans, { tercihYapan: 70990, kontenjan: 828, yerlesen: 828, bos: 0 });
  assert.deepEqual(levels.toplam, { tercihYapan: 249297, kontenjan: 2083, yerlesen: 2082, bos: 1 });
});
