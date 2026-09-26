/**
 * Offline English -> Tamil transliteration (fallback). It maps sounds, not spellings, so it is only an
 * approximation of how a person would write a place name (e.g. "Adyar" -> அட்யர், not அடையாறு). The primary
 * source is the external transliteration service; this keeps the feature working without internet.
 */

// [latin, independent letter, dependent sign] - longest patterns first
const VOWELS: Array<[string, string, string]> = [
  ['aa', 'ஆ', 'ா'], ['ai', 'ஐ', 'ை'], ['au', 'ஔ', 'ௌ'], ['ee', 'ஈ', 'ீ'], ['oo', 'ஊ', 'ூ'], ['ea', 'ஈ', 'ீ'],
  ['a', 'அ', ''], ['i', 'இ', 'ி'], ['u', 'உ', 'ு'], ['e', 'எ', 'ெ'], ['o', 'ஒ', 'ொ'],
];

const CONSONANTS: Array<[string, string]> = [
  ['ksh', 'க்ஷ'], ['chh', 'ச'], ['sh', 'ஷ'], ['ch', 'ச'], ['th', 'த'], ['dh', 'த'], ['kh', 'க'], ['gh', 'க'],
  ['ph', 'ப'], ['bh', 'ப'], ['ng', 'ங'], ['nj', 'ஞ'], ['zh', 'ழ'], ['ck', 'க'],
  ['k', 'க'], ['g', 'க'], ['j', 'ஜ'], ['t', 'ட'], ['d', 'ட'], ['n', 'ன'], ['p', 'ப'], ['b', 'ப'], ['m', 'ம'],
  ['y', 'ய'], ['r', 'ர'], ['l', 'ல'], ['v', 'வ'], ['w', 'வ'], ['s', 'ச'], ['h', 'ஹ'], ['z', 'ழ'],
  ['f', 'ஃப'], ['q', 'க'], ['x', 'க்ஸ'], ['c', 'க'],
];

const PULLI = '்';

function word(raw: string): string {
  let w = raw
    .toLowerCase()
    .replace(/qu/g, 'kv')
    .replace(/gu(?=[ie])/g, 'g') // "Guindy": the u is silent
    .replace(/c(?=[eiy])/g, 's') // soft c
    .replace(/([bcdfghjklmnpqrstvwxz])y$/, '$1i'); // word-final consonant + y is an "ee" sound (Guindy)

  let out = '';
  let pending: string | null = null; // a consonant waiting to learn its vowel
  let pos = 0;
  while (pos < w.length) {
    const rest = w.slice(pos);
    const v = VOWELS.find(([l]) => rest.startsWith(l));
    if (v) {
      out += pending !== null ? pending + v[2] : v[1];
      pending = null;
      pos += v[0].length;
      continue;
    }
    const c = CONSONANTS.find(([l]) => rest.startsWith(l));
    if (c) {
      if (pending !== null) out += pending + PULLI; // consonant cluster: the earlier one is silent-vowelled
      // a word-initial "n" is the dental ந
      pending = pos === 0 && c[0] === 'n' ? 'ந' : c[1];
      pos += c[0].length;
      continue;
    }
    // anything else (digits, punctuation) passes through
    if (pending !== null) { out += pending + PULLI; pending = null; }
    out += w[pos];
    pos += 1;
  }
  if (pending !== null) out += pending + PULLI; // word-final consonant
  return out;
}

/** Transliterate a phrase; words that are already Tamil, or have no Latin letters, are kept as they are. */
export function toTamilLocal(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => (/[A-Za-z]/.test(w) ? w.replace(/[A-Za-z]+/g, (m) => word(m)) : w))
    .join(' ');
}

export const hasTamil = (s: string) => /[஀-௿]/.test(s);
