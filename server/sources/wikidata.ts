import type { MapPlace, SourceRecord } from '../../shared/types.js';
import { getJson } from './http.js';
import type { SourceAdapter } from './types.js';
import type { HttpOptions } from './http.js';
import { artistMatch } from '../lib/text.js';

// Wikidata — données sous CC0. Images via Wikimedia Commons (licence propre à chaque fichier).
// L'API demande un User-Agent identifiable : https://meta.wikimedia.org/wiki/User-Agent_policy
const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';

const ART_TYPES = new Set([
  'Q3305213', // peinture
  'Q860861', // sculpture
  'Q838948', // œuvre d'art
  'Q125191', // photographie
  'Q93184', // dessin
  'Q11060274', // estampe
  'Q20437094', // installation
  'Q557141', // art public
  'Q4989906', // monument
  'Q179700', // statue
  'Q17514', // fresque murale (mural)
  'Q219423' // peinture murale
]);

function claimValues(entity: any, prop: string): any[] {
  return (entity?.claims?.[prop] ?? []).map((c: any) => c?.mainsnak?.datavalue?.value).filter((v: any) => v != null);
}

function label(entity: any): string | undefined {
  return entity?.labels?.fr?.value ?? entity?.labels?.en?.value;
}

function year(v: any): string | undefined {
  const t: string | undefined = v?.time;
  if (!t) return undefined;
  const m = t.match(/^([+-])(\d+)-/);
  if (!m) return undefined;
  const y = Number(m[2]);
  const precision = v.precision;
  if (precision === 7) return `${Math.floor(y / 100) + 1}e siècle`;
  if (precision === 8) return `années ${y}`;
  return m[1] === '-' ? `${y} av. J.-C.` : String(y);
}

function commons(file: string, width = 1000) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;
}

async function getEntities(ids: string[], http: HttpOptions, props = 'labels|descriptions|claims') {
  if (!ids.length) return {};
  const url = `${API}?action=wbgetentities&format=json&props=${encodeURIComponent(props)}&languages=fr|en&ids=${ids
    .slice(0, 50)
    .join('|')}`;
  const res = await getJson('wikidata', url, http);
  return res?.entities ?? {};
}

export function wikidataEntityToRecord(e: any, labels: Record<string, string>): SourceRecord {
  const q = (p: string) => claimValues(e, p).map((v) => labels[v?.id] ?? v?.id).filter(Boolean);
  const height = claimValues(e, 'P2048')[0];
  const width = claimValues(e, 'P2049')[0];
  const dims =
    height && width ? `${Number(height.amount)} × ${Number(width.amount)}${unit(height.unit)}` : undefined;
  const coord = claimValues(e, 'P625')[0];
  const image = claimValues(e, 'P18')[0];
  return {
    id: `wikidata:${e.id}`,
    source: 'wikidata',
    sourceLabel: 'Wikidata',
    url: `https://www.wikidata.org/wiki/${e.id}`,
    title: label(e),
    artist: q('P170')[0],
    date: year(claimValues(e, 'P571')[0]),
    medium: q('P186').join(', ') || undefined,
    dimensions: dims,
    institution: q('P195')[0],
    location: q('P276')[0],
    inventory: claimValues(e, 'P217')[0]?.toString?.(),
    movement: q('P135').join(', ') || undefined,
    classification: q('P31')[0],
    description: e?.descriptions?.fr?.value ?? e?.descriptions?.en?.value,
    imageUrl: image ? commons(image, 1200) : undefined,
    thumbnailUrl: image ? commons(image, 400) : undefined,
    imageLicense: image ? 'Wikimedia Commons, licence à vérifier sur la page du fichier' : undefined,
    coordinates: coord ? { lat: coord.latitude, lon: coord.longitude } : undefined
  };
}

function unit(u?: string) {
  if (!u) return '';
  if (u.endsWith('Q174728')) return ' cm';
  if (u.endsWith('Q11573')) return ' m';
  if (u.endsWith('Q174789')) return ' mm';
  return '';
}

export const wikidataAdapter: SourceAdapter = {
  id: 'wikidata',
  label: 'Wikidata',
  note: 'Données CC0. Images Wikimedia Commons, licence variable selon le fichier.',
  enabled: true,
  async search(q, http) {
    const term = q.title || q.text;
    if (!term) return [];
    const ids = new Set<string>();
    for (const lang of ['fr', 'en']) {
      const url = `${API}?action=wbsearchentities&format=json&type=item&limit=8&language=${lang}&uselang=fr&search=${encodeURIComponent(term)}`;
      const res = await getJson('wikidata', url, http);
      for (const r of res?.search ?? []) ids.add(r.id);
      if (ids.size >= 8) break;
    }
    const entities = await getEntities([...ids], http);
    const art = Object.values<any>(entities).filter((e) => {
      const types = claimValues(e, 'P31').map((v) => v.id);
      return claimValues(e, 'P170').length > 0 || types.some((t) => ART_TYPES.has(t));
    });
    const refIds = new Set<string>();
    for (const e of art)
      for (const p of ['P170', 'P186', 'P195', 'P276', 'P135', 'P31'])
        for (const v of claimValues(e, p)) if (v?.id) refIds.add(v.id);
    const refs = await getEntities([...refIds], http, 'labels');
    const labels: Record<string, string> = {};
    for (const [id, ent] of Object.entries<any>(refs)) labels[id] = label(ent) ?? id;
    const recs = art.map((e) => wikidataEntityToRecord(e, labels));
    const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
    return filtered.slice(0, q.limit ?? 3);
  }
};

/** Musées et œuvres publiques géolocalisés autour d'un point (rayon en km). */
export async function wikidataPlacesAround(lat: number, lon: number, radiusKm: number, http: HttpOptions) {
  const build = (cls: string, limit: number) => `
SELECT ?item ?itemLabel ?itemDescription ?coord ?website WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  ?item wdt:P31/wdt:P279* wd:${cls} .
  OPTIONAL { ?item wdt:P856 ?website }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
} LIMIT ${limit}`;
  const run = async (cls: string, kind: MapPlace['kind'], limit: number) => {
    const url = `${SPARQL}?format=json&query=${encodeURIComponent(build(cls, limit))}`;
    const res = await getJson('wikidata', url, { ...http, timeoutMs: Math.max(http.timeoutMs, 15000) });
    const seen = new Set<string>();
    const out: MapPlace[] = [];
    for (const b of res?.results?.bindings ?? []) {
      const id = b.item.value.split('/').pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      out.push({
        id: `wikidata:${id}`,
        name: b.itemLabel?.value ?? id,
        kind,
        lon: Number(m[1]),
        lat: Number(m[2]),
        url: `https://www.wikidata.org/wiki/${id}`,
        website: b.website?.value,
        description: b.itemDescription?.value
      });
    }
    return out;
  };
  const [museums, art] = await Promise.allSettled([
    run('Q33506', 'musee', 200),
    run('Q838948', 'oeuvre_publique', 200)
  ]);
  return [
    ...(museums.status === 'fulfilled' ? museums.value : []),
    ...(art.status === 'fulfilled' ? art.value : [])
  ];
}
