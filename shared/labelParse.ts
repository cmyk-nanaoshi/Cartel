import type { LabelFields } from './types.js';

// Analyse heuristique d'un cartel à partir du texte brut d'un OCR local (Tesseract).
// Utilisée quand aucune IA n'est disponible. Les champs proposés sont toujours soumis
// à la validation du visiteur avant enregistrement.

const DIM_RE = /(\d+(?:[.,]\d+)?\s*[x×X]\s*\d+(?:[.,]\d+)?(?:\s*[x×X]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m|in\.?)?)/;
const DATE_RE = /\b(?:vers\s+|c\.\s*|ca\.\s*|av\.\s*)?(1[0-9]{3}|20[0-2][0-9])(?:\s*[-–/]\s*(?:1[0-9]{3}|20[0-2][0-9]|\d{2}))?\b/;
const LIFE_RE = /\(([^)]*\b1[0-9]{3}\b[^)]*)\)/;
const INV_RE = /(?:inv(?:\.|entaire)?|n°\s*inv\.?|acc(?:ession)?\.?\s*(?:no|n°)?\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9 .\-/]{2,})/i;
const MEDIUM_RE =
  /\b(huile|tempera|détrempe|aquarelle|gouache|pastel|fusain|crayon|encre|bronze|marbre|plâtre|bois|terre cuite|céramique|acrylique|photographie|tirage|gélatino|lithographie|gravure|eau-forte|oil|canvas|panel|watercolor|marble|wood)\b/i;
const CREDIT_RE = /\b(don|legs|achat|dation|dépôt|gift|bequest|purchase|acquis)\b/i;
const MUSEUM_RE = /\b(musée|museum|museo|fondation|collection|centre pompidou|louvre|orsay)\b/i;

export function parseLabelText(raw: string): LabelFields {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1);
  const used = new Set<number>();
  const take = (re: RegExp) => {
    const i = lines.findIndex((l, idx) => !used.has(idx) && re.test(l));
    if (i < 0) return null;
    used.add(i);
    return { line: lines[i], i };
  };

  const dimsHit = take(DIM_RE);
  const dimensions = dimsHit ? dimsHit.line.match(DIM_RE)![1].trim() : null;
  const invHit = take(INV_RE);
  const inventory = invHit ? invHit.line.match(INV_RE)![1].trim() : null;
  const mediumHit = take(MEDIUM_RE);
  const creditHit = take(CREDIT_RE);
  const museumHit = take(MUSEUM_RE);

  // L'artiste figure en général sur la première ligne, souvent suivi de ses dates de vie.
  let artist: string | null = null;
  let artistDates: string | null = null;
  const firstFree = lines.findIndex((_, i) => !used.has(i));
  if (firstFree >= 0) {
    const l = lines[firstFree];
    const life = l.match(LIFE_RE);
    if (life || /^[A-ZÀ-Ý][\p{L}'’\-]+(?:\s+[A-ZÀ-Ý\p{Lu}][\p{L}'’\-]+){0,3}(?:\s*\(.*\))?$/u.test(l)) {
      artist = l.replace(LIFE_RE, '').trim().replace(/[,;]$/, '');
      artistDates = life ? life[1].trim() : null;
      used.add(firstFree);
    }
  }

  // Le titre suit l'artiste ; la date de l'œuvre est souvent sur la même ligne.
  let title: string | null = null;
  let date: string | null = null;
  const next = lines.findIndex((_, i) => !used.has(i));
  if (next >= 0) {
    const l = lines[next];
    const d = l.match(DATE_RE);
    if (d && d.index! > 0) {
      title = l.slice(0, d.index).replace(/[,;\s]+$/, '').trim() || null;
      date = d[0].trim();
    } else {
      title = l;
    }
    used.add(next);
  }
  if (!date) {
    const dHit = lines.findIndex((l, i) => !used.has(i) && DATE_RE.test(l) && l.length < 30);
    if (dHit >= 0) {
      date = lines[dHit].match(DATE_RE)![0].trim();
      used.add(dHit);
    }
  }

  const rest = lines.filter((_, i) => !used.has(i));
  const description = rest.filter((l) => l.length > 60).join(' ') || null;

  return {
    title,
    artist,
    artistDates,
    date,
    medium: mediumHit?.line ?? null,
    dimensions,
    inventory,
    institution: museumHit?.line ?? null,
    creditLine: creditHit?.line ?? null,
    description,
    rawText: lines.join('\n')
  };
}
