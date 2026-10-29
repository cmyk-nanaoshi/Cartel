// Fiches partagées : rédigées une fois, resservies ensuite, validées par l'administrateur.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { Cache } from '../../server/lib/cache';
import { MemoryStore, PgStore, pgOptions, withInit, workIdentity, type WorkStore } from '../../server/lib/store';
import type { AIProvider, JsonRequest } from '../../server/ai/types';
import type { ArtworkEntry, EntryRequest, LabelFields, SourceRecord } from '../../shared/types';

const aic: SourceRecord = {
  id: 'aic:24645',
  source: 'aic',
  sourceLabel: 'Art Institute of Chicago',
  url: 'https://www.artic.edu/artworks/24645',
  title: 'Under the Wave off Kanagawa',
  artist: 'Katsushika Hokusai',
  date: '1830–33',
  medium: 'Color woodblock print; oban',
  institution: 'Art Institute of Chicago',
  inventory: '1925.3245'
};
const wikidata: SourceRecord = { ...aic, id: 'wikidata:Q267031', source: 'wikidata', sourceLabel: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q267031' };

const label: LabelFields = {
  title: "Au revers d'une vague au large de Kanagawa",
  artist: 'Katsushika Hokusai',
  artistDates: '(Japon, 1760-1849)',
  date: 'Vers le début de l’ère Tenpō (vers 1830-1834)',
  medium: 'Estampe nishiki-e, format ōban',
  dimensions: null,
  inventory: 'MA 1234',
  institution: 'Musée Guimet',
  creditLine: null,
  description: null,
  rawText: '…'
};

class CountingProvider implements AIProvider {
  name = 'fake';
  demo = false;
  models = { vision: 'claude-sonnet-5-5', text: 'claude-sonnet-5-5', chat: 'claude-haiku-5-5', label: 'claude-haiku-5-5' };
  entryCalls: JsonRequest[] = [];
  async json<T>(req: JsonRequest) {
    if (req.task === 'entry') this.entryCalls.push(req);
    return {
      data: {
        objectKind: 'estampe',
        movement: 'Ukiyo-e',
        technique: 'Estampe polychrome gravée sur bois, format ōban',
        artistLine: 'japonais, 1760-1849',
        sections: [{ id: 'resume', claims: [{ text: 'Estampe de la série des Trente-six vues du mont Fuji.', kind: 'fait', sources: ['S1'] }] }]
      } as T,
      usage: { model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.01 }
    };
  }
  async stream() {
    return { model: 'x', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  }
}

function setup(store: WorkStore, adminCode = 'secret-admin') {
  const prev = { ...process.env };
  Object.assign(process.env, { SOURCES_OFFLINE: '1', RATE_LIMIT_PER_MINUTE: '500', ADMIN_CODE: adminCode, DATABASE_URL: '' });
  const cfg = loadConfig();
  process.env = prev;
  const provider = new CountingProvider();
  const { app, svc } = createApp({ cfg, provider, cache: new Cache(null), store });
  return { app, svc, provider };
}

const req = (records: SourceRecord[], extra: Partial<EntryRequest> = {}): EntryRequest => ({
  candidate: { key: 'katsushika-hokusai--la-grande-vague', title: 'La Grande Vague', artist: 'Katsushika Hokusai', date: null, records },
  ...extra
});

describe('identité d’une œuvre', () => {
  it('préfère Wikidata, rattache toutes les notices, n’utilise jamais le cartel', () => {
    const cartel: SourceRecord = { id: 'cartel:x', source: 'cartel', sourceLabel: 'Cartel', url: '' };
    expect(workIdentity([aic, wikidata, cartel], 'k')).toEqual({ workId: 'wikidata:Q267031', aliasIds: ['aic:24645', 'wikidata:Q267031'] });
    expect(workIdentity([cartel], 'k')).toEqual({ workId: 'cle:k', aliasIds: ['cle:k'] });
  });
  it('règle le chiffrement pour Neon et pas en local', () => {
    expect(pgOptions('postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require&channel_binding=require')).toEqual({
      url: 'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db',
      ssl: 'require'
    });
    expect(pgOptions('postgresql://u:p@localhost:5432/db').ssl).toBe(false);
  });
});

function sharedBehaviour(name: string, makeStore: () => WorkStore) {
  describe(`fiches partagées (${name})`, () => {
    it('rédige une fois, resservit ensuite sans IA, même trouvée par une autre notice', async () => {
      const { svc, provider } = setup(makeStore());
      const first = await svc.entry(req([aic]));
      expect(provider.entryCalls).toHaveLength(1);
      expect(first.verification).toMatchObject({ workId: 'aic:24645', status: 'provisoire', reused: false });

      const second = await svc.entry(req([aic, wikidata]));
      expect(provider.entryCalls).toHaveLength(1);
      expect(second.verification).toMatchObject({ workId: 'aic:24645', reused: true });
      expect(second.sections.map((s) => s.claims[0].text)).toEqual(first.sections.map((s) => s.claims[0].text));
    });

    it('la fiche partagée ne contient jamais le cartel d’un visiteur ; chaque scan ajoute le sien', async () => {
      const { svc, provider } = setup(makeStore());
      const a = await svc.entry(req([aic], { label, vision: { objectKind: 'estampe', description: 'Encadrée sous verre.', visibleText: [], inscriptions: ['Signature en haut à gauche'] } }));
      // Le modèle ne reçoit ni le cartel ni la consigne « fait foi » pour une fiche partageable.
      const prompt = (provider.entryCalls[0].content[0] as any).text as string;
      expect(prompt).not.toContain('Musée Guimet');
      expect(prompt).toContain('réutilisée pour tous les visiteurs');
      expect(a.sources[0].source).toBe('cartel');
      expect(a.sections.find((s) => s.id === 'cartel')!.claims.every((c) => c.kind === 'fait' && c.sources[0] === a.sources[0].id)).toBe(true);
      expect(a).toMatchObject({ technique: 'Estampe nishiki-e, format ōban', inventory: 'MA 1234', institution: 'Musée Guimet', artistLine: 'Japon, 1760-1849' });
      expect(a.sections.find((s) => s.id === 'inscriptions')!.claims[0].kind).toBe('observation');

      // Un autre visiteur, sans cartel : même fiche, sans le cartel ni les inscriptions du premier.
      const b = await svc.entry(req([aic]));
      expect(provider.entryCalls).toHaveLength(1);
      expect(b.sources.some((s) => s.source === 'cartel')).toBe(false);
      expect(b.sections.some((s) => s.id === 'cartel' || s.id === 'inscriptions')).toBe(false);
      expect(b).toMatchObject({ technique: 'Estampe polychrome gravée sur bois, format ōban', inventory: '1925.3245' });
    });

    it('une fiche rejetée est réécrite au scan suivant et repasse en attente', async () => {
      const store = makeStore();
      const { svc, provider } = setup(store);
      await svc.entry(req([aic]));
      await store.setStatus('aic:24645', 'rejetee');
      const again = await svc.entry(req([aic]));
      expect(provider.entryCalls).toHaveLength(2);
      expect(again.verification).toMatchObject({ status: 'provisoire', reused: false });
      expect((await store.get('aic:24645'))!.status).toBe('provisoire');
    });

    it('administration : code exigé, liste, validation, signalement, suppression', async () => {
      const store = makeStore();
      const { app, svc } = setup(store);
      await svc.entry(req([aic]));

      expect((await app.request('/api/admin/works')).status).toBe(401);
      expect((await app.request('/api/admin/works', { headers: { 'x-admin-code': 'mauvais' } })).status).toBe(401);
      const h = { 'x-admin-code': 'secret-admin', 'content-type': 'application/json' };

      let list = (await (await app.request('/api/admin/works?status=provisoire', { headers: h })).json()) as any;
      expect(list.works.map((w: any) => w.workId)).toEqual(['aic:24645']);
      expect(list.counts.provisoire).toBe(1);

      const rep = await app.request('/api/report', { method: 'POST', headers: h, body: JSON.stringify({ workId: 'aic:24645', reason: 'Date fausse' }) });
      expect(rep.status).toBe(200);
      list = (await (await app.request('/api/admin/works?status=signalees', { headers: h })).json()) as any;
      expect(list.works[0].reports).toBe(1);

      const val = await app.request(`/api/admin/works/${encodeURIComponent('aic:24645')}/status`, { method: 'POST', headers: h, body: JSON.stringify({ status: 'validee' }) });
      expect(val.status).toBe(200);
      const one = (await (await app.request(`/api/admin/works/${encodeURIComponent('aic:24645')}`, { headers: h })).json()) as any;
      expect(one.status).toBe('validee');
      expect(one.reports).toEqual([]);
      const served = await svc.entry(req([aic]));
      expect(served.verification).toMatchObject({ status: 'validee', reused: true });

      const del = await app.request(`/api/admin/works/${encodeURIComponent('aic:24645')}`, { method: 'DELETE', headers: h });
      expect(del.status).toBe(200);
      expect(await store.get('aic:24645')).toBeNull();
    });
  });
}

sharedBehaviour('mémoire', () => withInit(new MemoryStore()));

// La même série contre un vrai Postgres local, quand il est disponible (embedded-postgres).
let pg: any = null;
let pgUrl = '';
const stores: PgStore[] = [];
beforeAll(async () => {
  try {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dir = `/var/tmp/cartel-pg-${process.pid}`;
    pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54000 + (process.pid % 1000), persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    pgUrl = `postgresql://postgres:pw@localhost:${54000 + (process.pid % 1000)}/postgres`;
  } catch {
    pg = null;
  }
}, 120_000);
afterAll(async () => {
  for (const s of stores) await s.close().catch(() => {});
  if (pg) await pg.stop().catch(() => {});
});

describe('Postgres', () => {
  it('disponible pour les tests', () => {
    if (!pg) console.warn('Postgres local indisponible : tests Postgres ignorés.');
    expect(true).toBe(true);
  });
  let n = 0;
  const fresh = () => {
    const s = new PgStore(pgUrl);
    stores.push(s);
    const wrapped = withInit(s);
    // Chaque test part d'une base vide.
    const origInit = s.init.bind(s);
    s.init = async () => {
      await origInit();
      await (s as any).sql`truncate works cascade`;
    };
    n++;
    return wrapped;
  };
  describe.runIf(process.env.CI_NO_PG !== '1')('série complète', () => {
    sharedBehaviour('postgres', () => {
      if (!pg) throw new Error('postgres indisponible');
      return fresh();
    });
  });
});
