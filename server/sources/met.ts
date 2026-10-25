import type { SourceRecord } from '../../shared/types.js';
import { clean, getJson } from './http.js';
import type { SourceAdapter } from './types.js';
import { artistMatch } from '../lib/text.js';

// Metropolitan Museum of Art Collection API — sans clé.
// Doc : https://metmuseum.github.io/  Données Open Access sous CC0 (champ isPublicDomain).
const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export function metObjectToRecord(o: any): SourceRecord | null {
  if (!o || !o.objectID) return null;
  return {
    id: `met:${o.objectID}`,
    source: 'met',
    sourceLabel: 'The Metropolitan Museum of Art',
    url: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
    title: clean(o.title),
    artist: clean(o.artistDisplayName),
    artistBio: clean(o.artistDisplayBio),
    date: clean(o.objectDate),
    medium: clean(o.medium),
    dimensions: clean(o.dimensions),
    institution: 'The Metropolitan Museum of Art, New York',
    location: clean(o.repository),
    inventory: clean(o.accessionNumber),
    classification: clean(o.classification),
    movement: clean(o.period) ?? undefined,
    credit: clean(o.creditLine),
    imageUrl: o.isPublicDomain ? o.primaryImage || undefined : undefined,
    thumbnailUrl: o.isPublicDomain ? o.primaryImageSmall || undefined : undefined,
    imageLicense: o.isPublicDomain ? 'Domaine public (Met Open Access, CC0)' : undefined
  };
}

export const metAdapter: SourceAdapter = {
  id: 'met',
  label: 'The Metropolitan Museum of Art',
  note: 'API publique sans clé. Images Open Access en CC0 uniquement.',
  enabled: true,
  async search(q, http) {
    const terms = [q.title, q.text].filter(Boolean).join(' ').trim() || q.artist;
    if (!terms) return [];
    const s = await getJson('met', `${BASE}/search?hasImages=true&q=${encodeURIComponent(terms)}`, http);
    const ids: number[] = (s?.objectIDs ?? []).slice(0, 6);
    const objs = await Promise.allSettled(ids.map((id) => getJson('met', `${BASE}/objects/${id}`, http)));
    const recs = objs
      .map((r) => (r.status === 'fulfilled' ? metObjectToRecord(r.value) : null))
      .filter((r): r is SourceRecord => !!r);
    const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
    return filtered.slice(0, q.limit ?? 3);
  }
};
