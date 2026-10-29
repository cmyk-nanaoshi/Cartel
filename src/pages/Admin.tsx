import { useCallback, useEffect, useState } from 'react';
import type { WorkStatus, WorkSummary } from '../../shared/types';
import { frTypo } from '../../shared/typo';
import { registerDate } from '../../shared/observations';
import { admin, museumImg, type AdminCounts, type AdminWork } from '../lib/api';
import { getSetting, setSetting } from '../lib/db';
import { BackLink, Cartel, Notice, useToast } from '../components/ui';

// Administration : relire les fiches partagées, les valider, les rejeter (elles seront réécrites) ou les supprimer.
// Accessible avec le code ADMIN_CODE défini sur le serveur ; il reste enregistré sur cet appareil seulement.

type Tab = WorkStatus | 'signalees';
const TABS: { id: Tab; label: string }[] = [
  { id: 'provisoire', label: 'À valider' },
  { id: 'signalees', label: 'Signalées' },
  { id: 'validee', label: 'Validées' },
  { id: 'rejetee', label: 'Rejetées' }
];
const STATUS_LABEL: Record<WorkStatus, string> = { provisoire: 'À valider', validee: 'Validée', rejetee: 'Rejetée' };
const KIND_LABEL = { fait: 'Fait', observation: 'Observé', interpretation: 'Interprétation', hypothese: 'Hypothèse' } as const;
const isoDay = (s: string) => registerDate(s.slice(0, 10));

