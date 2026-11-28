// Organisation de la collection : par visite, par exposition, par date.
// Une visite regroupe les œuvres photographiées le même jour au même endroit.
// Fonctions pures, sans accès à la base, pour pouvoir les tester.

import type { Observation } from '../../shared/observations';

export interface Organizable {
  id: string;
  entry: { title: string; artist: string; institution?: string | null };
  createdAt: number;
  takenAt?: number; // heure de prise de vue (photo importée), sinon heure d'ajout
  exhibition?: string;
}

export interface Visit<T extends Organizable = Organizable> {
  id: string;
  day: string; // AAAA-MM-JJ, jour local
  place: string;
  works: T[];
  exhibition?: string;
}

export interface Exhibition<T extends Organizable = Organizable> {
  name: string;
  place: string;
  works: T[];
  visitCount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Jour local (et non UTC) : une visite du soir reste sur le bon jour. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const seenAt = (a: Organizable) => a.takenAt ?? a.createdAt;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** 2026-10-12 devient « 12 octobre 2026 », « 1er » pour le premier du mois. */
export function frDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const d = Number(m[3]);
  return `${d === 1 ? '1er' : d} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

/** Dernière observation déclarée pour chaque œuvre. */
export function latestObservations(obs: Observation[]): Map<string, Observation> {
  const out = new Map<string, Observation>();
  for (const o of obs) {
    const cur = out.get(o.artworkKey);
    if (!cur || cur.updatedAt < o.updatedAt) out.set(o.artworkKey, o);
  }
  return out;
}

export const UNKNOWN_PLACE = 'Lieu non précisé';

/** Lieu d'une œuvre : celui déclaré par le visiteur, sinon l'institution du cartel. */
export function placeOf(a: Organizable, o?: Observation): string {
  if (o?.placeName?.trim()) return [o.placeName.trim(), o.city?.trim()].filter(Boolean).join(', ');
  if (o?.city?.trim()) return o.city.trim();
  return a.entry.institution?.trim() || UNKNOWN_PLACE;
}

export function exhibitionOf(a: Organizable, o?: Observation): string | undefined {
  return a.exhibition?.trim() || o?.exhibition?.trim() || undefined;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function visitId(day: string, place: string) {
  return `${day}~${norm(place).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function mostCommon(values: (string | undefined)[]): string | undefined {
  const count = new Map<string, number>();
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [k, c] of count) if (c > n) [best, n] = [k, c];
  return best;
}

/** Visites, de la plus récente à la plus ancienne ; œuvres dans l'ordre où elles ont été vues. */
export function groupVisits<T extends Organizable>(arts: T[], obs: Map<string, Observation>): Visit<T>[] {
  const map = new Map<string, Visit<T>>();
  for (const a of arts) {
    const o = obs.get(a.id);
    const day = o?.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : dayKey(seenAt(a));
    const place = placeOf(a, o);
    const id = visitId(day, place);
    const v = map.get(id) ?? { id, day, place, works: [] };
    v.works.push(a);
    map.set(id, v);
  }
  const visits = [...map.values()];
  for (const v of visits) {
    v.works.sort((x, y) => seenAt(x) - seenAt(y));
    v.exhibition = mostCommon(v.works.map((w) => exhibitionOf(w, obs.get(w.id))));
  }
  return visits.sort((a, b) => b.day.localeCompare(a.day) || seenAt(b.works[0]) - seenAt(a.works[0]));
}

/** Expositions par ordre alphabétique, puis les œuvres vues hors exposition. */
export function groupExhibitions<T extends Organizable>(
  arts: T[],
  obs: Map<string, Observation>,
  declared: string[] = []
): { exhibitions: Exhibition<T>[]; outside: T[] } {
  const visits = groupVisits(arts, obs);
  const visitOf = new Map<string, string>();
  for (const v of visits) for (const w of v.works) visitOf.set(w.id, v.id);
  const map = new Map<string, Exhibition<T> & { visits: Set<string>; places: string[] }>();
  const key = (n: string) => norm(n);
  for (const n of declared) if (n.trim() && !map.has(key(n))) map.set(key(n), { name: n.trim(), place: '', works: [], visitCount: 0, visits: new Set(), places: [] });
  const outside: T[] = [];
  for (const a of arts) {
    const o = obs.get(a.id);
    const name = exhibitionOf(a, o);
    if (!name) {
      outside.push(a);
      continue;
    }
    const e = map.get(key(name)) ?? { name, place: '', works: [], visitCount: 0, visits: new Set<string>(), places: [] };
    e.works.push(a);
    e.visits.add(visitOf.get(a.id)!);
    e.places.push(placeOf(a, o));
    map.set(key(name), e);
  }
  const exhibitions = [...map.values()]
    .map(({ visits: vs, places, ...e }) => ({
      ...e,
      place: mostCommon(places.filter((p) => p !== UNKNOWN_PLACE)) ?? '',
      visitCount: vs.size,
      works: [...e.works].sort((x, y) => seenAt(x) - seenAt(y))
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { exhibitions, outside: outside.sort((x, y) => seenAt(y) - seenAt(x)) };
}

/** Jours, du plus récent au plus ancien. */
export function groupDays<T extends Organizable>(arts: T[], obs: Map<string, Observation>): { day: string; works: T[] }[] {
  const map = new Map<string, T[]>();
  for (const a of arts) {
    const o = obs.get(a.id);
    const day = o?.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : dayKey(seenAt(a));
    map.set(day, [...(map.get(day) ?? []), a]);
  }
  return [...map.entries()]
    .map(([day, works]) => ({ day, works: works.sort((x, y) => seenAt(x) - seenAt(y)) }))
    .sort((a, b) => b.day.localeCompare(a.day));
}
