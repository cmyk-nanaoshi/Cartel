import postgres from 'postgres';
import type { ArtworkEntry, SourceRecord, WorkStatus, WorkSummary } from '../../shared/types.js';

// Fiches partagées : une fiche rédigée pour une œuvre est gardée et resservie aux visiteurs suivants,
// au lieu d'être réécrite par l'IA. L'administrateur la valide, la rejette (elle sera réécrite) ou la supprime.
// Postgres (Neon) quand DATABASE_URL est défini ; sinon une mémoire de secours, perdue au redémarrage.

export interface StoredWork {
  workId: string;
  status: WorkStatus;
  entry: ArtworkEntry;
  recordIds: string[];
  uses: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  reports: { reason: string; createdAt: string }[];
}

export interface WorkStore {
  readonly kind: 'postgres' | 'memoire';
  init(): Promise<void>;
  /** Fiche rattachée à l'un de ces identifiants de notices (ou à la clé de repli). */
  find(aliasIds: string[]): Promise<StoredWork | null>;
  get(workId: string): Promise<StoredWork | null>;
  /** Crée ou remplace la fiche (statut provisoire) et rattache tous les identifiants donnés. */
  save(workId: string, entry: ArtworkEntry, aliasIds: string[]): Promise<void>;
  touch(workId: string): Promise<void>;
  setStatus(workId: string, status: WorkStatus): Promise<boolean>;
  report(workId: string, reason: string): Promise<boolean>;
  list(opts: { status?: WorkStatus | 'signalees'; limit?: number; offset?: number }): Promise<WorkSummary[]>;
  remove(workId: string): Promise<boolean>;
  counts(): Promise<Record<WorkStatus | 'signalees', number>>;
}

// Ordre de préférence pour l'identifiant d'une œuvre : les référentiels les plus stables d'abord.
const SOURCE_PRIORITY = ['wikidata', 'joconde', 'aic', 'met', 'rijksmuseum', 'smithsonian', 'fixture'];

/**
 * Identifiants qui désignent l'œuvre : ceux des notices de musée. Sans notice, la clé artiste--titre,
 * moins fiable, sert de repli ; elle n'est jamais mêlée aux identifiants de notices.
 */
export function workIdentity(records: SourceRecord[], fallbackKey: string): { workId: string; aliasIds: string[] } {
  const notices = records.filter((r) => r.source !== 'cartel');
  if (!notices.length) return { workId: `cle:${fallbackKey}`, aliasIds: [`cle:${fallbackKey}`] };
  const sorted = [...notices].sort(
    (a, b) => rank(a.source) - rank(b.source) || a.id.localeCompare(b.id)
  );
  return { workId: sorted[0].id, aliasIds: [...new Set(notices.map((r) => r.id))] };
}
const rank = (s: string) => {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i < 0 ? 99 : i;
};

function summarize(w: StoredWork): WorkSummary {
  return {
    workId: w.workId,
    status: w.status,
    title: w.entry.title,
    artist: w.entry.artist,
    imageUrl: w.entry.imageUrl,
    uses: w.uses,
    reports: w.reports.length,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt
  };
}

// ---------- Mémoire (secours et tests) ----------

export class MemoryStore implements WorkStore {
  readonly kind = 'memoire' as const;
  private works = new Map<string, StoredWork>();
  private aliases = new Map<string, string>();

  async init() {}

