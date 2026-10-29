import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ArtworkEntry, Claim, EntryRequest, LabelFields } from '../../shared/types';
import { OBJECT_KIND_LABEL } from '../../shared/types';
import { db, uid, type SavedArtwork } from '../lib/db';
import { api, museumImg } from '../lib/api';
import { frTypo } from '../../shared/typo';
import { session } from '../lib/session';
import { BackLink, Cartel, Icon, Notice, useToast } from '../components/ui';
import { t } from '../i18n';
import { ObservationsSection } from '../components/Observations';
import { lotFromText } from '../../shared/observations';

const KIND_LABEL: Record<Claim['kind'], string> = {
  fait: 'Fait documenté',
  observation: 'Observé',
  interpretation: 'Interprétation',
  hypothese: 'Hypothèse'
};
const KIND_HELP: Record<Claim['kind'], string> = {
  fait: 'Présent dans une source, avec son renvoi',
  observation: 'Visible sur votre photo',
  interpretation: 'Lecture ou savoir général, hors des sources',
  hypothese: 'Incertain ou débattu'
};

const LABEL_FIELD_FR: Record<string, string> = {
  title: 'Titre',
  artist: 'Artiste',
  artistDates: 'Dates de l’artiste',
  date: 'Date',
  medium: 'Technique',
  dimensions: 'Dimensions',
  inventory: 'Inventaire',
  institution: 'Institution',
  creditLine: 'Crédit',
  description: 'Texte'
};

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
  // La photo du visiteur passe en premier : il est devant l'œuvre, c'est son image de référence.
  const [view, setView] = useState<'photo' | 'repro'>('photo');
  const [reproBroken, setReproBroken] = useState(false);
  const [brokenComparables, setBrokenComparables] = useState<Set<string>>(() => new Set());
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

  // Photo en pleine définition (1568 px) plutôt que la vignette de 640 px.
  const userPhoto = saved?.photo ?? (state.fromScan ? session.get().photo ?? session.get().thumb : undefined);
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
      photo: state.fromScan ? s.photo ?? s.thumb : undefined,
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
  const hasRepro = !!entry.imageUrl && !reproBroken;
  const showPhoto = !!photoUrl && (view === 'photo' || !hasRepro);
  const rawBio = entry.sources.find((s) => s.artistBio && s.source !== 'cartel')?.artistBio;
  // « Georges Seurat (French, 1859–1891) » : on ne garde que la partie entre parenthèses si le nom est répété.
  // La ligne en français (cartel ou traduction) passe avant la notice brute.
  const artistBio =
    entry.artistLine ??
    (rawBio && rawBio.startsWith(entry.artist) ? rawBio.slice(entry.artist.length).replace(/^[\s,]+/, '').replace(/^\((.*)\)$/, '$1') || undefined : rawBio);
  const kindsUsed = new Set(entry.sections.flatMap((s) => s.claims.map((c) => (c.unsourced ? 'unsourced' : c.kind))));
  const noticeCount = entry.sources.filter((s) => s.source !== 'cartel').length;
  const hasCartel = entry.sources.some((s) => s.source === 'cartel');
  const comparables = entry.comparables.filter((c) => c.imageUrl && !brokenComparables.has(c.sourceId));

  return (
    <main>
      <div className="wall">
        <div className="stage">
          {showPhoto ? (
            <img src={photoUrl} alt="Votre photo de l’œuvre" />
          ) : hasRepro ? (
            <img src={museumImg(entry.imageUrl)} alt={`Reproduction : ${entry.title}`} onError={() => setReproBroken(true)} />
          ) : (
            <p style={{ color: 'var(--wall-ink-2)' }}>Pas de reproduction disponible.</p>
          )}
        </div>
        <div className="stage-credit row-between">
          <span>{showPhoto ? 'Votre photo' : hasRepro ? frTypo(entry.imageCredit ?? '') : ''}</span>
          {hasRepro && photoUrl && (
            <button className="linkbtn" style={{ color: 'var(--wall-ink)' }} onClick={() => setView(view === 'photo' ? 'repro' : 'photo')}>
              {view === 'photo' ? 'Voir la reproduction du musée' : 'Revenir à ma photo'}
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
                    .filter(([k, v]) => v && k in LABEL_FIELD_FR)
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{LABEL_FIELD_FR[k]}</dt>
                        <dd>{frTypo(String(v))}</dd>
                      </div>
                    ))}
                </dl>
              </details>
            )}
          </aside>

          <article className="span-all lg-span-7 lg-start-6 stack-24">
            {entry.warnings.map((w) => (
              <Notice key={w}>{frTypo(w)}</Notice>
            ))}
            <div className="legend" aria-label="Légende">
              <span>
                <sup className="legend-sup">1</sup> {KIND_HELP.fait.toLowerCase()}
              </span>
              {(['observation', 'interpretation', 'hypothese'] as const)
                .filter((k) => kindsUsed.has(k))
                .map((k) => (
                  <span key={k}>
                    <span className={`kind kind-${k}`}>{KIND_LABEL[k]}</span>
                    {KIND_HELP[k].toLowerCase()}
                  </span>
                ))}
              {kindsUsed.has('unsourced') && (
                <span>
                  <span className="kind kind-unsourced">Non sourcé</span>
                  donné comme un fait, sans source&nbsp;: à vérifier
                </span>
              )}
            </div>

            {entry.sections.length === 0 && <p className="t-muted">Aucune information vérifiable n’a pu être rassemblée pour cette œuvre.</p>}

            {entry.sections.map((s) => (
              <section key={s.id} className="entry-section">
                <h2>{s.title}</h2>
                <div className="reading measure">
                  {s.claims.map((c, i) => (
                    <p key={i} className="claim">
                      {c.kind !== 'fait' && (
                        <span
                          className={`kind ${c.unsourced ? 'kind-unsourced' : `kind-${c.kind}`}`}
                          title={c.unsourced ? 'Présenté comme un fait par l’IA, mais sans source : à vérifier' : KIND_HELP[c.kind]}
                        >
                          {c.unsourced ? 'Non sourcé' : KIND_LABEL[c.kind]}
                        </span>
                      )}
                      {frTypo(c.text)}
                      <Refs ids={c.sources.filter((sid) => srcIndex.has(sid)).map((sid) => srcIndex.get(sid)!)} />
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <ObservationsSection
              artworkKey={key}
              artworkTitle={entry.title}
              artworkArtist={entry.artist}
              hints={{ placeName: label?.institution ?? null, lot: lotFromText([...(state.vision?.visibleText ?? []), ...(state.vision?.inscriptions ?? [])]) }}
              geo={saved?.geo ?? (state.fromScan ? session.get().geo : undefined)}
              photo={state.fromScan ? session.get().thumb : undefined}
            />

            <section className="entry-section" id="sources">
              <h2>{t('entry.sources')}</h2>
              {entry.sources.length ? (
                <ol className="sources-list">
                  {entry.sources.map((s, i) => (
                    <li key={s.id} id={`src-${i + 1}`}>
                      <span className="sid num">{i + 1}</span>
                      <span>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer">
                            {s.sourceLabel}
                          </a>
                        ) : (
                          <strong style={{ fontWeight: 650 }}>{s.sourceLabel}</strong>
                        )}
                        {frTypo(`${s.title ? `, « ${s.title} »` : ''}${s.inventory ? `, inv. ${s.inventory}` : ''}`)}
                        {s.source === 'cartel' && s.institution ? frTypo(`, ${s.institution}`) : ''}
                        {s.source === 'cartel' ? <span className="t-faint"> Fait foi pour l’exemplaire photographié.</span> : null}
                        {s.imageLicense ? <span className="t-faint"> {frTypo(`Image : ${s.imageLicense}.`)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="t-small t-muted">Aucune notice de musée n’a été trouvée. Le contenu de cette fiche n’est pas vérifié.</p>
              )}
              <p className="t-small t-faint" style={{ marginTop: 12 }}>
                {frTypo(
                  entry.aiWritten
                    ? `Texte rédigé par ${entry.model} à partir ${[hasCartel ? 'du cartel' : '', noticeCount ? `de ${noticeCount} notice${noticeCount > 1 ? 's' : ''} de musée` : ''].filter(Boolean).join(' et ') || 'd’aucune source'}, le ${new Date(entry.generatedAt).toLocaleDateString('fr-FR')}. Les observations, interprétations et hypothèses ne sont pas vérifiées par une source.`
                    : 'Fiche construite à partir des champs du cartel et des notices, sans rédaction par IA.'
                )}
              </p>
            </section>

            {/* Une suggestion sans image est contre-productive : seules les œuvres dont l'image s'affiche restent. */}
            {comparables.length > 0 && (
              <section className="entry-section stack-16">
                <h2>{t('entry.comparables')}</h2>
                <div className="comparables">
                  {comparables.map((c) => (
                    <a key={c.sourceId} href={c.url} target="_blank" rel="noreferrer" className="work" style={{ gridColumn: 'auto' }}>
                      <div className="work-frame">
                        <img
                          src={museumImg(c.imageUrl)}
                          alt=""
                          loading="lazy"
                          onError={() => setBrokenComparables((b) => new Set(b).add(c.sourceId))}
                        />
                      </div>
                      <div className="work-label">
                        <span className="work-title">{frTypo(c.title)}</span>
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
            {t('entry.saved')}
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

/** Appels de note groupés : « ¹,² », collés au mot, sans espace ni saut de ligne. */
function Refs({ ids }: { ids: number[] }) {
  const uniq = [...new Set(ids)].sort((a, b) => a - b);
  if (!uniq.length) return null;
  return (
    <sup className="refs">
      {uniq.map((n, i) => (
        <span key={n}>
          {i > 0 && ','}
          <a href={`#src-${n}`} aria-label={`Source ${n}`}>
            {n}
          </a>
        </span>
      ))}
    </sup>
  );
}
