// Le cartel fait foi, la photo du visiteur passe en premier, aucune suggestion sans image,
// typographie française.
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { frTypo } from '../../shared/typo';
import {
  applyLabelToHypotheses,
  baseEntry,
  labelRecord,
  normalizeSections,
  sanitizeVision
} from '../../server/pipeline/services';
import { allowedImageUrl } from '../../server/pipeline/visual';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { Cache } from '../../server/lib/cache';
import { sourcesBlock } from '../../server/ai/prompts';
import type { LabelFields, SourceRecord } from '../../shared/types';

const NB = ' ';
const FINE = ' ';

describe('typographie française', () => {
  it('place les espaces insécables et ne laisse pas un point-virgule en début de ligne', () => {
    expect(frTypo('japonais ; l’Art Institute')).toBe(`japonais${FINE}; l’Art Institute`);
    expect(frTypo('japonais; vraiment?')).toBe(`japonais${FINE}; vraiment${FINE}?`);
    expect(frTypo('« La Grande Vague »')).toBe(`«${NB}La Grande Vague${NB}»`);
    expect(frTypo('«La Grande Vague»')).toBe(`«${NB}La Grande Vague${NB}»`);
    expect(frTypo('Image : Domaine public')).toBe(`Image${NB}: Domaine public`);
  });
  it('ne touche ni aux URL, ni aux heures, ni aux ratios', () => {
    expect(frTypo('https://api.artic.edu/x?q=1')).toBe('https://api.artic.edu/x?q=1');
    expect(frTypo('à 15:58, format 4:3')).toBe('à 15:58, format 4:3');
  });
});

const greatWaveLabel: LabelFields = {
  title: "Au revers d'une vague au large de Kanagawa (dite « La Grande Vague »)",
  artist: 'Katsushika Hokusai',
  artistDates: '(Japon, 1760-1849)',
  date: 'Vers le début de l’ère Tenpō (vers 1830-1834)',
  medium: 'Estampe nishiki-e, format ōban',
  dimensions: null,
  inventory: null,
  institution: null,
  creditLine: null,
  description: null,
  rawText: 'Katsushika Hokusai\nAu revers d’une vague…'
};

const aicRecord: SourceRecord = {
  id: 'aic:24645',
  source: 'aic',
  sourceLabel: 'Art Institute of Chicago',
  url: 'https://www.artic.edu/artworks/24645',
  title: 'Under the Wave off Kanagawa',
  artist: 'Katsushika Hokusai',
  artistBio: 'Katsushika Hokusai 葛飾 北斎 Japanese, 1760-1849',
  date: '1830–33',
  medium: 'Color woodblock print; oban',
  dimensions: '25.4 × 37.6 cm',
  institution: 'Art Institute of Chicago',
  inventory: '1925.3245',
  imageUrl: 'https://www.artic.edu/iiif/2/abc/full/843,/0/default.jpg',
  imageLicense: 'Domaine public (Art Institute of Chicago, CC0)'
};

describe('le cartel fait foi', () => {
  it('devient une source citable, placée en tête et signalée au modèle', () => {
    const rec = labelRecord(greatWaveLabel)!;
    expect(rec.source).toBe('cartel');
    expect(rec.medium).toBe('Estampe nishiki-e, format ōban');
    const { text, ids } = sourcesBlock([rec, aicRecord]);
    expect(ids.get('S1')).toBe(rec.id);
    expect(text).toContain('fait foi');
  });

  it('une phrase tirée du cartel est un fait sourcé, jamais « non sourcé »', () => {
    const rec = labelRecord(greatWaveLabel)!;
    const ids = new Map([['S1', rec.id], ['S2', aicRecord.id]]);
    const out = normalizeSections(
      [
        {
          id: 'technique',
          claims: [
            { text: 'Estampe nishiki-e au format ōban.', kind: 'fait', sources: ['S1'] },
            { text: 'La vague occupe la gauche de la feuille.', kind: 'observation', sources: [] }
          ]
        }
      ],
      ids
    );
    const [fact, obs] = out[0].claims;
    expect(fact).toMatchObject({ kind: 'fait', sources: [rec.id] });
    expect(fact.unsourced).toBeUndefined();
    expect(obs).toMatchObject({ kind: 'observation', sources: [] });
    expect(obs.unsourced).toBeUndefined();
  });

  it('la fiche de base lit la technique et la date sur le cartel avant la notice anglaise', () => {
    const rec = labelRecord(greatWaveLabel)!;
    const e = baseEntry(
      { key: 'k', title: 'La Grande Vague', artist: 'Katsushika Hokusai', date: '1831', records: [aicRecord] },
      [rec, aicRecord],
      [],
      { candidate: { key: 'k', title: 'La Grande Vague', artist: 'Katsushika Hokusai', date: '1831', records: [aicRecord] }, label: greatWaveLabel },
      { name: 'demo', demo: true } as any
    );
    expect(e.technique).toBe('Estampe nishiki-e, format ōban');
    expect(e.date).toBe('Vers le début de l’ère Tenpō (vers 1830-1834)');
    expect(e.artistLine).toBe('Japon, 1760-1849');
    expect(e.inventory).toBe('1925.3245');
    // L'image de la fiche ne vient jamais du cartel.
    expect(e.imageUrl).toBe(aicRecord.imageUrl);
  });

  it('un cartel lisible sur la photo place son œuvre en tête des hypothèses', () => {
    const v = sanitizeVision({
      isArtwork: true,
      label: { ...greatWaveLabel, title: 'Le Fuji rouge', artist: 'Katsushika Hokusai' },
      objectKind: 'estampe',
      description: '',
      visibleText: [],
      inscriptions: [],
      hypotheses: [
        { title: 'La Grande Vague', artist: 'Hiroshige', date: null, confidence: 0.6, reasoning: 'vague', distinguishing: '' }
      ],
      searchQueries: []
    });
    const hyps = applyLabelToHypotheses(v);
    expect(hyps[0]).toMatchObject({ title: 'Le Fuji rouge', artist: 'Katsushika Hokusai', confidence: 0.9 });
    expect(hyps[1].artist).toBe('Hiroshige');
  });

  it('sans cartel, rien ne change', () => {
    const v = sanitizeVision({ isArtwork: true, label: null, hypotheses: [], searchQueries: [] });
    expect(v.label).toBeNull();
    expect(applyLabelToHypotheses(v)).toEqual([]);
  });
});

