// Tarifs publics en USD par million de tokens, relevés le 25 octobre 2026 sur
// https://platform.claude.com/docs/en/about-claude/pricing
// À mettre à jour si les tarifs changent. Les modèles inconnus sont estimés au tarif le plus élevé connu.

const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }, // requêtes ≤ 100k tokens
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Valeurs indicatives pour le fournisseur alternatif, à vérifier sur la page tarifaire du fournisseur.
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  demo: { input: 0, output: 0 }
};

const FALLBACK = { input: 10, output: 50 };

export function priceFor(model: string) {
  return PRICES[model] ?? FALLBACK;
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Fourchette indicative pour un scan complet (identification + rédaction de la fiche). */
export function scanCostRange(visionModel: string, textModel: string) {
  // Image ~1 600 tokens visuels (1568 px de grand côté) + consignes ~1 500 ; sortie 800 à 3 000 (réflexion comprise).
  const identifyLow = estimateCost(visionModel, 3000, 800);
  const identifyHigh = estimateCost(visionModel, 3500, 3000);
  // Fiche : notices ~3 000 tokens + consignes ~1 500 ; sortie 2 500 à 7 000.
  const entryLow = estimateCost(textModel, 4500, 2500);
  const entryHigh = estimateCost(textModel, 6000, 7000);
  return { low: round(identifyLow + entryLow), high: round(identifyHigh + entryHigh) };
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}
