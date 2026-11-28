import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting, type SavedArtwork } from '../lib/db';
import { collectionToCsv, collectionToPdf, download } from '../lib/export';
import { Icon, WorkTile, useToast } from '../components/ui';
import { TopBar } from '../components/Chrome';
import { t } from '../i18n';
import { frDay, groupDays, groupExhibitions, groupVisits, latestObservations, plural, type Visit } from '../lib/visits';

type View = 'visites' | 'expositions' | 'dates';
const VIEWS: [View, string][] = [
  ['visites', 'Visites'],
  ['expositions', 'Expositions'],
  ['dates', 'Dates']
];

function norm(s: string | null | undefined) {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Recherche locale sur titre, artiste, date, mouvement, technique, notes et tags. */
export function matches(a: SavedArtwork, q: string) {
  if (!q) return true;
  const e = a.entry;
  const hay = norm([e.title, e.artist, e.date, e.movement, e.technique, e.objectKind, e.institution, a.notes, a.tags.join(' '), a.exhibition].join(' '));
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Une adresse d'image par œuvre : la photo prise, sinon la reproduction. Libérées au démontage. */
function useThumbs(items: SavedArtwork[] | undefined) {
  const urls = useMemo(() => new Map((items ?? []).map((a) => [a.id, a.photo ? URL.createObjectURL(a.photo) : a.entry.imageUrl ?? undefined])), [items]);
  useEffect(() => () => urls.forEach((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function useOrganized() {
  const items = useLiveQuery(() => db.artworks.toArray(), []);
  const obsList = useLiveQuery(() => db.observations.toArray(), []);
  const declared = useLiveQuery(async () => (await getSetting<string[]>('exhibitions')) ?? [], []);
  const obs = useMemo(() => latestObservations(obsList ?? []), [obsList]);
  return { items, obs, declared: declared ?? [] };
}

const workLabel = (a: SavedArtwork) => [a.entry.artist, a.entry.title].filter(Boolean).join(', ');

function Thumb({ a, url, more, link = true }: { a: SavedArtwork; url?: string; more?: number; link?: boolean }) {
  const img = url ? <img src={url} alt="" loading="lazy" /> : <span className="thumb-ph" />;
  const inner = (
    <>
      {img}
      {more ? <span className="thumb-more">+{more}</span> : null}
    </>
  );
  return link ? (
    <Link className="thumb" to={`/oeuvre/${encodeURIComponent(a.id)}`} aria-label={workLabel(a)}>
      {inner}
    </Link>
  ) : (
    <span className="thumb">{inner}</span>
  );
}

/** Quatre vignettes au plus ; la dernière annonce les œuvres restantes. */
function ThumbRow({ works, urls, link }: { works: SavedArtwork[]; urls: Map<string, string | undefined>; link: boolean }) {
  const shown = works.length > 4 ? works.slice(0, 4) : works;
  const rest = works.length - 3;
  return (
    <div className="thumbs">
      {shown.map((a, i) => (
        <Thumb key={a.id} a={a} url={urls.get(a.id)} link={link} more={works.length > 4 && i === 3 ? rest : undefined} />
      ))}
    </div>
  );
}

export function Collection() {
  const [params, setParams] = useSearchParams();
  const { items, obs, declared } = useOrganized();
  const cols = useLiveQuery(() => db.collections.orderBy('name').toArray(), []);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const view = (VIEWS.find(([v]) => v === params.get('vue'))?.[0] ?? 'visites') as View;
  const tag = params.get('tag');
  const col = params.get('collection');
  const urls = useThumbs(items);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  // Les filtres (recherche, tags, collections thématiques) s'appliquent aux trois classements.
  const list = useMemo(() => {
    let l = (items ?? []).filter((a) => matches(a, q));
    if (tag) l = l.filter((a) => a.tags.includes(tag));
    if (col) l = l.filter((a) => a.collectionIds.includes(col));
    return l;
  }, [items, q, tag, col]);
  const filtered = !!(q || tag || col);

  const visits = useMemo(() => groupVisits(list, obs), [list, obs]);
  const expos = useMemo(() => groupExhibitions(list, obs, filtered ? [] : declared), [list, obs, declared, filtered]);
  const days = useMemo(() => groupDays(list, obs), [list, obs]);
  const allTags = useMemo(() => [...new Set((items ?? []).flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b, 'fr')), [items]);

  async function exportCsv() {
    download(new Blob([collectionToCsv(list, cols ?? [])], { type: 'text/csv;charset=utf-8' }), 'cartel-collection.csv');
  }
  async function exportPdf() {
    setBusy(true);
    try {
      const name = col ? cols?.find((c) => c.id === col)?.name : undefined;
      download(await collectionToPdf(list, name ?? 'Ma collection'), 'cartel-collection.pdf');
    } catch (e: any) {
      toast('Export PDF impossible : ' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteCollection(id: string) {
    if (!confirm('Supprimer cette collection ? Les œuvres restent dans votre collection générale.')) return;
    await db.transaction('rw', db.collections, db.artworks, async () => {
      await db.collections.delete(id);
      const affected = await db.artworks.where('collectionIds').equals(id).toArray();
      for (const a of affected) await db.artworks.update(a.id, { collectionIds: a.collectionIds.filter((x) => x !== id), updatedAt: Date.now() });
    });
    setParam('collection', null);
  }

  return (
    <main>
      <TopBar back="Viseur" backTo="/" />
      <div className="page" style={{ paddingTop: 8 }}>
        <header className="pagehead">
          <h1 className="t-display">{t('collection.title')}</h1>
          <span className="t-small t-muted num">{plural(items?.length ?? 0, 'œuvre')}</span>
        </header>

        {items && items.length === 0 ? (
          <div className="empty stack-16">
            <p className="measure">{t('collection.empty')}</p>
            <div className="row">
              <Link className="btn" to="/scanner">
                Scanner une œuvre
              </Link>
              <Link className="btn btn-ghost" to="/hasard">
                Découvrir au hasard
              </Link>
            </div>
          </div>
        ) : (
          <div className="stack-24">
            <div className="segmented segmented-fill" role="group" aria-label="Classer la collection">
              {VIEWS.map(([v, l]) => (
                <button key={v} aria-pressed={view === v} onClick={() => setParam('vue', v === 'visites' ? null : v)}>
                  {l}
                </button>
              ))}
            </div>

            {view === 'visites' && (
              <section aria-label="Visites">
                {visits.map((v) => (
                  <VisitCard key={v.id} v={v} urls={urls} />
                ))}
                <p className="t-small t-muted" style={{ paddingTop: 16 }}>
                  Une visite regroupe les œuvres photographiées le même jour au même endroit.
                </p>
              </section>
            )}

            {view === 'expositions' && (
              <section aria-label="Expositions" className="stack-24">
                {expos.exhibitions.map((e) => (
                  <Link key={e.name} className="expo-card" to={`/collection/exposition/${encodeURIComponent(e.name)}`}>
                    <span className="expo-cover">{e.works[0] && urls.get(e.works[0].id) ? <img src={urls.get(e.works[0].id)} alt="" loading="lazy" /> : null}</span>
                    <span className="work-title expo-name">{e.name}</span>
                    {e.place && <span className="t-small t-muted">{e.place}</span>}
                    <span className="mono-meta">
                      {plural(e.works.length, 'œuvre')}
                      {e.visitCount > 1 ? ` · vues lors de ${e.visitCount} visites` : ''}
                    </span>
                  </Link>
                ))}
                {expos.outside.length > 0 && (
                  <div>
                    <p className="visit-place">Hors exposition</p>
                    <p className="mono-meta">{plural(expos.outside.length, 'œuvre')}</p>
                    <ThumbRow works={expos.outside} urls={urls} link />
                  </div>
                )}
                <button className="btn btn-ghost btn-block" onClick={() => setCreating(true)}>
                  Nouvelle exposition
                </button>
              </section>
            )}

            {view === 'dates' && (
              <section aria-label="Dates" className="stack-24">
                {days.map((d) => (
                  <div key={d.day}>
                    <h2 className="rubric">{frDay(d.day)}</h2>
                    <div className="day-grid">
                      {d.works.map((a) => (
                        <Thumb key={a.id} a={a} url={urls.get(a.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {list.length === 0 && <p className="t-muted">Aucune œuvre ne correspond à ces critères.</p>}

            <details className="disclosure" open={filtered || undefined}>
              <summary>Rechercher et filtrer</summary>
              <div className="stack-8" style={{ paddingTop: 12 }}>
                <label style={{ position: 'relative', display: 'block' }}>
                  <span className="sr-only">Rechercher dans la collection</span>
                  <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste, titre, mouvement…" style={{ paddingLeft: 40 }} />
                  <span style={{ position: 'absolute', left: 12, top: 14, color: 'var(--ink-3)' }}>
                    <Icon name="search" size={20} />
                  </span>
                </label>
                {!!cols?.length && (
                  <div className="chips" aria-label="Collections thématiques">
                    {cols.map((c) => (
                      <button key={c.id} className="chip" aria-pressed={col === c.id} onClick={() => setParam('collection', col === c.id ? null : c.id)}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {!!allTags.length && (
                  <div className="chips" aria-label="Tags">
                    {allTags.map((tg) => (
                      <button key={tg} className="chip" aria-pressed={tag === tg} onClick={() => setParam('tag', tag === tg ? null : tg)}>
                        #{tg}
                      </button>
                    ))}
                  </div>
                )}
                {col && (
                  <button className="linkbtn t-small" onClick={() => deleteCollection(col)}>
                    Supprimer la collection « {cols?.find((c) => c.id === col)?.name} »
                  </button>
                )}
              </div>
            </details>

            <div className="row" style={{ paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
              <span className="t-small t-muted">Exporter {list.length === items?.length ? 'la collection' : 'la sélection'} :</span>
              <button className="btn btn-ghost btn-small" onClick={exportCsv} disabled={!list.length}>
                CSV
              </button>
              <button className="btn btn-ghost btn-small" onClick={exportPdf} disabled={!list.length || busy}>
                {busy ? <span className="spinner" /> : null} PDF
              </button>
            </div>
          </div>
        )}
      </div>
      {creating && <NewExhibitionSheet visits={groupVisits(items ?? [], obs)} declared={declared} onClose={() => setCreating(false)} />}
    </main>
  );
}

function VisitCard({ v, urls }: { v: Visit<SavedArtwork>; urls: Map<string, string | undefined> }) {
  return (
    <Link className="visit-card" to={`/collection/visite/${encodeURIComponent(v.id)}`}>
      <span className="visit-place">{v.place}</span>
      <span className="mono-meta">
        {frDay(v.day)} · {plural(v.works.length, 'œuvre')}
      </span>
      {v.exhibition && <span className="t-small t-muted">Exposition : {v.exhibition}</span>}
      <ThumbRow works={v.works} urls={urls} link={false} />
    </Link>
  );
}

async function saveDeclared(declared: string[], name: string) {
  if (!declared.some((d) => d.toLowerCase() === name.toLowerCase())) await setSetting('exhibitions', [...declared, name]);
}

async function setVisitExhibition(works: SavedArtwork[], name: string | undefined) {
  const now = Date.now();
  await db.transaction('rw', db.artworks, async () => {
    for (const w of works) await db.artworks.update(w.id, { exhibition: name, updatedAt: now });
  });
}

/** Nouvelle exposition : un nom, puis les visites qui en font partie. */
function NewExhibitionSheet({ visits, declared, onClose }: { visits: Visit<SavedArtwork>[]; declared: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const toast = useToast();
  async function submit() {
    const n = name.trim();
    if (!n) return;
    await saveDeclared(declared, n);
    await setVisitExhibition(visits.filter((v) => picked.includes(v.id)).flatMap((v) => v.works), n);
    toast('Exposition créée');
    onClose();
  }
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="expo-new-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet-body stack-16"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="expo-new-title" className="t-head">
          Nouvelle exposition
        </h2>
        <label className="field">
          <span>Nom de l’exposition</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {visits.length > 0 && (
          <fieldset className="stack-8" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-legend">Visites concernées</legend>
            {visits.map((v) => (
              <label key={v.id} className="check-row">
                <input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))} />
                <span>
                  {v.place}
                  <span className="mono-meta">
                    {frDay(v.day)} · {plural(v.works.length, 'œuvre')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <button className="btn btn-block" disabled={!name.trim()}>
          Créer
        </button>
      </form>
    </div>,
    document.body
  );
}

/** Choisir l'exposition d'une visite : une existante, ou une nouvelle. */
function ChooseExhibitionSheet({ visit, declared, known, onClose }: { visit: Visit<SavedArtwork>; declared: string[]; known: string[]; onClose: () => void }) {
  const [sel, setSel] = useState<string | undefined>(visit.exhibition);
  const [fresh, setFresh] = useState('');
  const [names, setNames] = useState(known);
  const toast = useToast();
  async function add() {
    const n = fresh.trim();
    if (!n) return;
    await saveDeclared(declared, n);
    if (!names.includes(n)) setNames([...names, n]);
    setSel(n);
    setFresh('');
  }
  async function submit(name: string | undefined) {
    await setVisitExhibition(visit.works, name);
    toast(name ? 'Exposition enregistrée' : 'Exposition retirée');
    onClose();
  }
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="expo-choose-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-body stack-16">
        <h2 id="expo-choose-title" className="t-head">
          Exposition de la visite
        </h2>
        {names.length > 0 && (
          <div className="chips" role="group" aria-label="Expositions">
            {names.map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={sel === n} onClick={() => setSel(sel === n ? undefined : n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <label style={{ flex: 1 }}>
            <span className="sr-only">Nouvelle exposition</span>
            <input className="input" value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="Nouvelle exposition" onKeyDown={(e) => e.key === 'Enter' && void add()} />
          </label>
          <button type="button" className="btn btn-ghost btn-small" onClick={add}>
            Créer
          </button>
        </div>
        <button className="btn btn-block" onClick={() => submit(sel)}>
          Enregistrer
        </button>
        {visit.exhibition && (
          <button className="linkbtn" onClick={() => submit(undefined)}>
            Retirer l’exposition
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

function WorksGrid({ works, urls }: { works: SavedArtwork[]; urls: Map<string, string | undefined> }) {
  return (
    <div className="works-2">
      {works.map((a) => (
        <WorkTile key={a.id} to={`/oeuvre/${encodeURIComponent(a.id)}`} img={urls.get(a.id)} artist={a.entry.artist} title={a.entry.title} date={a.entry.date} />
      ))}
    </div>
  );
}

export function VisitPage() {
  const { id = '' } = useParams();
  const { items, obs, declared } = useOrganized();
  const urls = useThumbs(items);
  const [choosing, setChoosing] = useState(false);
  const visits = useMemo(() => groupVisits(items ?? [], obs), [items, obs]);
  const known = useMemo(() => groupExhibitions(items ?? [], obs, declared).exhibitions.map((e) => e.name), [items, obs, declared]);
  const v = visits.find((x) => x.id === id);
  if (items && !v)
    return (
      <main>
        <TopBar back="Collection" backTo="/collection" />
        <div className="page">
          <p className="t-muted">Cette visite n’existe plus.</p>
        </div>
      </main>
    );
  if (!v) return null;
  return (
    <main>
      <TopBar back="Collection" backTo="/collection" />
      <div className="page stack-24" style={{ paddingTop: 8 }}>
        <header>
          <h1 className="t-title">{v.place}</h1>
          <p className="mono-meta">
            {frDay(v.day)} · {plural(v.works.length, 'œuvre')}
          </p>
        </header>
        <div className="expo-row">
          <div>
            <strong className="t-small">Exposition</strong>
            <span className="t-small t-muted" style={{ display: 'block' }}>
              {v.exhibition ?? 'Aucune pour cette visite'}
            </span>
          </div>
          <button className="btn btn-ghost btn-small" onClick={() => setChoosing(true)}>
            Choisir
          </button>
        </div>
        <WorksGrid works={v.works} urls={urls} />
      </div>
      {choosing && <ChooseExhibitionSheet visit={v} declared={declared} known={known} onClose={() => setChoosing(false)} />}
    </main>
  );
}

export function ExhibitionPage() {
  const { name = '' } = useParams();
  const { items, obs, declared } = useOrganized();
  const urls = useThumbs(items);
  const e = useMemo(() => groupExhibitions(items ?? [], obs, declared).exhibitions.find((x) => x.name === name), [items, obs, declared, name]);
  if (!items) return null;
  return (
    <main>
      <TopBar back="Collection" backTo="/collection?vue=expositions" />
      <div className="page stack-24" style={{ paddingTop: 8 }}>
        <header>
          <h1 className="t-title work-title">{name}</h1>
          {e?.place && <p className="t-small t-muted">{e.place}</p>}
          <p className="mono-meta">
            {plural(e?.works.length ?? 0, 'œuvre')}
            {e && e.visitCount > 1 ? ` · vues lors de ${e.visitCount} visites` : ''}
          </p>
        </header>
        {e && e.works.length ? <WorksGrid works={e.works} urls={urls} /> : <p className="t-muted">Aucune œuvre pour l’instant. Choisissez cette exposition depuis une visite.</p>}
      </div>
    </main>
  );
}
