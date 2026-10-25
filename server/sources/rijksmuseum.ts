import type { SourceRecord } from '../../shared/types.js';
import { getJson } from './http.js';
import type { SourceAdapter } from './types.js';

// Rijksmuseum Data Services — API de recherche sans clé (format Linked Art).
// https://data.rijksmuseum.nl/tutorials/search/
// La recherche renvoie des identifiants ; chaque objet est résolu en JSON-LD (profil « la-framed »).
// L'analyse du Linked Art est tolérante : les champs absents sont simplement omis.
const SEARCH = 'https://data.rijksmuseum.nl/search/collection';

function firstContent(list: any[] | undefined, type?: string): string | undefined {
  for (const it of list ?? []) {
    if (type && it?.type !== type) continue;
    if (typeof it?.content === 'string' && it.content.trim()) return it.content.trim();
  }
  return undefined;
}

export function linkedArtToRecord(o: any, id: string): SourceRecord | null {
  if (!o) return null;
  const names = (o.identified_by ?? []).filter((x: any) => x?.type === 'Name');
  const title =
    names.find((n: any) => (n.language ?? []).some((l: any) => /dutch|nl|english|en/i.test(l?._label ?? l?.id ?? '')))
      ?.content ?? firstContent(names);
  const inventory = firstContent(o.identified_by, 'Identifier');
  const prod = o.produced_by ?? {};
  const parts = [prod, ...(prod.part ?? [])];
  let artist: string | undefined;
  for (const p of parts) {
    const who = (p.carried_out_by ?? [])[0];
    const n = who?._label ?? firstContent(who?.identified_by, 'Name');
    if (n) {
      artist = n;
      break;
    }
  }
  const date = firstContent(prod?.timespan?.identified_by) ?? prod?.timespan?._label;
  const native = id.split('/').pop()!;
  return {
    id: `rijksmuseum:${native}`,
    source: 'rijksmuseum',
    sourceLabel: 'Rijksmuseum',
    url: inventory ? `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(inventory)}` : id,
    title,
    artist,
    date,
    institution: 'Rijksmuseum, Amsterdam',
    inventory
  };
}

export const rijksAdapter: SourceAdapter = {
  id: 'rijksmuseum',
  label: 'Rijksmuseum',
  note: 'API sans clé (Linked Art). Intégration expérimentale : pas encore d’images.',
  enabled: true,
  async search(q, http) {
    if (!q.title && !q.artist) return [];
    const params = new URLSearchParams();
    if (q.title) params.set('title', q.title);
    if (q.artist) params.set('creator', q.artist);
    const res = await getJson('rijksmuseum', `${SEARCH}?${params}`, http);
    const ids: string[] = (res?.orderedItems ?? []).map((i: any) => i?.id).filter(Boolean).slice(0, q.limit ?? 3);
    const objs = await Promise.allSettled(
      ids.map((id) => getJson('rijksmuseum', `${id}?_profile=la-framed`, { ...http, headers: { Accept: 'application/ld+json' } }))
    );
    return objs
      .map((r, i) => (r.status === 'fulfilled' ? linkedArtToRecord(r.value, ids[i]) : null))
      .filter((r): r is SourceRecord => !!r && !!r.title);
  }
};
