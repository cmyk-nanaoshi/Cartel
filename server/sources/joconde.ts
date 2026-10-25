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

export function makeJocondeAdapter(base: string): SourceAdapter {
  return {
    id: 'joconde',
    label: 'Base Joconde / POP',
    note: 'Licence Ouverte 2.0. Extrait open data sans images ; lien vers la notice POP.',
    enabled: true,
    async search(q, http) {
      const where = jocondeWhere(q.title, q.artist, q.text);
      if (!where) return [];
      const url = `${base}?limit=6&where=${encodeURIComponent(where)}`;
      const res = await getJson('joconde', url, http);
      const recs = (res?.results ?? []).map(jocondeToRecord).filter(Boolean) as SourceRecord[];
      const filtered = q.artist ? recs.filter((r) => artistMatch(q.artist, r.artist) > 0) : recs;
      return filtered.slice(0, q.limit ?? 3);
    }
  };
}
