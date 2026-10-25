import type { Candidate, SourceRecord } from './types.js';

export function slugify(s: string) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function entryKey(artist: string, title: string) {
  return `${slugify(artist)}--${slugify(title)}`;
}

/** Transforme une notice de catalogue en candidat, pour ouvrir sa fiche. */
export function candidateFromRecord(r: SourceRecord): Pick<Candidate, 'key' | 'title' | 'artist' | 'date' | 'records'> {
  const artist = r.artist || 'Anonyme';
  const title = r.title || 'Sans titre';
  return { key: entryKey(artist, title), title, artist, date: r.date ?? null, records: [r] };
}