export function Admin() {
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<Tab>('provisoire');
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [storage, setStorage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminWork | null>(null);
  const toast = useToast();

  useEffect(() => {
    getSetting<string>('adminCode').then((c) => setCode(c ?? ''));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await admin.list(tab);
      setWorks(r.works);
      setCounts(r.counts);
      setStorage(r.storage);
    } catch (e: any) {
      setWorks(null);
      setError(e.message);
      if (e.status === 401) {
        await setSetting('adminCode', '');
        setCode('');
      }
    }
  }, [tab]);

  useEffect(() => {
    if (code) void load();
  }, [code, load]);

  async function saveCode(e: React.FormEvent) {
    e.preventDefault();
    await setSetting('adminCode', draft.trim());
    setCode(draft.trim());
    setDraft('');
  }

  async function openWork(id: string) {
    try {
      setOpen(await admin.get(id));
      window.scrollTo(0, 0);
    } catch (e: any) {
      toast(e.message);
    }
  }

  async function act(id: string, action: WorkStatus | 'supprimer') {
    if (action === 'supprimer' && !confirm('Supprimer définitivement cette fiche ? Elle sera réécrite au prochain scan.')) return;
    try {
      if (action === 'supprimer') await admin.remove(id);
      else await admin.setStatus(id, action);
      toast(action === 'validee' ? 'Fiche validée' : action === 'rejetee' ? 'Fiche rejetée, elle sera réécrite' : action === 'supprimer' ? 'Fiche supprimée' : 'Fiche remise à valider');
      setOpen(null);
      void load();
    } catch (e: any) {
      toast(e.message);
    }
  }

  if (code === null) return null;

  if (!code)
    return (
      <main className="page stack-24">
        <BackLink to="/profil" label="Profil" />
        <header className="pagehead">
          <h1 className="t-display">Administration</h1>
        </header>
        {error && <Notice kind="error">{error}</Notice>}
        <form className="stack-16" onSubmit={saveCode} style={{ maxWidth: 420 }}>
          <label className="field">
            <span>Code d’administration</span>
            <input className="input input-mono" type="password" autoComplete="current-password" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={!draft.trim()}>
            Entrer
          </button>
        </form>
      </main>
    );

  if (open) {
    const srcIndex = new Map(open.entry.sources.map((s, i) => [s.id, i + 1]));
    return (
      <main className="page stack-24">
        <button type="button" className="back" onClick={() => setOpen(null)}>
          ‹ Liste
        </button>
        <div className="stack-8">
          <span className="status-pill" data-s={open.status}>{STATUS_LABEL[open.status]}</span>
          <p className="mono t-faint">
            {open.workId} · {open.uses} réutilisation{open.uses > 1 ? 's' : ''} · rédigée le {isoDay(open.createdAt)}
            {open.validatedAt ? ` · validée le ${isoDay(open.validatedAt)}` : ''}
          </p>
        </div>
        {open.entry.imageUrl && <img src={museumImg(open.entry.imageUrl)} alt="" style={{ maxHeight: 280, width: 'auto', maxWidth: '100%' }} />}
        <Cartel entry={{ ...open.entry, artistBio: open.entry.artistLine ?? undefined }} />

        {open.reports.length > 0 && (
          <section className="stack-8">
            <h2 className="label-mono">Signalements</h2>
            {open.reports.map((r, i) => (
              <Notice key={i}>
                <span className="mono">{isoDay(r.createdAt)}</span> {frTypo(r.reason)}
              </Notice>
            ))}
          </section>
        )}

        {open.entry.sections.map((s) => (
          <section key={s.id} className="entry-section">
            <h2>{s.title}</h2>
            <div className="reading measure">
              {s.claims.map((c, i) => (
                <p key={i} className="claim">
                  {c.kind !== 'fait' && <span className={`kind ${c.unsourced ? 'kind-unsourced' : `kind-${c.kind}`}`}>{c.unsourced ? 'Non sourcé' : KIND_LABEL[c.kind]}</span>}
                  {frTypo(c.text)}
                  {c.sources.length > 0 && <sup className="refs">{c.sources.map((x) => srcIndex.get(x)).filter(Boolean).join(',')}</sup>}
                </p>
              ))}
            </div>
          </section>
        ))}

        <section className="entry-section">
          <h2>Sources</h2>
          <ol className="sources-list">
            {open.entry.sources.map((s, i) => (
              <li key={s.id}>
                <span className="sid num">{i + 1}</span>
                <span>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.sourceLabel}</a>
                  {frTypo(`${s.title ? `, « ${s.title} »` : ''}${s.inventory ? `, inv. ${s.inventory}` : ''}`)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="admin-actions">
          {open.status !== 'validee' && (
            <button className="btn" onClick={() => act(open.workId, 'validee')}>
              Valider
            </button>
          )}
          {open.status !== 'rejetee' && (
            <button className="btn btn-ghost" onClick={() => act(open.workId, 'rejetee')}>
              Rejeter
            </button>
          )}
          {open.status !== 'provisoire' && (
            <button className="btn btn-ghost" onClick={() => act(open.workId, 'provisoire')}>
              Remettre à valider
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => act(open.workId, 'supprimer')}>
            Supprimer
          </button>
        </div>
        <p className="t-small t-faint">Rejeter : la fiche n’est plus servie et sera réécrite par l’IA au prochain scan de cette œuvre.</p>
      </main>
    );
  }

  return (
    <main className="page stack-24">
      <BackLink to="/profil" label="Profil" />
      <header className="pagehead">
        <h1 className="t-display">Administration</h1>
      </header>
      {storage === 'memoire' && <Notice title="Base de données non reliée">Les fiches ne sont gardées qu’en mémoire et disparaissent au redémarrage du serveur. Vérifiez DATABASE_URL sur Render.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="chip" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {counts ? <span className="mono">{counts[t.id]}</span> : null}
          </button>
        ))}
      </div>

      {works && works.length === 0 && <p className="t-muted">Aucune fiche ici.</p>}
      {works && works.length > 0 && (
        <div>
          {works.map((w) => (
            <button key={w.workId} type="button" className="admin-row" onClick={() => openWork(w.workId)}>
              {w.imageUrl ? <img className="admin-thumb" src={museumImg(w.imageUrl)} alt="" loading="lazy" /> : <span className="admin-thumb" />}
              <span className="stack-8">
                <span>
                  <span className="artist" style={{ display: 'block' }}>{w.artist}</span>
                  <span className="work-title">{frTypo(w.title)}</span>
                </span>
                <span className="mono t-faint">
                  {isoDay(w.updatedAt)} · {w.uses} réutil.{w.reports ? ` · ${w.reports} signalement${w.reports > 1 ? 's' : ''}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <button className="linkbtn" onClick={async () => { await setSetting('adminCode', ''); setCode(''); }}>
        Oublier le code sur cet appareil
      </button>
    </main>
  );
}
