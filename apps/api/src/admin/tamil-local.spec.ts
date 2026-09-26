import { hasTamil, toTamilLocal } from './tamil-local';

describe('offline Tamil transliteration (fallback)', () => {
  it('maps sounds to Tamil letters, with a pulli on word-final consonants', () => {
    expect(toTamilLocal('Anna Nagar')).toBe('அன்ன நகர்'); // word-initial n is the dental ந
  });

  it('treats a word-final "y" after a consonant as the "ee" sound and a silent u after g', () => {
    const t = toTamilLocal('Guindy');
    expect(t).toBe('கின்டி');
    expect(t.endsWith('ி')).toBe(true);
  });

  it('always produces Tamil script for Latin input, and keeps spaces', () => {
    for (const name of ['Velachery', 'T Nagar', 'Porur', 'Tambaram', 'Adyar', 'Race Course Road']) {
      const t = toTamilLocal(name);
      expect(hasTamil(t)).toBe(true);
      expect(t.split(' ')).toHaveLength(name.split(' ').length);
      expect(t).not.toMatch(/[A-Za-z]/);
    }
  });

  it('leaves Tamil words, digits and empty input alone', () => {
    expect(toTamilLocal('கிண்டி')).toBe('கிண்டி');
    expect(toTamilLocal('Branch 12')).toMatch(/ 12$/);
    expect(toTamilLocal('   ')).toBe('');
  });
});
