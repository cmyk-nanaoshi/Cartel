// Règle de confidentialité des observations : ce qui part du téléphone est exactement ce qui est public.
import { describe, expect, it } from 'vitest';
import { allowedVisibilities, defaultVisibility, lotFromText, publicView, registerDate, type Observation } from '../../shared/observations';

const base: Observation = {
  id: 'o1',
  artworkKey: 'valtat--vase-de-lilas',
  artworkTitle: 'Vase de lilas',
  artworkArtist: 'Louis Valtat',
  kind: 'vente',
  placeName: 'Maison X',
  city: 'Paris',
  date: '2026-10-22',
  lot: '94',
  saleMoment: 'exposition',
  estimate: '2 000 – 3 000 €',
  visibility: 'public',
  createdAt: 0,
  updatedAt: 0
};

describe('observations : ce qui peut quitter le téléphone', () => {
  it('privé : rien du tout', () => {
    expect(publicView({ ...base, visibility: 'prive' })).toBeNull();
  });

  it('ville seulement : type de lieu, ville et date, sans nom ni lot', () => {
    const v = publicView({ ...base, visibility: 'public_ville' })!;
    expect(v).toMatchObject({ kind: 'vente', city: 'Paris', date: '2026-10-22' });
    expect(v).not.toHaveProperty('placeName');
    expect(v).not.toHaveProperty('lot');
    expect(v).not.toHaveProperty('estimate');
  });

  it('public : tout ce qui a été saisi', () => {
    expect(publicView(base)).toMatchObject({ placeName: 'Maison X', lot: '94', saleMoment: 'exposition', estimate: '2 000 – 3 000 €' });
  });

  it('l’adresse d’une collection privée ne part jamais, même publique et déclarée par le propriétaire', () => {
    const o: Observation = { ...base, kind: 'collection_privee', placeName: 'Collection Y', address: '1 rue Z', isOwner: true, lot: undefined };
    const v = publicView(o)!;
    expect(v).toMatchObject({ placeName: 'Collection Y', declaredByOwner: true });
    expect(JSON.stringify(v)).not.toContain('1 rue Z');
  });

  it('sans être propriétaire, une collection privée ne peut pas être publiée en entier', () => {
    const o: Observation = { ...base, kind: 'collection_privee', placeName: 'Collection Y', isOwner: false, visibility: 'public' };
    expect(allowedVisibilities(o)).toEqual(['public_ville', 'prive']);
    expect(defaultVisibility(o)).toBe('public_ville');
    // Un réglage interdit est traité comme privé, jamais comme public.
    expect(publicView(o)).toBeNull();
  });

  it('public est proposé en premier, privé en dernier', () => {
    expect(allowedVisibilities({ kind: 'musee' })).toEqual(['public', 'public_ville', 'prive']);
    expect(defaultVisibility({ kind: 'musee' })).toBe('public');
  });
});

describe('outils', () => {
  it('lit un numéro de lot sur une étiquette', () => {
    expect(lotFromText(['Signé en bas à gauche', 'Étiquette de vente : lot 94'])).toBe('94');
    expect(lotFromText(['LOT N° 12'])).toBe('12');
    expect(lotFromText(['Huile sur toile'])).toBeNull();
  });
  it('écrit la date comme un registre', () => {
    expect(registerDate('2026-10-29')).toBe('29.10.2026');
  });
});
