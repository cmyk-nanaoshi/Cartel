// Tests des adaptateurs documentaires sur des réponses construites d'après la documentation
// publique de chaque API (les serveurs réels ne sont pas joignables depuis l'environnement de test).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metAdapter, metObjectToRecord } from '../../server/sources/met';
import { aicAdapter, aicToRecord } from '../../server/sources/aic';
import { wikidataEntityToRecord } from '../../server/sources/wikidata';
import { jocondeToRecord, jocondeWhere, makeJocondeAdapter } from '../../server/sources/joconde';
import { smithsonianToRecord } from '../../server/sources/smithsonian';
import { linkedArtToRecord } from '../../server/sources/rijksmuseum';

const http = { timeoutMs: 1000, userAgent: 'test' };

afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: [RegExp, unknown][]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

describe('Met', () => {
  const obj = {
    objectID: 436535,
    title: 'Wheat Field with Cypresses',
    artistDisplayName: 'Vincent van Gogh',
    artistDisplayBio: 'Dutch, Zundert 1853–1890 Auvers-sur-Oise',
    objectDate: '1889',
    medium: 'Oil on canvas',
    dimensions: '28 3/4 × 36 3/4 in. (73 × 93.4 cm)',
    accessionNumber: '1993.132',
    creditLine: 'Purchase, The Annenberg Foundation Gift, 1993',
    objectURL: 'https://www.metmuseum.org/art/collection/search/436535',
    primaryImage: 'https://images.metmuseum.org/x.jpg',
    primaryImageSmall: 'https://images.metmuseum.org/x-small.jpg',
    isPublicDomain: true,
    repository: 'Metropolitan Museum of Art, New York, NY'
  };
  it('convertit une notice', () => {
    const r = metObjectToRecord(obj)!;
    expect(r).toMatchObject({ id: 'met:436535', artist: 'Vincent van Gogh', inventory: '1993.132', imageLicense: expect.stringContaining('CC0') });
  });
  it('n’expose pas d’image hors domaine public', () => {
    expect(metObjectToRecord({ ...obj, isPublicDomain: false })!.imageUrl).toBeUndefined();
  });
  it('recherche puis filtre par artiste', async () => {
    const calls = mockFetch([
      [/search\?hasImages=true&q=Wheat/, { total: 2, objectIDs: [436535, 1] }],
      [/objects\/436535/, obj],
      [/objects\/1$/, { ...obj, objectID: 1, artistDisplayName: 'Someone Else' }]
    ]);
    const recs = await metAdapter.search({ title: 'Wheat Field with Cypresses', artist: 'Van Gogh' }, http);
    expect(recs.map((r) => r.id)).toEqual(['met:436535']);
    expect(calls[0]).toContain('collectionapi.metmuseum.org');
  });
});

describe('Art Institute of Chicago', () => {
  const a = {
    id: 27992,
    title: 'A Sunday on La Grande Jatte — 1884',
    artist_title: 'Georges Seurat',
    artist_display: 'Georges Seurat\nFrench, 1859-1891',
    date_display: '1884–86',
    medium_display: 'Oil on canvas',
    dimensions: '207.5 × 308.1 cm (81 3/4 × 121 1/4 in.)',
    image_id: 'abc',
    is_public_domain: true,
    main_reference_number: '1926.224',
    style_title: 'Post-Impressionism'
  };
  it('construit les URL IIIF', () => {
    const r = aicToRecord(a)!;
    expect(r.imageUrl).toBe('https://www.artic.edu/iiif/2/abc/full/843,/0/default.jpg');
    expect(r.url).toBe('https://www.artic.edu/artworks/27992');
  });
  it('envoie l’en-tête AIC-User-Agent', async () => {
    const seen: any[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: any) => {
      seen.push(init.headers);
      return new Response(JSON.stringify({ data: [a] }));
    });
    const recs = await aicAdapter.search({ title: 'Grande Jatte', artist: 'Seurat' }, http);
    expect(recs).toHaveLength(1);
    expect(seen[0]['AIC-User-Agent']).toBe('test');
  });
});

