import { describe, expect, it } from 'vitest';
import { artistMatch, recordTextScore, surname, tokenSimilarity } from '../../server/lib/text';
import { combineConfidence, decideStatus, buildCandidate } from '../../server/pipeline/scoring';
import { normalizeSections, sanitizeVision } from '../../server/pipeline/services';
import { estimateCost, scanCostRange } from '../../server/lib/cost';
import { Limiter } from '../../server/lib/limits';
import { parseLabelText } from '../../shared/labelParse';
import { collectionToCsv } from '../../src/lib/export';

describe('comparaison de textes', () => {
  it('reconnaît un nom de famille quel que soit l’ordre', () => {
    expect(surname('Georges Seurat')).toBe('seurat');
    expect(surname('Seurat, Georges')).toBe('seurat');
    expect(surname('Vincent van Gogh')).toBe('gogh');
    expect(artistMatch('Georges Seurat', 'Seurat, Georges-Pierre')).toBe(1);
    expect(artistMatch('Claude Monet', 'Édouard Manet')).toBe(0);
  });
  it('ignore accents et mots vides', () => {
    expect(tokenSimilarity('La Liberté guidant le peuple', 'liberte guidant peuple')).toBe(1);
  });
  it('donne un score élevé à une notice concordante et faible sinon', () => {
    const h = { title: 'A Sunday on La Grande Jatte', artist: 'Georges Seurat' };
    expect(recordTextScore(h, { title: 'A Sunday on La Grande Jatte — 1884', artist: 'Georges Seurat' })).toBeGreaterThan(0.85);
    expect(recordTextScore(h, { title: 'The Starry Night', artist: 'Vincent van Gogh' })).toBeLessThan(0.2);
  });
});

describe('confiance combinée', () => {
  it('plafonne une hypothèse non vérifiée, même très confiante', () => {
    expect(combineConfidence(0.99, null, null)).toBeLessThanOrEqual(0.55);
  });
  it('récompense la concordance texte et image', () => {
    expect(combineConfidence(0.8, 0.95, 0.8)).toBeGreaterThan(0.8);
  });
  it('pénalise une image de référence très différente', () => {
    expect(combineConfidence(0.8, 0.95, 0.05)).toBeLessThan(combineConfidence(0.8, 0.95, null));
  });
  it('ne déclare « identifiée » qu’une œuvre vérifiée', () => {
    const h = { title: 'X', artist: 'Y', date: null, confidence: 0.99, reasoning: '', distinguishing: '' };
    const unverified = buildCandidate(h, [], null);
    expect(unverified.verified).toBe(false);
    expect(decideStatus([unverified])).toBe('uncertain');
    const rec = { id: 'met:1', source: 'met' as const, sourceLabel: 'Met', url: 'u', title: 'X', artist: 'Y' };
    const verified = buildCandidate(h, [{ r: rec, score: 1 }], 0.7);
    expect(decideStatus([verified])).toBe('identified');
  });
  it('signale l’ambiguïté entre deux hypothèses proches', () => {
    const mk = (c: number) => ({ ...buildCandidate({ title: 'a', artist: 'b', date: null, confidence: c, reasoning: '', distinguishing: '' }, [], null), confidence: c });
    expect(decideStatus([mk(0.6), mk(0.5)])).toBe('ambiguous');
  });
});

