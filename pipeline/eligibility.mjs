// Eligibility engine: which cadre rows a candidate is legally allowed to write.
//
// The chain comes straight from the kılavuz package:
//   diploma programme code  →  nitelik codes that list it  →  cadre rows requiring those codes
//
// A cadre row requires ALL of its nitelik codes (md. 3.3 only says that several
// programmes inside one code are alternatives). A code that cannot be decided
// from the data — a certificate, a driving licence, or the "6262 Bakınız
// Başvurma Özel Şartları" pointer — never silently passes: the row stays
// writable but carries a warning the candidate must clear themselves.

export const KIND = {
  anyLevel: 'any_level',
  programmes: 'programmes',
  certificate: 'certificate',
  pointer: 'pointer',
  unknown: 'unknown',
};

/** Classify one nitelik definition. */
export function classifyNitelik(tanim, programKodlari) {
  const text = tanim.toLocaleLowerCase('tr');
  if (/^herhangi bir (l[ıi]sans|ön lisans|ortaöğretim)/.test(text)) return KIND.anyLevel;
  if (/başvurma özel şartlar|bakınız/.test(text)) return KIND.pointer;
  if (/sertifika|belge|ehliyet|ruhsat|kurs bitirme/.test(text)) return KIND.certificate;
  if (programKodlari.length > 0) return KIND.programmes;
  return KIND.unknown;
}

/**
 * @param {{programmes: Array<{kod:number, ad:string}>, nitelikler: Array<{kod:number, tanim:string, programKodlari:number[]}>, kadroRows: Array<{kod:string, nitelikKodlari:number[]}>}} input
 */
export function buildEligibility({ programmes, nitelikler, kadroRows }) {
  const programmeByCode = new Map(programmes.map((p) => [p.kod, p]));
  const nitelikByCode = new Map();
  for (const entry of nitelikler) {
    nitelikByCode.set(entry.kod, { ...entry, kind: classifyNitelik(entry.tanim, entry.programKodlari) });
  }

  // reverse index: programme code -> nitelik codes it satisfies
  const programmeToNitelik = new Map();
  for (const entry of nitelikByCode.values()) {
    for (const programKod of entry.programKodlari) {
      if (!programmeToNitelik.has(programKod)) programmeToNitelik.set(programKod, new Set());
      programmeToNitelik.get(programKod).add(entry.kod);
    }
  }

  const orphanProgrammes = programmes.filter((p) => !programmeToNitelik.has(p.kod));
  const unknownNitelik = [...nitelikByCode.values()].filter((n) => n.kind === KIND.unknown);
  const unknownProgrammeCodes = new Set();
  for (const entry of nitelikByCode.values()) {
    for (const kod of entry.programKodlari) if (!programmeByCode.has(kod)) unknownProgrammeCodes.add(kod);
  }

  return {
    programmeByCode,
    nitelikByCode,
    programmeToNitelik,
    kadroToNitelik: new Map(kadroRows.map((row) => [row.kod, row.nitelikKodlari])),
    stats: {
      programmes: programmes.length,
      programmesWithoutNitelik: orphanProgrammes.length,
      nitelikler: nitelikByCode.size,
      nitelikWithoutProgramme: unknownNitelik.length,
      programmeCodesNotInList: unknownProgrammeCodes.size,
      kadro: kadroRows.length,
    },
  };
}

/**
 * Resolve one candidate against one round.
 * @param {{programKod: number}} profile
 * @param {ReturnType<typeof buildEligibility>} index
 * @returns {{writable: Array<{kod:string, manual:number[]}>, blocked: Array<{kod:string, reason:string}>, warnings: string[]}}
 */
export function resolve(profile, index) {
  const { programKod } = profile;
  const myNitelik = index.programmeToNitelik.get(programKod) ?? new Set();
  const writable = [];
  const blocked = [];

  for (const [kadroKod, codes] of index.kadroToNitelik) {
    const missing = [];
    const manual = [];
    for (const code of codes) {
      const entry = index.nitelikByCode.get(code);
      if (!entry) {
        manual.push(code);
        continue;
      }
      if (entry.kind === KIND.anyLevel) continue;
      if (entry.kind === KIND.programmes) {
        if (!myNitelik.has(code)) missing.push(code);
        continue;
      }
      manual.push(code);
    }
    if (missing.length) blocked.push({ kod: kadroKod, reason: `nitelik ${missing[0]}` });
    else writable.push({ kod: kadroKod, manual });
  }

  const warnings = [];
  if (!index.programmeByCode.has(programKod)) warnings.push(`program ${programKod} kılavuzda yok`);
  if (!myNitelik.size) warnings.push(`program ${programKod} hiçbir nitelik kodunda geçmiyor`);
  return { writable, blocked, warnings };
}