  async find(aliasIds: string[]) {
    for (const id of aliasIds) {
      const w = this.aliases.get(id);
      if (w && this.works.has(w)) return structuredClone(this.works.get(w)!);
    }
    return null;
  }
  async get(workId: string) {
    const w = this.works.get(workId);
    return w ? structuredClone(w) : null;
  }
  async save(workId: string, entry: ArtworkEntry, aliasIds: string[]) {
    const now = new Date().toISOString();
    const prev = this.works.get(workId);
    this.works.set(workId, {
      workId,
      status: 'provisoire',
      entry,
      recordIds: [...new Set([...(prev?.recordIds ?? []), ...aliasIds])],
      uses: prev?.uses ?? 0,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      validatedAt: null,
      reports: prev?.reports ?? []
    });
    for (const id of aliasIds) this.aliases.set(id, workId);
  }
  async touch(workId: string) {
    const w = this.works.get(workId);
    if (w) w.uses++;
  }
  async setStatus(workId: string, status: WorkStatus) {
    const w = this.works.get(workId);
    if (!w) return false;
    w.status = status;
    w.updatedAt = new Date().toISOString();
    w.validatedAt = status === 'validee' ? w.updatedAt : null;
    if (status === 'validee') w.reports = [];
    return true;
  }
  async report(workId: string, reason: string) {
    const w = this.works.get(workId);
    if (!w) return false;
    w.reports.push({ reason, createdAt: new Date().toISOString() });
    return true;
  }
  async list(opts: { status?: WorkStatus | 'signalees'; limit?: number; offset?: number }) {
    let all = [...this.works.values()];
    if (opts.status === 'signalees') all = all.filter((w) => w.reports.length > 0);
    else if (opts.status) all = all.filter((w) => w.status === opts.status);
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50)).map(summarize);
  }
  async remove(workId: string) {
    const had = this.works.delete(workId);
    for (const [k, v] of this.aliases) if (v === workId) this.aliases.delete(k);
    return had;
  }
  async counts() {
    const c = { provisoire: 0, validee: 0, rejetee: 0, signalees: 0 };
    for (const w of this.works.values()) {
      c[w.status]++;
      if (w.reports.length) c.signalees++;
    }
    return c;
  }
}

// ---------- Postgres (Neon) ----------

/** Neon fournit sslmode et channel_binding dans l'adresse ; on règle le chiffrement explicitement. */
export function pgOptions(url: string): { url: string; ssl: false | 'require' } {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  const mode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  return { url: u.toString(), ssl: local || mode === 'disable' ? false : 'require' };
}

export class PgStore implements WorkStore {
  readonly kind = 'postgres' as const;
  private sql: postgres.Sql;

  constructor(databaseUrl: string) {
    const { url, ssl } = pgOptions(databaseUrl);
    // prepare:false : compatible avec le regroupeur de connexions de Neon (adresse « pooled »).
    this.sql = postgres(url, { ssl, max: 5, idle_timeout: 20, connect_timeout: 15, prepare: false, onnotice: () => {} });
  }

  async init() {
    await this.sql`
      create table if not exists works (
        work_id text primary key,
        status text not null default 'provisoire' check (status in ('provisoire', 'validee', 'rejetee')),
        title text not null,
        artist text not null,
        entry jsonb not null,
        uses integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        validated_at timestamptz
      )`;
    await this.sql`
      create table if not exists work_aliases (
        alias_id text primary key,
        work_id text not null references works(work_id) on delete cascade
      )`;
    await this.sql`
      create table if not exists work_reports (
        id bigserial primary key,
        work_id text not null references works(work_id) on delete cascade,
        reason text not null,
        created_at timestamptz not null default now()
      )`;
    await this.sql`create index if not exists works_status_idx on works (status, updated_at desc)`;
    await this.sql`create index if not exists work_reports_work_idx on work_reports (work_id)`;
  }

  private async hydrate(row: any): Promise<StoredWork> {
    const [aliases, reports] = await Promise.all([
      this.sql`select alias_id from work_aliases where work_id = ${row.work_id}`,
      this.sql`select reason, created_at from work_reports where work_id = ${row.work_id} order by created_at desc`
    ]);
    return {
      workId: row.work_id,
      status: row.status,
      entry: row.entry,
      recordIds: aliases.map((a: any) => a.alias_id),
      uses: row.uses,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
      reports: reports.map((r: any) => ({ reason: r.reason, createdAt: new Date(r.created_at).toISOString() }))
    };
  }

  async find(aliasIds: string[]) {
    if (!aliasIds.length) return null;
    const rows = await this.sql`
      select w.* from works w join work_aliases a on a.work_id = w.work_id
      where a.alias_id in ${this.sql(aliasIds)}
      order by (w.status = 'validee') desc, w.updated_at desc limit 1`;
    return rows.length ? this.hydrate(rows[0]) : null;
  }