describe('garde-fous sur la sortie du modèle', () => {
  it('rétrograde un « fait » sans source et traduit les identifiants', () => {
    const ids = new Map([['S1', 'aic:27992']]);
    const out = normalizeSections(
      [
        { id: 'technique', claims: [{ text: 'Huile sur toile.', kind: 'fait', sources: ['S1'] }] },
        { id: 'resume', claims: [{ text: 'Chef-d’œuvre du pointillisme.', kind: 'fait', sources: [] }, { text: 'Inventé', kind: 'fait', sources: ['S9'] }] }
      ] as any,
      ids
    );
    expect(out.map((s) => s.id)).toEqual(['resume', 'technique']); // ordre éditorial
    expect(out[1].claims[0]).toMatchObject({ kind: 'fait', sources: ['aic:27992'] });
    expect(out[0].claims[0]).toMatchObject({ kind: 'interpretation', unsourced: true });
    expect(out[0].claims[1]).toMatchObject({ kind: 'interpretation', unsourced: true }); // source S9 inexistante
  });
  it('nettoie une analyse visuelle malformée', () => {
    const v = sanitizeVision({ objectKind: 'licorne', hypotheses: [{ title: 'T', artist: '', confidence: 7 }, { title: '' }], visibleText: ['a', 3] });
    expect(v.objectKind).toBe('autre');
    expect(v.hypotheses).toHaveLength(1);
    expect(v.hypotheses[0].confidence).toBe(1);
    expect(v.hypotheses[0].artist).toBe('Anonyme');
    expect(v.visibleText).toEqual(['a']);
  });
});

describe('coûts et limites', () => {
  it('calcule le coût au tarif publié', () => {
    // Sonnet 5.5 : 2 $ / 10 $ par million de tokens
    expect(estimateCost('claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(3, 5);
    const r = scanCostRange('claude-sonnet-5-5', 'claude-sonnet-5-5');
    expect(r.low).toBeGreaterThan(0);
    expect(r.high).toBeGreaterThan(r.low);
  });
  it('estime au plus haut un modèle inconnu, pour ne jamais sous-estimer', () => {
    expect(estimateCost('modele-inconnu', 1_000_000, 0)).toBe(10);
  });
  it('limite le débit par IP et le budget quotidien', () => {
    const l = new Limiter(2, 0.01);
    expect(l.checkRate('a').ok).toBe(true);
    expect(l.checkRate('a').ok).toBe(true);
    expect(l.checkRate('a').ok).toBe(false);
    expect(l.checkRate('b').ok).toBe(true);
    expect(l.budgetLeft()).toBe(true);
    l.record(0.02);
    expect(l.budgetLeft()).toBe(false);
  });
});

describe('lecture heuristique d’un cartel (OCR local)', () => {
  it('extrait les champs d’un cartel français type', () => {
    const f = parseLabelText(`Eugène Delacroix (1798-1863)
La Liberté guidant le peuple, 1830
Huile sur toile
260 x 325 cm
Inv. RF 129
Musée du Louvre, département des Peintures
Acquis au Salon de 1831`);
    expect(f.artist).toBe('Eugène Delacroix');
    expect(f.artistDates).toBe('1798-1863');
    expect(f.title).toBe('La Liberté guidant le peuple');
    expect(f.date).toBe('1830');
    expect(f.medium).toBe('Huile sur toile');
    expect(f.dimensions).toBe('260 x 325 cm');
    expect(f.inventory).toBe('RF 129');
    expect(f.institution).toMatch(/Louvre/);
    expect(f.creditLine).toMatch(/Acquis/);
  });
});

describe('export CSV', () => {
  it('produit un CSV point-virgule avec BOM et échappement', () => {
    const csv = collectionToCsv(
      [
        {
          id: 'k',
          entry: { title: 'Titre; avec "guillemets"', artist: 'A', date: '1900', objectKind: 'peinture', movement: null, technique: null, dimensions: null, institution: null, inventory: null, sources: [] } as any,
          notes: 'ligne1\nligne2',
          tags: ['x', 'y'],
          collectionIds: ['c1'],
          createdAt: 0,
          updatedAt: 0
        }
      ],
      [{ id: 'c1', name: 'Lumière', description: '', createdAt: 0, updatedAt: 0 }]
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Titre; avec ""guillemets"""');
    expect(csv).toContain('Lumière');
    expect(csv).toContain('"ligne1\nligne2"');
  });
});

describe('régression : même titre, autre artiste', () => {
  it('ne valide pas une notice dont seul le titre concorde', () => {
    expect(recordTextScore({ title: 'Portrait de femme', artist: 'Corot' }, { title: 'Portrait de femme', artist: 'Ingres' })).toBeLessThan(0.45);
  });
});
