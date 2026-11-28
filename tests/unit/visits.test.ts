import { describe, expect, it } from 'vitest';
import { dayKey, frDay, groupDays, groupExhibitions, groupVisits, latestObservations, placeOf, plural } from '../../src/lib/visits';
import type { Observation } from '../../shared/observations';

const at = (s: string) => new Date(s).getTime();
const art = (id: string, when: string, institution: string | null = 'Art Institute of Chicago', extra: object = {}) => ({
  id,
  entry: { title: 'T' + id, artist: 'A' + id, institution },
  createdAt: at(when),
  ...extra
});
const obs = (artworkKey: string, o: Partial<Observation>): Observation => ({
  id: 'o' + artworkKey,
  artworkKey,
  artworkTitle: '',
  artworkArtist: '',
  kind: 'musee',
  placeName: '',
  city: '',
  date: '',
  visibility: 'prive',
  createdAt: 0,
  updatedAt: 1,
  ...o
});

describe('organisation de la collection', () => {
  it('écrit les jours en toutes lettres', () => {
    expect(frDay('2026-10-12')).toBe('12 octobre 2026');
    expect(frDay('2026-11-01')).toBe('1er novembre 2026');
    expect(plural(1, 'œuvre')).toBe('1 œuvre');
    expect(plural(5, 'œuvre')).toBe('5 œuvres');
  });

  it('prend le jour local, pas le jour UTC', () => {
    const d = new Date(2026, 9, 12, 23, 30);
    expect(dayKey(d.getTime())).toBe('2026-10-12');
  });

  it('regroupe par jour et par lieu, la visite la plus récente en premier', () => {
    const list = [
      art('1', '2026-10-12T10:00'),
      art('2', '2026-10-12T11:00'),
      art('3', '2026-10-04T15:00'),
      art('4', '2026-10-12T16:00', 'Musée d’Orsay')
    ];
    const v = groupVisits(list, new Map());
    expect(v.map((x) => [x.day, x.place, x.works.map((w) => w.id)])).toEqual([
      ['2026-10-12', 'Musée d’Orsay', ['4']],
      ['2026-10-12', 'Art Institute of Chicago', ['1', '2']],
      ['2026-10-04', 'Art Institute of Chicago', ['3']]
    ]);
  });

  it('préfère le lieu et la date déclarés par le visiteur', () => {
    const a = art('1', '2026-10-12T10:00', null);
    const o = obs('1', { placeName: 'Art Institute', city: 'Chicago', date: '2026-10-11' });
    expect(placeOf(a, o)).toBe('Art Institute, Chicago');
    const v = groupVisits([a], latestObservations([o]));
    expect(v[0].day).toBe('2026-10-11');
    expect(placeOf(art('2', '2026-10-12T10:00', null))).toBe('Lieu non précisé');
  });

  it('utilise l’heure de prise de vue d’une photo importée', () => {
    const a = art('1', '2026-11-20T10:00', 'X', { takenAt: at('2026-10-04T15:00') });
    expect(groupVisits([a], new Map())[0].day).toBe('2026-10-04');
  });

  it('regroupe les expositions sur plusieurs visites et met le reste hors exposition', () => {
    const list = [
      art('1', '2026-10-12T10:00', 'Art Institute of Chicago', { exhibition: 'Estampes japonaises' }),
      art('2', '2026-10-12T11:00'),
      art('3', '2026-10-04T15:00', 'Art Institute of Chicago', { exhibition: 'Estampes japonaises' })
    ];
    const { exhibitions, outside } = groupExhibitions(list, new Map(), ['Vide']);
    expect(exhibitions.map((e) => [e.name, e.works.length, e.visitCount, e.place])).toEqual([
      ['Estampes japonaises', 2, 2, 'Art Institute of Chicago'],
      ['Vide', 0, 0, '']
    ]);
    expect(outside.map((a) => a.id)).toEqual(['2']);
    expect(groupVisits(list, new Map()).find((v) => v.day === '2026-10-04')?.exhibition).toBe('Estampes japonaises');
  });

  it('classe par jour', () => {
    const d = groupDays([art('1', '2026-10-04T10:00'), art('2', '2026-10-12T10:00'), art('3', '2026-10-12T09:00')], new Map());
    expect(d.map((x) => [x.day, x.works.map((w) => w.id)])).toEqual([
      ['2026-10-12', ['3', '2']],
      ['2026-10-04', ['1']]
    ]);
  });
});
