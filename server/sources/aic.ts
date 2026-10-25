import type { SourceRecord } from '../../shared/types.js';
import { clean, getJson } from './http.js';
import type { SourceAdapter } from './types.js';
import { artistMatch } from '../lib/text.js';

// Art Institute of Chicago API — sans clé. Données sous CC0, images IIIF.
// Doc : https://api.artic.edu/docs/  (l'AIC demande un en-tête AIC-User-Agent identifiable)
const BASE = 'https://api.artic.edu/api/v1';
export const AIC_FIELDS = [
  'id', 'title', 'artist_display', 'artist_title', 'date_display', 'medium_display', 'dimensions',
  'credit_line', 'place_of_origin', 'image_id', 'is_public_domain', 'main_reference_number',
  'style_title', 'classification_title', 'short_description', 'gallery_title'
].join(',');

export function aicToRecord(a: any): SourceRecord | null {
  if (!a || !a.id) return null;
  const img = a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg` : undefined;
  const thumb = a.image_id ? `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg` : undefined;
  return {
    id: `aic:${a.id}`,
    source: 'aic',
    sourceLabel: 'Art Institute of Chicago',
    url: `https://www.artic.edu/artworks/${a.id}`,
    title: clean(a.title),
    artist: clean(a.artist_title) ?? clean(a.artist_display?.split('\n')[0]),
    artistBio: clean(a.artist_display),
    date: clean(a.date_display),
    medium: clean(a.medium_display),
    dimensions: clean(a.dimensions),
    institution: 'Art Institute of Chicago',
    location: clean(a.gallery_title),
    inventory: clean(a.main_reference_number),
    movement: clean(a.style_title),
    classification: clean(a.classification_title),
    description: clean(a.short_description),
    credit: clean(a.credit_line),
    // Les images sous droits ne sont affichées qu'en vignette de repérage.
    imageUrl: a.is_public_domain ? img : undefined,
    thumbnailUrl: thumb,
    imageLicense: a.is_public_domain ? 'Domaine public (Art Institute of Chicago, CC0)' : 'Image sous droits, affichage limité'
  };
}

export const aicAdapter: SourceAdapter = {
  id: 'aic',
  label: 'Art Institute of Chicago',
  note: 'API publique sans clé, données CC0. Images IIIF, domaine public signalé par is_public_domain.',
  enabled: true,
  async search(q, http) {
    const terms = [q.title, q.artist, q.text].filter(Boolean).join(' ').trim();
    if (!terms) return [];
    const url = `${BASE}/artworks/search?q=${encodeURIComponent(terms)}&limit=6&fields=${AIC_FIELDS}`;
    const res = await getJson('aic', url, { ...http, headers: { 'AIC-User-Agent': http.userAgent } });
    const recs = (res?.data ?? []).map(aicToRecord).filter(Boolean) as SourceRecord[];
    const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
    return filtered.slice(0, q.limit ?? 3);
  }
};

/** Œuvres au hasard dans le domaine public (pour l'écran Découvrir). */
export async function aicRandom(http: Parameters<SourceAdapter['search']>[1], count = 12): Promise<SourceRecord[]> {
  const page = 1 + Math.floor(Math.random() * 80);
  const params = {
    query: { bool: { must: [{ term: { is_public_domain: true } }, { exists: { field: 'image_id' } }] } },
    limit: count,
    from: (page - 1) * count,
    fields: AIC_FIELDS.split(',')
  };
  const url = `${BASE}/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`;
  const res = await getJson('aic', url, { ...http, headers: { 'AIC-User-Agent': http.userAgent } });
  return (res?.data ?? []).map(aicToRecord).filter((r: SourceRecord | null) => r?.imageUrl) as SourceRecord[];
}
