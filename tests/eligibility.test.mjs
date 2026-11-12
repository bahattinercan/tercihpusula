// Uygunluk motoru: kılavuzun nitelik kodları ile mezuniyet programı eşleşmesi.
// Kural: bir kadro satırı nitelik kodlarının HEPSİNİ ister; sertifika/özel şart
// kodları otomatik geçmez, "kontrol et" olarak işaretlenir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEligibility, resolve, classifyNitelik, KIND } from '../pipeline/eligibility.mjs';

const programmes = [
  { kod: 3342, ad: 'TÜRK DİLİ VE EDEBİYATI' },
  { kod: 1113, ad: 'ASTRONOMİ VE ASTROFİZİK' },
];
const nitelikler = [
  { kod: 4001, tanim: 'Herhangi bir lisans programından mezun olmak.', programKodlari: [] },
  { kod: 4003, tanim: 'Türk Dili ve Edebiyatı lisans programından mezun olmak.', programKodlari: [3342] },
  { kod: 4685, tanim: 'Astronomi ve Astrofizik lisans programından mezun olmak.', programKodlari: [1113] },
  { kod: 6225, tanim: 'MEB onaylı Bilgisayar İşletmeni Sertifikası sahibi olmak.', programKodlari: [] },
  { kod: 6262, tanim: 'Bakınız: Başvurma Özel Şartları', programKodlari: [] },
];
const kadroRows = [
  { kod: '100000001', nitelikKodlari: [4001] },            // herkese açık
  { kod: '100000002', nitelikKodlari: [4003] },            // sadece TDE
  { kod: '100000003', nitelikKodlari: [4003, 6225] },      // TDE + sertifika
  { kod: '100000004', nitelikKodlari: [4003, 4685] },      // imkânsız kombinasyon
  { kod: '100000005', nitelikKodlari: [6262] },            // özel şartlar
  { kod: '100000006', nitelikKodlari: [9999] },            // sözlükte olmayan kod
];

const index = buildEligibility({ programmes, nitelikler, kadroRows });

test('nitelik kodları sınıflandırılır', () => {
  assert.equal(classifyNitelik('Herhangi bir lisans programından mezun olmak.', []), KIND.anyLevel);
  assert.equal(classifyNitelik('MEB onaylı X Sertifikası sahibi olmak.', []), KIND.certificate);
  assert.equal(classifyNitelik('Bakınız: Başvurma Özel Şartları', []), KIND.pointer);
  assert.equal(classifyNitelik('Türk Dili ve Edebiyatı lisans programından mezun olmak.', [3342]), KIND.programmes);
});

test('herkese açık kadro her programdan yazılabilir', () => {
  const { writable } = resolve({ programKod: 1113 }, index);
  assert.ok(writable.some((row) => row.kod === '100000001'));
});

test('program uyuşmazlığı satırı kapatır', () => {
  const { blocked } = resolve({ programKod: 1113 }, index);
  assert.ok(blocked.some((row) => row.kod === '100000002'));
});

test('sertifika kodlu satır yazılabilir ama elle kontrol işaretli', () => {
  const { writable } = resolve({ programKod: 3342 }, index);
  const row = writable.find((item) => item.kod === '100000003');
  assert.ok(row);
  assert.deepEqual(row.manual, [6225]);
});

test('birden fazla kod birlikte istenir; biri tutmuyorsa satır kapanır', () => {
  const { blocked } = resolve({ programKod: 3342 }, index);
  assert.ok(blocked.some((row) => row.kod === '100000004'));
});

test('sözlükte olmayan kod satırı kapatmaz, elle kontrole düşer', () => {
  const { writable } = resolve({ programKod: 3342 }, index);
  const row = writable.find((item) => item.kod === '100000006');
  assert.ok(row);
  assert.deepEqual(row.manual, [9999]);
});

test('kılavuzda olmayan program uyarı üretir', () => {
  const { warnings } = resolve({ programKod: 7777 }, index);
  assert.ok(warnings.length >= 1);
});
