import type { SourceRecord } from '../../shared/types.js';
import type { SourceAdapter } from './types.js';
import { recordTextScore, tokenSimilarity } from '../lib/text.js';

// Données de DÉMONSTRATION utilisées uniquement quand SOURCES_OFFLINE=1 (tests, environnement sans réseau).
// Elles reprennent les cartels publiés par l'Art Institute of Chicago pour deux œuvres, sans image.
export const FIXTURE_RECORDS: SourceRecord[] = [
  {
    id: 'fixture:aic-27992',
    source: 'fixture',
    sourceLabel: 'Démo hors ligne (d’après la notice de l’Art Institute of Chicago)',
    url: 'https://www.artic.edu/artworks/27992',
    title: 'A Sunday on La Grande Jatte — 1884',
    artist: 'Georges Seurat',
    artistBio: 'Georges Seurat (French, 1859–1891)',
    date: '1884–86',
    medium: 'Oil on canvas',
    dimensions: '207.5 × 308.1 cm',
    institution: 'Art Institute of Chicago',
    inventory: '1926.224',
    movement: 'Post-Impressionism',
    classification: 'painting',
    credit: 'Helen Birch Bartlett Memorial Collection'
  },
  {
    id: 'fixture:aic-20684',
    source: 'fixture',
    sourceLabel: 'Démo hors ligne (d’après la notice de l’Art Institute of Chicago)',
    url: 'https://www.artic.edu/artworks/20684',
    title: 'Paris Street; Rainy Day',
    artist: 'Gustave Caillebotte',
    artistBio: 'Gustave Caillebotte (French, 1848–1894)',
    date: '1877',
    medium: 'Oil on canvas',
    dimensions: '212.2 × 276.2 cm',
    institution: 'Art Institute of Chicago',
    inventory: '1964.336',
    movement: 'Impressionism',
    classification: 'painting',
    credit: 'Charles H. and Mary F. S. Worcester Collection'
  }
];

export const fixtureAdapter: SourceAdapter = {
  id: 'fixture',
  label: 'Démo hors ligne',
  note: 'Notices de démonstration, utilisées uniquement sans réseau.',
  enabled: true,
  async search(q) {
    return FIXTURE_RECORDS.filter((r) =>
      q.title || q.artist
        ? recordTextScore({ title: q.title ?? '', artist: q.artist ?? '' }, r) > 0.3
        : tokenSimilarity(q.text, `${r.title} ${r.artist} ${r.movement}`) > 0
    ).slice(0, q.limit ?? 3);
  }
};
