import type { SourceRecord } from '../../shared/types.js';
import { clean, getJson } from './http.js';
import type { SourceAdapter } from './types.js';
import { artistMatch, surname } from '../lib/text.js';

// Base Joconde (collections des musées de France), extrait publié en open data par le ministère
// de la Culture sous Licence Ouverte 2.0, mis à jour chaque semaine.
// https://www.data.gouv.fr/datasets/collections-des-musees-de-france-base-joconde
// Interrogée via l'API Explore v2.1 (Opendatasoft). L'URL de base est configurable (JOCONDE_API_BASE)
// car le jeu de données a déjà changé de domaine. L'extrait ne contient pas d'images :
// la notice POP correspondante est donnée en lien.

export function jocondeToRecord(r: any): SourceRecord | null {
  const ref = clean(r?.reference);
  if (!ref) return null;
  const museum = clean(r.nom_officiel_musee);
  const ville = clean(r.ville);
  return {
    id: `joconde:${ref}`,
    source: 'joconde',
    sourceLabel: 'Base Joconde (POP, ministère de la Culture)',
    url: `https://pop.culture.gouv.fr/notice/joconde/${encodeURIComponent(ref)}`,
    title: clean(r.titre),
    artist: clean(r.auteur),
    date: clean(r.date_creation) ?? clean(r.periode_de_creation) ?? clean(r.millesime_de_creation),
    medium: clean(r.materiaux_techniques),
    dimensions: clean(r.mesures),
    institution: museum ? (ville && !museum.includes(ville) ? `${museum}, ${ville}` : museum) : undefined,
    location: clean(r.localisation) ?? clean(r.lieu_de_depot),
    inventory: clean(r.numero_inventaire),
    classification: clean(Array.isArray(r.domaine) ? r.domaine.join(', ') : r.domaine),
    imageLicense: undefined
  };
}

export function jocondeWhere(title?: string, artist?: string, text?: string) {
  const esc = (s: string) => s.replace(/["\\]/g, ' ').trim();
  const parts: string[] = [];
  if (title) parts.push(`"${esc(title)}"`);
  if (text) parts.push(`"${esc(text)}"`);
  const sn = surname(artist);
  if (sn) parts.push(`auteur like "${esc(sn)}"`);
  return parts.join(' AND ');
}

// L'ancienne API Opendatasoft du ministère a fermé (data.culture.gouv.fr redirige vers
// culture.data.gouv.fr). On interroge désormais l'API tabulaire de data.gouv.fr sur le CSV de la base,
// mis à jour chaque semaine. Les colonnes y sont en casse mixte (Auteur, Titre…) : on les passe en
// minuscules pour réutiliser jocondeToRecord. Attention, Date_creation y est la date de la notice,
// pas celle de l'œuvre.
export const JOCONDE_TABULAR = 'https://tabular-api.data.gouv.fr/api/resources/7e3307c2-f2ff-455c-bbca-bb6f11aec7bb/data/';

/** Mot le plus distinctif d'un titre, pour un filtre « contient » robuste aux articles et à la casse. */
export function titleKeyword(title?: string) {
  if (!title) return '';
  const stop = new Set(['les', 'des', 'une', 'the', 'and', 'dans', 'avec', 'pour', 'sur', 'aux', 'du', 'de', 'la', 'le', 'un', 'et', 'of', 'en']);
  const words = title
    .replace(/[«»"“”’'(),.;:!?]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  return words.sort((a, b) => b.length - a.length)[0] ?? '';
}

export function tabularRow(r: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(r ?? {})) out[k.toLowerCase()] = v;
  delete out.date_creation;
  return out;
}

export function makeJocondeAdapter(_base?: string): SourceAdapter {
  return {
    id: 'joconde',
    label: 'Base Joconde / POP',
    note: 'En pause : l’API tabulaire de data.gouv.fr met plus de 14 s à répondre sur cette base. À remplacer par un index local de la base.',
    // Désactivée tant qu'elle ralentit chaque analyse sans répondre à temps (mesuré le 11 novembre 2026).
    enabled: false,
    async search(q, http) {
      const sn = surname(q.artist).toUpperCase();
      const kw = titleKeyword(q.title ?? q.text);
      if (!sn && !kw) return [];
      const run = async (params: Record<string, string>) => {
        const qs = new URLSearchParams({ ...params, page_size: '20' }).toString();
        // L'API tabulaire répond en 6 à 11 s sur cette base de 1,2 Go : délai propre, plus long.
        const res = await getJson('joconde', `${JOCONDE_TABULAR}?${qs}`, { ...http, timeoutMs: Math.max(http.timeoutMs, 14000) });
        return ((res?.data ?? []).map((r: any) => jocondeToRecord(tabularRow(r))).filter(Boolean) as SourceRecord[]);
      };
      // Une seule requête, la plus précise possible, vu la lenteur de l'API.
      const params: Record<string, string> = {};
      if (sn) params.Auteur__contains = sn;
      if (kw) params.Titre__contains = kw;
      const recs = await run(params);
      const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
      return filtered.slice(0, q.limit ?? 3);
    }
  };
}
