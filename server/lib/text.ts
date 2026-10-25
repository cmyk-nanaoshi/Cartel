// Outils de comparaison de chaînes pour rapprocher une hypothèse d'une notice documentaire.

export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'le', 'la', 'les', 'l', 'de', 'des', 'du', 'd', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'sur', 'dans',
  'the', 'of', 'a', 'an', 'and', 'in', 'on', 'at', 'with', 'de', 'het', 'een', 'van', 'der', 'die', 'das'
]);

export function tokens(s: string | null | undefined): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Similarité de Dice sur les jetons (0..1). */
export function tokenSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Nom de famille probable (dernier mot significatif), pour comparer « Georges Seurat » et « Seurat, Georges ». */
export function surname(name: string | null | undefined): string {
  const n = normalize(name);
  if (!n) return '';
  if ((name ?? '').includes(',')) return normalize((name ?? '').split(',')[0]).split(' ').pop() ?? '';
  const parts = n.split(' ').filter((p) => p.length > 1 && !['van', 'von', 'de', 'der', 'da', 'del', 'di', 'le', 'la'].includes(p));
  return parts[parts.length - 1] ?? '';
}

export function artistMatch(a: string | null | undefined, b: string | null | undefined): number {
  const sa = surname(a);
  const nb = normalize(b);
  if (!sa || !nb) return 0;
  if (nb.split(' ').includes(sa)) return 1;
  return tokenSimilarity(a, b) > 0.4 ? 0.6 : 0;
}

/** Correspondance texte d'une notice avec une hypothèse : 60 % titre, 40 % artiste. */
export function recordTextScore(
  hyp: { title: string; artist: string },
  rec: { title?: string; artist?: string }
): number {
  const t = Math.max(tokenSimilarity(hyp.title, rec.title), containment(hyp.title, rec.title));
  const a = artistMatch(hyp.artist, rec.artist);
  if (!hyp.artist || /inconnu|anonyme|unknown/i.test(hyp.artist)) return t;
  // Un titre identique avec un autre artiste désigne une autre œuvre (titres génériques, copies) :
  // la notice reste sous le seuil de concordance.
  if (a === 0 && rec.artist) return Math.min(0.6 * t, 0.4);
  return 0.6 * t + 0.4 * a;
}

function containment(a?: string | null, b?: string | null) {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  return ta.filter((t) => tb.has(t)).length / ta.length >= 0.99 && ta.length >= 2 ? 0.9 : 0;
}

export function slug(s: string) {
  return normalize(s).replace(/ /g, '-').slice(0, 80);
}