describe('images de musées', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('le relais n’accepte que les hôtes de musées en https', () => {
    expect(allowedImageUrl('https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg')).not.toBeNull();
    expect(allowedImageUrl('https://images.metmuseum.org/a.jpg')).not.toBeNull();
    expect(allowedImageUrl('https://upload.wikimedia.org/a.jpg')).not.toBeNull();
    expect(allowedImageUrl('http://www.artic.edu/a.jpg')).toBeNull();
    expect(allowedImageUrl('https://evil.example/artic.edu.jpg')).toBeNull();
    expect(allowedImageUrl('https://artic.edu.evil.example/a.jpg')).toBeNull();
    expect(allowedImageUrl('http://169.254.169.254/')).toBeNull();
  });

  it('relaie une image autorisée et refuse les autres', async () => {
    const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#00544c' } }).png().toBuffer();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(png), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createApp({ cfg: { ...loadConfig(), accessCode: 'secret' }, cache: new Cache(null) });
    const u = encodeURIComponent('https://www.artic.edu/iiif/2/x/full/400,/0/default.jpg');
    const ok = await app.request(`/api/img?u=${u}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    // L'AIC demande un en-tête identifiable.
    const headers = (fetchMock.mock.calls[0] as any)[1].headers;
    expect(headers['AIC-User-Agent']).toMatch(/Cartel/);
    const bad = await app.request(`/api/img?u=${encodeURIComponent('https://example.com/a.jpg')}`);
    expect(bad.status).toBe(400);
  });

  it('écarte des suggestions « du même artiste » toute œuvre dont l’image ne se charge pas', async () => {
    const good = await sharp({ create: { width: 200, height: 260, channels: 3, background: '#cccccc' } }).jpeg().toBuffer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes('api.artic.edu')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 1, title: 'Shower Below the Summit', artist_title: 'Katsushika Hokusai', image_id: 'good', is_public_domain: true },
                { id: 2, title: 'Fine Wind, Clear Morning', artist_title: 'Katsushika Hokusai', image_id: 'broken', is_public_domain: true },
                { id: 3, title: 'Sans image', artist_title: 'Katsushika Hokusai', image_id: null, is_public_domain: true }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (url.includes('/iiif/2/good/')) return new Response(new Uint8Array(good), { status: 200 });
        if (url.includes('/iiif/2/broken/')) return new Response('forbidden', { status: 403 });
        return new Response('{}', { status: 404 });
      })
    );
    const prev = { ...process.env };
    Object.assign(process.env, { AI_PROVIDER: 'demo', SOURCES_DISABLED: 'met,wikidata,joconde,rijksmuseum,smithsonian' });
    const cfg = loadConfig();
    process.env = prev;
    const { svc } = createApp({ cfg, cache: new Cache(null) });
    const e = await svc.entry({
      candidate: { key: 'hokusai--vague', title: 'Under the Wave off Kanagawa', artist: 'Katsushika Hokusai', date: null, records: [] }
    });
    expect(e.comparables.map((c) => c.title)).toEqual(['Shower Below the Summit']);
  });
});
