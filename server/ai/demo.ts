import type { UsageInfo, VisionAnalysis } from '../../shared/types.js';
import { AIError, type AIProvider, type JsonRequest, type StreamRequest } from './types.js';

// Fournisseur de DÉMONSTRATION : aucun modèle n'analyse l'image.
// Il renvoie toujours les mêmes hypothèses, explicitement signalées comme simulées,
// afin de tester l'interface et la vérification documentaire sans clé API.

const zero = (model = 'demo'): UsageInfo => ({ model, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });

export const DEMO_VISION: VisionAnalysis = {
  isArtwork: true,
  imageQualityIssue: null,
  objectKind: 'peinture',
  description:
    'Mode démonstration : aucune IA n’a regardé votre photo. Les hypothèses ci-dessous sont fixes et servent à tester la vérification dans les bases de musées.',
  visibleText: [],
  inscriptions: [],
  hypotheses: [
    {
      title: 'Un dimanche après-midi à l’île de la Grande Jatte',
      artist: 'Georges Seurat',
      date: '1884-1886',
      confidence: 0.62,
      reasoning: 'Hypothèse fixe du mode démonstration.',
      distinguishing: 'Hypothèse fixe du mode démonstration.'
    },
    {
      title: 'Rue de Paris, temps de pluie',
      artist: 'Gustave Caillebotte',
      date: '1877',
      confidence: 0.21,
      reasoning: 'Hypothèse fixe du mode démonstration.',
      distinguishing: 'Hypothèse fixe du mode démonstration.'
    }
  ],
  searchQueries: ['A Sunday on La Grande Jatte', 'Paris Street; Rainy Day']
};

export class DemoProvider implements AIProvider {
  name = 'demo';
  demo = true;
  models = { vision: 'demo', text: 'demo', chat: 'demo', label: 'demo' };

  async json<T>(req: JsonRequest): Promise<{ data: T; usage: UsageInfo }> {
    if (req.task === 'identify') return { data: structuredClone(DEMO_VISION) as T, usage: zero() };
    if (req.task === 'entry') return { data: { objectKind: 'peinture', movement: null, sections: [] } as T, usage: zero() };
    throw new AIError('Lecture du cartel par IA indisponible en mode démonstration.', 503, 'other');
  }

  async stream(_req: StreamRequest, onDelta: (t: string) => void): Promise<UsageInfo> {
    const text =
      'Mode démonstration : l’assistant n’est pas relié à un modèle d’IA. Ajoutez une clé ANTHROPIC_API_KEY côté serveur pour obtenir de vraies réponses, sourcées à partir des notices de cette fiche.';
    for (const word of text.split(/(?<= )/)) {
      onDelta(word);
      await new Promise((r) => setTimeout(r, 12));
    }
    return zero();
  }
}
