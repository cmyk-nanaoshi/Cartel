import { describe, expect, it } from 'vitest';
import { mergeLabel, sanitizeBox, sanitizeVision } from '../../server/pipeline/services';

describe('Repérage du cartel', () => {
  it('accepte des fractions et convertit des pourcentages', () => {
    expect(sanitizeBox({ left: 0.75, top: 0.6, width: 0.1, height: 0.12 })).toEqual({ left: 0.75, top: 0.6, width: 0.1, height: 0.12 });
    expect(sanitizeBox({ left: 75, top: 60, width: 10, height: 12 })).toEqual({ left: 0.75, top: 0.6, width: 0.1, height: 0.12 });
  });
  it('rejette une zone invalide', () => {
    expect(sanitizeBox(null)).toBeNull();
    expect(sanitizeBox({ left: 0.5, top: 0.5, width: 0, height: 0.1 })).toBeNull();
  });
  it('borne la zone à l’image', () => {
    const b = sanitizeBox({ left: 0.9, top: 0.9, width: 0.3, height: 0.3 })!;
    expect(b.left + b.width).toBeCloseTo(1);
    expect(b.top + b.height).toBeCloseTo(1);
  });
});

describe('Seconde lecture du cartel', () => {
  const empty = { title: null, artist: null, artistDates: null, date: null, medium: null, dimensions: null, inventory: null, institution: null, creditLine: null, description: null, rawText: '' };
  it('complète les champs vides sans écraser les champs lus', () => {
    const a = { ...empty, artist: 'Zhang Maxime' };
    const b = { ...empty, artist: 'Zhang M.', title: 'Sans titre', rawText: 'Zhang Maxime\nSans titre' };
    expect(mergeLabel(a, b)).toMatchObject({ artist: 'Zhang Maxime', title: 'Sans titre', rawText: 'Zhang Maxime\nSans titre' });
  });
});

describe('Pistes de la vision', () => {
  it('garde le nom signé et la piste de style', () => {
    const v = sanitizeVision({ isArtwork: true, hypotheses: [], signedArtist: ' Zhang Maxime ', styleLead: 'Abstraction lyrique', labelBox: null });
    expect(v.signedArtist).toBe('Zhang Maxime');
    expect(v.styleLead).toBe('Abstraction lyrique');
  });
});