  async get(workId: string) {
    const rows = await this.sql`select * from works where work_id = ${workId}`;
    return rows.length ? this.hydrate(rows[0]) : null;
  }

  async save(workId: string, entry: ArtworkEntry, aliasIds: string[]) {
    await this.sql.begin(async (tx: any) => {
      await tx`
        insert into works (work_id, status, title, artist, entry)
        values (${workId}, 'provisoire', ${entry.title}, ${entry.artist}, ${tx.json(entry as any)})
        on conflict (work_id) do update set
          status = 'provisoire', title = excluded.title, artist = excluded.artist, entry = excluded.entry,
          updated_at = now(), validated_at = null`;
      for (const id of aliasIds) {
        await tx`insert into work_aliases (alias_id, work_id) values (${id}, ${workId})
                 on conflict (alias_id) do update set work_id = excluded.work_id`;
      }
    });
  }

  async touch(workId: string) {
    await this.sql`update works set uses = uses + 1 where work_id = ${workId}`;
  }

  async setStatus(workId: string, status: WorkStatus) {
    const rows = await this.sql`
      update works set status = ${status}, updated_at = now(),
        validated_at = case when ${status} = 'validee' then now() else null end
      where work_id = ${workId} returning work_id`;
    // Valider une fiche vaut réponse aux signalements en cours.
    if (rows.length && status === 'validee') await this.sql`delete from work_reports where work_id = ${workId}`;
    return rows.length > 0;
  }

  async report(workId: string, reason: string) {
    const rows = await this.sql`select 1 from works where work_id = ${workId}`;
    if (!rows.length) return false;
    await this.sql`insert into work_reports (work_id, reason) values (${workId}, ${reason})`;
    return true;
  }

  async list(opts: { status?: WorkStatus | 'signalees'; limit?: number; offset?: number }) {
    const limit = Math.min(200, opts.limit ?? 50);
    const offset = opts.offset ?? 0;
    const filter =
      opts.status === 'signalees'
        ? this.sql`where exists (select 1 from work_reports r where r.work_id = w.work_id)`
        : opts.status
          ? this.sql`where w.status = ${opts.status}`
          : this.sql``;
    const rows = await this.sql`
      select w.work_id, w.status, w.title, w.artist, w.entry->>'imageUrl' as image_url, w.uses, w.created_at, w.updated_at,
        (select count(*) from work_reports r where r.work_id = w.work_id)::int as reports
      from works w ${filter}
      order by w.updated_at desc limit ${limit} offset ${offset}`;
    return rows.map((r: any) => ({
      workId: r.work_id,
      status: r.status,
      title: r.title,
      artist: r.artist,
      imageUrl: r.image_url ?? undefined,
      uses: r.uses,
      reports: r.reports,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString()
    }));
  }

  async remove(workId: string) {
    const rows = await this.sql`delete from works where work_id = ${workId} returning work_id`;
    return rows.length > 0;
  }

  async counts() {
    const rows = await this.sql`select status, count(*)::int as n from works group by status`;
    const c = { provisoire: 0, validee: 0, rejetee: 0, signalees: 0 };
    for (const r of rows as any[]) c[r.status as WorkStatus] = r.n;
    const [s] = await this.sql`select count(distinct work_id)::int as n from work_reports`;
    c.signalees = (s as any).n;
    return c;
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

/** Crée les tables au premier usage ; en cas d'échec (base injoignable), réessaie à l'appel suivant. */
export function withInit(store: WorkStore): WorkStore {
  let ready: Promise<void> | null = null;
  const ensure = () => (ready ??= store.init().catch((e) => {
    ready = null;
    throw e;
  }));
  return new Proxy(store, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || prop === 'init') return v;
      return async (...args: unknown[]) => {
        await ensure();
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
  });
}

export function createStore(databaseUrl: string): WorkStore {
  return withInit(databaseUrl ? new PgStore(databaseUrl) : new MemoryStore());
}
