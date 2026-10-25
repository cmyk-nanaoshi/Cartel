import type { SourceRecord } from '../../shared/types.js';
import { clean, getJson } from './http.js';
import type { SourceAdapter } from './types.js';
import { artistMatch } from '../lib/text.js';

// Smithsonian Open Access — nécessite une clé api.data.gov gratuite (SMITHSONIAN_API_KEY).
// https://edan.si.edu/openaccess/apidocs/  Contenus Open Access sous CC0.
const BASE = 'https://api.si.edu/openaccess/api/v1.0/search';

export function smithsonianToRecord(r: any): SourceRecord | null {
  const c = r?.content;
  if (!c || !r.id) return null;
  const d = c.descriptiveNonRepeating ?? {};
  const f = c.freetext ?? {};
  const media = d.online_media?.media?.[0];
  const cc0 = media?.usage?.access === 'CC0';
  const pick = (arr: any[] | undefined, label?: RegExp) =>
    clean((arr ?? []).find((x: any) => !label || label.test(x?.label ?? ''))?.content);
  return {
    id: `smithsonian:${r.id}`,
    source: 'smithsonian',
    sourceLabel: `Smithsonian (${clean(d.data_source) ?? 'Open Access'})`,
    url: d.record_link || d.guid || `https://collections.si.edu/search/detail/${r.id}`,
    title: clean(d.title?.content) ?? clean(r.title),
    artist: pick(f.name, /artist|maker|creator|photographer|sculptor/i) ?? pick(f.name),
    date: pick(f.date),
    medium: pick(f.physicalDescription, /medium|material/i),
    dimensions: pick(f.physicalDescription, /dimension/i),
    institution: clean(d.data_source),
    inventory: pick(f.identifier, /accession|id number/i),
    credit: pick(f.creditLine),
    imageUrl: cc0 ? media?.content : undefined,
    thumbnailUrl: cc0 ? media?.thumbnail : undefined,
    imageLicense: cc0 ? 'Domaine public (Smithsonian Open Access, CC0)' : undefined
  };
}

export function makeSmithsonianAdapter(apiKey: string): SourceAdapter {
  return {
    id: 'smithsonian',
    label: 'Smithsonian Open Access',
    note: apiKey ? 'Clé api.data.gov configurée. Contenus CC0.' : 'Inactif : clé SMITHSONIAN_API_KEY absente.',
    enabled: !!apiKey,
    async search(q, http) {
      const terms = [q.title, q.artist, q.text].filter(Boolean).join(' ');
      if (!terms || !apiKey) return [];
      const url = `${BASE}?rows=6&q=${encodeURIComponent(terms)}&api_key=${encodeURIComponent(apiKey)}`;
      const res = await getJson('smithsonian', url, http);
      const recs = (res?.response?.rows ?? []).map(smithsonianToRecord).filter(Boolean) as SourceRecord[];
      const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
      return filtered.slice(0, q.limit ?? 3);
    }
  };
}
