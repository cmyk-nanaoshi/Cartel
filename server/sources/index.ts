import type { SourceId, SourceRecord } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import type { HttpOptions } from './http.js';
import type { SourceAdapter, SourceQuery } from './types.js';
import { metAdapter } from './met.js';
import { aicAdapter } from './aic.js';
import { wikidataAdapter } from './wikidata.js';
import { makeJocondeAdapter } from './joconde.js';
import { rijksAdapter } from './rijksmuseum.js';
import { makeSmithsonianAdapter } from './smithsonian.js';
import { fixtureAdapter } from './fixtures.js';
import type { Cache } from '../lib/cache.js';

export class SourceRegistry {
  adapters: SourceAdapter[];
  http: HttpOptions;

  constructor(
    private cfg: AppConfig,
    private cache: Cache
  ) {
    const all = cfg.sources.offline
      ? [fixtureAdapter]
      : [
          makeJocondeAdapter(cfg.sources.jocondeBase),
          wikidataAdapter,
          aicAdapter,
          metAdapter,
          rijksAdapter,
          makeSmithsonianAdapter(cfg.sources.smithsonianKey)
        ];
    this.adapters = all.map((a) => ({ ...a, enabled: a.enabled && !cfg.sources.disabled.includes(a.id) }));
    this.http = {
      timeoutMs: cfg.sources.timeoutMs,
      userAgent: `Cartel/1.0 (application de reconnaissance d'oeuvres; ${cfg.sources.contact})`
    };
  }

  describe() {
    return this.adapters.map((a) => ({ id: a.id as SourceId, label: a.label, enabled: a.enabled, note: a.note }));
  }

  /** Interroge toutes les sources actives en parallèle. Les échecs d'une source n'interrompent pas les autres. */
  async searchAll(q: SourceQuery): Promise<{ records: SourceRecord[]; errors: string[] }> {
    const key = `sources:${JSON.stringify(q)}`;
    const cached = await this.cache.get<{ records: SourceRecord[]; errors: string[] }>(key);
    if (cached) return cached;
    const active = this.adapters.filter((a) => a.enabled);
    const results = await Promise.allSettled(active.map((a) => a.search(q, this.http)));
    const records: SourceRecord[] = [];
    const errors: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') records.push(...r.value);
      else errors.push(`${active[i].label} indisponible (${String(r.reason?.message ?? r.reason)})`);
    });
    const seen = new Set<string>();
    const unique = records.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    const out = { records: unique, errors };
    // On ne met en cache que les réponses complètes, pour ne pas figer une panne passagère.
    if (!errors.length) await this.cache.set(key, out, 60 * 60 * 24 * 7);
    return out;
  }
}