describe('Wikidata', () => {
  it('lit les propriétés principales d’une entité', () => {
    const v = (value: any) => ({ mainsnak: { datavalue: { value } } });
    const e = {
      id: 'Q12418',
      labels: { fr: { value: 'La Joconde' } },
      descriptions: { fr: { value: 'peinture de Léonard de Vinci' } },
      claims: {
        P31: [v({ id: 'Q3305213' })],
        P170: [v({ id: 'Q762' })],
        P571: [v({ time: '+1503-00-00T00:00:00Z', precision: 9 })],
        P186: [v({ id: 'Q296955' }), v({ id: 'Q106857709' })],
        P195: [v({ id: 'Q19675' })],
        P217: [v('INV 779')],
        P18: [v('Mona Lisa.jpg')],
        P2048: [v({ amount: '+77', unit: 'http://www.wikidata.org/entity/Q174728' })],
        P2049: [v({ amount: '+53', unit: 'http://www.wikidata.org/entity/Q174728' })]
      }
    };
    const r = wikidataEntityToRecord(e, { Q762: 'Léonard de Vinci', Q296955: 'peinture à l’huile', Q106857709: 'panneau de peuplier', Q19675: 'musée du Louvre', Q3305213: 'peinture' });
    expect(r).toMatchObject({
      title: 'La Joconde',
      artist: 'Léonard de Vinci',
      date: '1503',
      medium: 'peinture à l’huile, panneau de peuplier',
      institution: 'musée du Louvre',
      inventory: 'INV 779',
      dimensions: '77 × 53 cm'
    });
    expect(r.imageUrl).toContain('Special:FilePath/Mona_Lisa.jpg');
  });
});

describe('Joconde (POP)', () => {
  it('convertit un enregistrement et pointe vers la notice POP', () => {
    const r = jocondeToRecord({
      reference: '000PE001234',
      titre: 'Portrait de femme',
      auteur: 'COROT Jean-Baptiste Camille',
      date_creation: '1860',
      materiaux_techniques: 'huile sur toile',
      mesures: 'H. 50 ; l. 40',
      nom_officiel_musee: 'musée des Beaux-Arts',
      ville: 'Troyes',
      numero_inventaire: '835.1'
    })!;
    expect(r.url).toBe('https://pop.culture.gouv.fr/notice/joconde/000PE001234');
    expect(r.institution).toBe('musée des Beaux-Arts, Troyes');
  });
  it('construit une requête ODSQL échappée', () => {
    expect(jocondeWhere('Le "radeau"', 'Théodore Géricault')).toBe('"Le  radeau" AND auteur like "gericault"');
  });
  it('signale une erreur HTTP sans planter les autres sources', async () => {
    mockFetch([]);
    await expect(makeJocondeAdapter('https://example.org/records').search({ title: 'x' }, http)).rejects.toThrow(/joconde: HTTP 404/);
  });
});

describe('Smithsonian et Rijksmuseum', () => {
  it('lit une ligne Smithsonian et ne garde l’image que si CC0', () => {
    const row = {
      id: 'edanmdm-saam_1929.6.106',
      content: {
        descriptiveNonRepeating: {
          title: { content: 'The Gulf Stream' },
          record_link: 'https://americanart.si.edu/x',
          data_source: 'Smithsonian American Art Museum',
          online_media: { media: [{ content: 'https://ids.si.edu/x', thumbnail: 'https://ids.si.edu/t', usage: { access: 'CC0' } }] }
        },
        freetext: { name: [{ label: 'Artist', content: 'Winslow Homer' }], date: [{ content: '1899' }] }
      }
    };
    const r = smithsonianToRecord(row)!;
    expect(r).toMatchObject({ artist: 'Winslow Homer', date: '1899', imageUrl: 'https://ids.si.edu/x' });
  });
  it('lit un objet Linked Art du Rijksmuseum', () => {
    const r = linkedArtToRecord(
      {
        identified_by: [
          { type: 'Name', content: 'De Nachtwacht', language: [{ _label: 'Dutch' }] },
          { type: 'Identifier', content: 'SK-C-5' }
        ],
        produced_by: { timespan: { identified_by: [{ content: '1642' }] }, part: [{ carried_out_by: [{ _label: 'Rembrandt van Rijn' }] }] }
      },
      'https://id.rijksmuseum.nl/200107928'
    )!;
    expect(r).toMatchObject({ title: 'De Nachtwacht', artist: 'Rembrandt van Rijn', date: '1642', inventory: 'SK-C-5' });
    expect(r.url).toBe('https://www.rijksmuseum.nl/en/collection/SK-C-5');
  });
});
