import { useCallback, useEffect, useState } from 'react';
import type { WorkStatus, WorkSummary } from '../../shared/types';
import { frTypo } from '../../shared/typo';
import { registerDate } from '../../shared/observations';
import { admin, museumImg, type AdminCounts, type AdminWork } from '../lib/api';
import { getSetting, setSetting } from '../lib/db';
import { Cartel, ConfigProvider, Notice, SealMark, ToastProvider, useConfig, useToast } from '../components/ui';

// Administration des fiches partagées : une app à part, pour ordinateur, absente de la version publique.
// Accès par le code ADMIN_CODE défini sur le serveur ; il reste enregistré sur cet ordinateur seulement.
// Mise en page : maquette Figma « Administration / Liste et fiche », grille de 12 colonnes, marges 40, gouttières 24.

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

function Bar({ onForget }: { onForget?: () => void }) {
  return (
    <header className="admin-bar">
      <span className="tb-logo">
        <SealMark size={24} color="var(--seal)" />
        <span>Cartel</span>
      </span>
      <span className="t-muted">Administration des fiches</span>
      {onForget && (
        <button className="btn-discreet" style={{ marginLeft: 'auto' }} onClick={onForget}>
          Oublier le code sur cet ordinateur
        </button>
      )}
    </header>
  );
}

