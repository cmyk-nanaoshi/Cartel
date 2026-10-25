import type { Candidate, IdentifyStatus, SourceRecord, VisionHypothesis } from '../../shared/types.js';
import { recordTextScore, slug } from '../lib/text.js';

export const TEXT_MATCH_MIN = 0.45;

/**
 * Confiance combinée d'une hypothèse.
 * - model : confiance auto-évaluée par le modèle (prudente mais faillible) ;
 * - text : concordance titre/artiste avec la meilleure notice trouvée ;
 * - visual : ressemblance avec l'image de la notice, si disponible.
 * Sans notice concordante, la confiance est plafonnée : l'œuvre n'est pas vérifiée.
 */
export function combineConfidence(model: number, text: number | null, visual: number | null): number {
  const m = clamp(model);
  if (text === null || text < TEXT_MATCH_MIN) return Math.min(0.55, 0.7 * m);
  if (visual === null) return clamp(0.6 * m + 0.4 * text);
  // Une très faible ressemblance visuelle avec une reproduction pénalise l'hypothèse.
  const v = clamp(visual);
  return clamp(0.45 * m + 0.3 * text + 0.25 * v);
}

export function confidenceLabel(c: number): Candidate['confidenceLabel'] {
  return c >= 0.75 ? 'élevée' : c >= 0.45 ? 'moyenne' : 'faible';
}

export function rankRecords(h: VisionHypothesis, records: SourceRecord[]) {
  return records
    .map((r) => ({ r, score: recordTextScore({ title: h.title, artist: h.artist }, r) }))
    .filter((x) => x.score >= TEXT_MATCH_MIN)
    .sort((a, b) => b.score - a.score || (b.r.imageUrl ? 1 : 0) - (a.r.imageUrl ? 1 : 0));
}

export function buildCandidate(
  h: VisionHypothesis,
  matched: { r: SourceRecord; score: number }[],
  visual: number | null
): Candidate {
  const text = matched.length ? matched[0].score : null;
  const confidence = Math.round(combineConfidence(h.confidence, text, visual) * 100) / 100;
  const withImage = matched.find((m) => m.r.imageUrl || m.r.thumbnailUrl)?.r;
  return {
    key: `${slug(h.artist)}--${slug(h.title)}`,
    title: h.title,
    artist: h.artist,
    date: h.date,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    verified: matched.length > 0,
    signals: {
      model: h.confidence,
      text: text === null ? null : Math.round(text * 100) / 100,
      visual: visual === null ? null : Math.round(visual * 100) / 100,
      sourcesFound: matched.length
    },
    reasoning: h.reasoning,
    distinguishing: h.distinguishing,
    records: matched.map((m) => m.r),
    imageUrl: withImage?.imageUrl ?? withImage?.thumbnailUrl
  };
}

export function decideStatus(candidates: Candidate[]): IdentifyStatus {
  if (!candidates.length) return 'uncertain';
  const [a, b] = candidates;
  if (a.confidence >= 0.75 && a.verified && (!b || a.confidence - b.confidence >= 0.2)) return 'identified';
  if (b && b.confidence >= 0.4 && a.confidence - b.confidence < 0.2) return 'ambiguous';
  if (a.confidence >= 0.6) return 'identified';
  return 'uncertain';
}

function clamp(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
