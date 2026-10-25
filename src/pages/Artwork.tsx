import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ArtworkEntry, Claim, EntryRequest, LabelFields } from '../../shared/types';
import { OBJECT_KIND_LABEL } from '../../shared/types';
import { db, uid, type SavedArtwork } from '../lib/db';
import { api } from '../lib/api';
import { session } from '../lib/session';
import { BackLink, Cartel, Icon, Notice, useToast } from '../components/ui';
import { t } from '../i18n';

const KIND_LABEL: Record<Claim['kind'], string> = { fait: 'Fait documenté', interpretation: 'Interprétation', hypothese: 'Hypothèse' };

export function Artwork() {
  const { key = '' } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const state = (loc.state ?? {}) as { candidate?: EntryRequest['candidate']; vision?: EntryRequest['vision']; label?: LabelFields; fromScan?: boolean };
  const saved = useLiveQuery(() => db.artworks.get(key), [key]);
  const [entry, setEntry] = useState<ArtworkEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'repro' | 'photo'>('repro');
  const [editing, setEditing] = useState(false);

  // Chargement : collection, puis cache local, puis génération.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (saved === undefined) {
        const s = await db.artworks.get(key);
        if (s) return;
      }
      if (saved) {
        setEntry(saved.entry);
        return;
      }
      const cached = await db.entries.get(key);
      if (cached) {
        setEntry(cached.entry);
        return;
      }
      if (!state.candidate) {
        setError('Cette fiche n’est pas disponible hors de la session où elle a été ouverte. Relancez l’analyse ou la recherche.');
        return;
      }
      setLoading(true);
      try {
        const e = await api.entry({ candidate: state.candidate, vision: state.vision, label: state.label });
        if (cancelled) return;
        await db.entries.put({ id: key, entry: e, createdAt: Date.now() });
        setEntry(e);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, saved?.id]);

  const userPhoto = saved?.photo ?? (state.fromScan ? session.get().thumb : undefined);
  const photoUrl = useMemo(() => (userPhoto ? URL.createObjectURL(userPhoto) : undefined), [userPhoto]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const label = saved?.label ?? state.label;

  async function save() {
    if (!entry) return;
    const now = Date.now();
    const s = session.get();
    const item: SavedArtwork = {
      id: key,
      entry,
      photo: state.fromScan ? s.thumb : undefined,
      notes: '',
      tags: [],
      collectionIds: [],
      geo: state.fromScan ? s.geo : undefined,
      label: state.label ?? (state.fromScan ? s.label : undefined),
      createdAt: now,
      updatedAt: now
    };
    await db.artworks.put(item);
    toast('Ajoutée à votre collection');
  }

  async function remove() {
    if (!confirm('Retirer cette œuvre de votre collection ? Vos notes seront supprimées.')) return;
    await db.artworks.delete(key);
    await db.chats.delete(key);
    toast('Retirée de votre collection');
  }

  if (error && !entry)
    return (
      <main className="page stack-16">
        <BackLink />
        <Notice kind="error" title="Fiche indisponible">
          {error}
        </Notice>
        {state.candidate && (
          <button className="btn" onClick={() => nav(0)}>
            Réessayer
          </button>
        )}
      </main>
    );

  if (!entry || loading)
    return (
      <main>
        <div className="wall">
          <div className="stage">{photoUrl ? <img src={photoUrl} alt="Votre photo" /> : null}</div>
        </div>
        <div className="page stack-16" aria-live="polite">
          {state.candidate && (
            <div>
              <div className="artist">{state.candidate.artist}</div>
              <div className="work-title t-head">{state.candidate.title}</div>
            </div>
          )}
          <p className="row t-muted">
            <span className="spinner" /> Rédaction de la fiche à partir de {state.candidate?.records.length ?? 0} notice
            {(state.candidate?.records.length ?? 0) > 1 ? 's' : ''} de musée…
          </p>
        </div>
      </main>
    );

  const srcIndex = new Map(entry.sources.map((s, i) => [s.id, i + 1]));
  const hasRepro = !!entry.imageUrl;
  const showPhoto = (view === 'photo' || !hasRepro) && photoUrl;
  const rawBio = entry.sources.find((s) => s.artistBio)?.artistBio;
  // « Georges Seurat (French, 1859–1891) » : on ne garde que la partie entre parenthèses si le nom est répété.
  const artistBio = rawBio && rawBio.startsWith(entry.artist) ? rawBio.slice(entry.artist.length).replace(/^[\s,]+/, '').replace(/^\((.*)\)$/, '$1') || undefined : rawBio;

  return (
    <main>
      <div className="wall">
        <div className="stage">
          {showPhoto ? (
            <img src={photoUrl} alt="Votre photo de l’œuvre" />
          ) : hasRepro ? (
            <img src={entry.imageUrl} alt={`Reproduction : ${entry.title}`} />
          ) : (
            <p style={{ color: 'var(--wall-ink-2)' }}>Pas de reproduction libre de droits disponible.</p>
          )}
        </div>
        <div className="stage-credit row-between">
          <span>{showPhoto ? 'Votre photo' : entry.imageCredit ?? ''}</span>
          {hasRepro && photoUrl && (
            <button className="linkbtn" style={{ color: 'var(--wall-ink)' }} onClick={() => setView(view === 'photo' ? 'repro' : 'photo')}>
              {view === 'photo' ? 'Voir la reproduction' : 'Voir ma photo'}
            </button>
          )}
        </div>
      </div>

      <div className="page">
        <BackLink />
        <div className="grid" style={{ marginTop: 8 }}>
          <aside className="span-all lg-span-4 stack-16">
            <Cartel entry={{ ...entry, artistBio }} saved={!!saved} />
            <p className="t-small t-muted">{OBJECT_KIND_LABEL[entry.objectKind]}</p>
            {saved && (
              <div className="stack-8">
                {saved.notes && <p className="reading" style={{ fontSize: 'var(--t-s)', lineHeight: 'var(--lh-s)' }}>« {saved.notes} »</p>}
                {saved.tags.length > 0 && (
                  <div className="chips">
                    {saved.tags.map((tg) => (
                      <Link className="chip" key={tg} to={`/collection?tag=${encodeURIComponent(tg)}`}>
                        {tg}
                      </Link>
                    ))}
                  </div>
                )}
                <button className="btn btn-ghost btn-small" onClick={() => setEditing(true)}>
                  Notes, tags et collections
                </button>
              </div>
            )}
            {label && (
              <details className="t-small">
                <summary style={{ cursor: 'pointer' }}>Cartel relevé sur place</summary>
                <dl className="kv" style={{ marginTop: 8 }}>
                  {Object.entries(label)
                    .filter(([k, v]) => v && k !== 'rawText')
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </details>
            )}
          </aside>

          <article className="span-all lg-span-7 lg-start-6 stack-24">
            {entry.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
            <div className="legend" aria-label="Légende">
              <span>
                <sup style={{ color: 'var(--brass)', fontWeight: 650 }}>1</sup> fait documenté, avec sa source
              </span>
              <span>
                <span className="claim">
                  <span className="kind kind-interpretation">Interprétation</span>
                </span>
                non sourcée
              </span>
              <span>
                <span className="claim">
                  <span className="kind kind-hypothese">Hypothèse</span>
                </span>
                incertain
              </span>
            </div>

            {entry.sections.length === 0 && <p className="t-muted">Aucune information vérifiable n’a pu être rassemblée pour cette œuvre.</p>}

            {entry.sections.map((s) => (
              <section key={s.id} className="entry-section">
                <h2>{s.title}</h2>
                <div className="reading measure">
                  {s.claims.map((c, i) => (
                    <p key={i} className="claim">
                      {c.kind !== 'fait' && (
                        <span className={`kind kind-${c.kind}`} title={c.unsourced ? 'Présenté comme un fait par l’IA, mais sans source : à vérifier' : KIND_LABEL[c.kind]}>
                          {c.unsourced ? 'Non sourcé' : KIND_LABEL[c.kind]}
                        </span>
                      )}
                      {c.text}
                      {c.sources.map((sid) =>
                        srcIndex.has(sid) ? (
                          <sup key={sid}>
                            <a href={`#src-${srcIndex.get(sid)}`} aria-label={`Source ${srcIndex.get(sid)}`}>
                              {srcIndex.get(sid)}
                            </a>
                          </sup>
                        ) : null
                      )}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <section className="entry-section" id="sources">
              <h2>{t('entry.sources')}</h2>
              {entry.sources.length ? (
                <ol className="sources-list">
                  {entry.sources.map((s, i) => (
                    <li key={s.id} id={`src-${i + 1}`}>
                      <span className="sid num">{i + 1}</span>
                      <span>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.sourceLabel}
                        </a>
                        {s.title ? `, « ${s.title} »` : ''}
                        {s.inventory ? `, inv. ${s.inventory}` : ''}
                        {s.imageLicense ? <span className="t-faint"> Image : {s.imageLicense}.</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="t-small t-muted">Aucune notice de musée n’a été trouvée. Le contenu de cette fiche n’est pas vérifié.</p>
              )}
              <p className="t-small t-faint" style={{ marginTop: 12 }}>
                {entry.aiWritten
                  ? `Texte rédigé par ${entry.model} à partir de ${entry.sources.length} notice${entry.sources.length > 1 ? 's' : ''}, le ${new Date(entry.generatedAt).toLocaleDateString('fr-FR')}. Les interprétations ne sont pas vérifiées par une source.`
                  : 'Fiche construite à partir des champs des notices, sans rédaction par IA.'}
              </p>
            </section>

            {entry.comparables.length > 0 && (
              <section className="entry-section stack-16">
                <h2>{t('entry.comparables')}</h2>
                <div className="comparables">
                  {entry.comparables.map((c) => (
                    <a key={c.sourceId} href={c.url} target="_blank" rel="noreferrer" className="work" style={{ gridColumn: 'auto' }}>
                      <div className="work-frame">{c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" /> : null}</div>
                      <div className="work-label">
                        <span className="work-title">{c.title}</span>
                        {c.date && <span className="t-muted">{c.date}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </article>
        </div>
      </div>

      <div className="actionbar">
        {saved ? (
          <button className="btn btn-ghost" onClick={remove}>
            <span className="redot-inline" /> {t('entry.saved')}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={save}>
            {t('entry.save')}
          </button>
        )}
        <Link className="btn" to={`/oeuvre/${encodeURIComponent(key)}/questions`} state={{ entry }}>
          {t('entry.ask')}
        </Link>
      </div>

      {editing && saved && <EditSheet item={saved} onClose={() => setEditing(false)} />}
    </main>
  );
}

function EditSheet({ item, onClose }: { item: SavedArtwork; onClose: () => void }) {
  const cols = useLiveQuery(() => db.collections.orderBy('name').toArray(), []);
  const [notes, setNotes] = useState(item.notes);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [colIds, setColIds] = useState<string[]>(item.collectionIds);
  const [newCol, setNewCol] = useState('');
  const toast = useToast();

  async function addCol() {
    const name = newCol.trim();
    if (!name) return;
    const id = uid();
    await db.collections.put({ id, name, description: '', createdAt: Date.now(), updatedAt: Date.now() });
    setColIds((c) => [...c, id]);
    setNewCol('');
  }

  async function submit() {
    await db.artworks.update(item.id, {
      notes: notes.trim(),
      tags: [...new Set(tags.split(',').map((x) => x.trim()).filter(Boolean))],
      collectionIds: colIds,
      updatedAt: Date.now()
    });
    toast('Modifications enregistrées');
    onClose();
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Modifier" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-body stack-16">
        <div className="row-between">
          <h2 className="t-head">Notes, tags et collections</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        <label className="field">
          <span>Note personnelle</span>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field">
          <span>Tags, séparés par des virgules</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="lumière, portrait, mémoire" />
        </label>
        <fieldset className="stack-8" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-small t-muted">Collections thématiques</legend>
          <div className="chips">
            {(cols ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={colIds.includes(c.id)}
                onClick={() => setColIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="Nouvelle collection" />
            <button type="button" className="btn btn-ghost btn-small" onClick={addCol}>
              Créer
            </button>
          </div>
        </fieldset>
        <button className="btn btn-block" onClick={submit}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