function Admin() {
  const { config } = useConfig();
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

  async function forget() {
    await setSetting('adminCode', '');
    setCode('');
    setOpen(null);
  }

  async function openWork(id: string) {
    try {
      setOpen(await admin.get(id));
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
      <div className="admin admin-login">
        <Bar />
        <form className="admin-card stack-16" onSubmit={saveCode}>
          <h1 className="t-head">Entrer le code</h1>
          <p className="t-small t-muted">Réservé à la relecture des fiches partagées. Le code reste enregistré sur cet ordinateur seulement.</p>
          {error && <Notice kind="error">{error}</Notice>}
          <label className="field">
            <span>Code d’administration</span>
            <input className="input input-mono" type="password" autoComplete="current-password" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button className="btn btn-block" type="submit" disabled={!draft.trim()}>
            Entrer
          </button>
        </form>
      </div>
    );

  const srcIndex = open ? new Map(open.entry.sources.map((s, i) => [s.id, i + 1])) : new Map();

  return (
    <div className="admin">
      <Bar onForget={forget} />
      <div className="admin-grid">
        <aside className="admin-list">
          <div className="chips" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="chip" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {counts ? ` · ${counts[t.id]}` : ''}
              </button>
            ))}
          </div>
          {storage === 'memoire' && (
            <Notice title="Base de données non reliée">Les fiches ne sont gardées qu’en mémoire et disparaissent au redémarrage du serveur. Vérifiez DATABASE_URL sur Render.</Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          {works && works.length === 0 && <p className="t-muted">Aucune fiche ici.</p>}
          {works && works.length > 0 && (
            <div>
              {works.map((w) => (
                <button key={w.workId} type="button" className="admin-row" aria-current={open?.workId === w.workId || undefined} onClick={() => openWork(w.workId)}>
                  {w.imageUrl ? <img className="admin-thumb" src={museumImg(w.imageUrl)} alt="" loading="lazy" /> : <span className="admin-thumb" />}
                  <span>
                    <span className="artist" style={{ display: 'block' }}>{w.artist}</span>
                    <span className="work-title" style={{ display: 'block', fontSize: 17, lineHeight: '24px' }}>{frTypo(w.title)}</span>
                    <span className="mono t-muted" style={{ display: 'block' }}>
                      {isoDay(w.updatedAt)} · {w.uses} réutil.{w.reports ? ` · ${w.reports} signalement${w.reports > 1 ? 's' : ''}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {config && !config.demo && (
            <div className="stack-8" style={{ marginTop: 32 }}>
              <h2 className="rubric">Serveur</h2>
              <dl className="kv">
                <dt>Identification</dt>
                <dd>{config.models.vision}</dd>
                <dt>Rédaction</dt>
                <dd>{config.models.text}</dd>
                <dt>Questions</dt>
                <dd>{config.models.chat}</dd>
                <dt>Dépensé aujourd’hui</dt>
                <dd className="num">
                  {config.limits.spentTodayUsd.toFixed(3)} $ sur {config.limits.dailyBudgetUsd} $
                </dd>
              </dl>
            </div>
          )}
        </aside>

        <section className="admin-detail">
          {!open ? (
            <p className="t-muted" style={{ paddingTop: 24 }}>Choisissez une fiche dans la liste.</p>
          ) : (
            <>
              <div className="admin-scroll">
                <p className={open.reports.length ? 'state-warn' : open.status === 'validee' ? 'state-ok' : ''} style={{ fontWeight: 600 }}>
                  {open.reports.length ? 'Signalée, à relire' : STATUS_LABEL[open.status]}
                </p>
                <p className="mono t-muted" style={{ marginTop: 4 }}>
                  {open.workId} · {open.uses} réutilisation{open.uses > 1 ? 's' : ''} · rédigée le {isoDay(open.createdAt)}
                  {open.validatedAt ? ` · validée le ${isoDay(open.validatedAt)}` : ''}
                </p>
                <div className="admin-cols">
                  <div>
                    {open.entry.imageUrl && <img className="admin-repro" src={museumImg(open.entry.imageUrl)} alt="" />}
                    <div style={{ marginTop: 16 }}>
                      <Cartel entry={{ ...open.entry, artistBio: open.entry.artistLine ?? undefined }} />
                    </div>
                  </div>
                  <div>
                    {open.reports.length > 0 && (
                      <section style={{ marginBottom: 24 }}>
                        <h2 className="rubric">Signalement{open.reports.length > 1 ? 's' : ''}</h2>
                        <div className="stack-8">
                          {open.reports.map((r, i) => (
                            <Notice key={i}>
                              {isoDay(r.createdAt)} · {frTypo(r.reason)}
                            </Notice>
                          ))}
                        </div>
                      </section>
                    )}
                    {open.entry.sections.map((s) => (
                      <section key={s.id} style={{ marginBottom: 24 }}>
                        <h2 className="rubric">{s.title}</h2>
                        <div className="reading">
                          {s.claims.map((c, i) => (
                            <div key={i} className="claim">
                              {(c.kind !== 'fait' || c.unsourced) && <span className={`kind ${c.unsourced ? 'kind-unsourced' : `kind-${c.kind}`}`}>{c.unsourced ? 'À vérifier' : KIND_LABEL[c.kind]}</span>}
                              <p>
                                {frTypo(c.text)}
                                {c.sources.length > 0 && <sup className="refs">{c.sources.map((x) => srcIndex.get(x)).filter(Boolean).join(',')}</sup>}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                    <section>
                      <h2 className="rubric">Sources</h2>
                      <ol className="sources-list">
                        {open.entry.sources.map((s, i) => (
                          <li key={s.id}>
                            <span className="sid num">{i + 1}</span>
                            <span>
                              {s.url ? (
                                <a href={s.url} target="_blank" rel="noreferrer">
                                  {s.sourceLabel}
                                </a>
                              ) : (
                                s.sourceLabel
                              )}
                              {frTypo(`${s.title ? `, « ${s.title} »` : ''}${s.inventory ? `, inv. ${s.inventory}` : ''}`)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </div>
              </div>
              <div className="admin-actions">
                <div className="admin-actions-row">
                  {open.status !== 'validee' && (
                    <button className="btn" onClick={() => act(open.workId, 'validee')}>
                      Valider
                    </button>
                  )}
                  {open.status !== 'rejetee' && (
                    <button className="btn btn-secondary" onClick={() => act(open.workId, 'rejetee')}>
                      Rejeter
                    </button>
                  )}
                  {open.status !== 'provisoire' && (
                    <button className="btn btn-secondary" onClick={() => act(open.workId, 'provisoire')}>
                      Remettre à valider
                    </button>
                  )}
                  <button className="btn-discreet" style={{ marginLeft: 'auto' }} onClick={() => act(open.workId, 'supprimer')}>
                    Supprimer définitivement
                  </button>
                </div>
                <p className="t-small t-muted">Rejeter : la fiche n’est plus servie et sera réécrite au prochain scan de cette œuvre.</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function AdminApp() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <Admin />
      </ToastProvider>
    </ConfigProvider>
  );
}
