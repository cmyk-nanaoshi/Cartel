import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SavedArtwork } from '../lib/db';
import { collectionToCsv, collectionToPdf, download } from '../lib/export';
import { Icon, WorkTile, useToast } from '../components/ui';
import { t } from '../i18n';

type Sort = 'recent' | 'artist' | 'title' | 'date';

function norm(s: string | null | undefined) {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Recherche locale sur titre, artiste, date, mouvement, technique, notes et tags. */
export function matches(a: SavedArtwork, q: string) {
  if (!q) return true;
  const e = a.entry;
  const hay = norm([e.title, e.artist, e.date, e.movement, e.technique, e.objectKind, e.institution, a.notes, a.tags.join(' ')].join(' '));
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function firstYear(d: string | null) {
  const m = d?.match(/\d{3,4}/);
  return m ? Number(m[0]) : Infinity;
}

export function Collection() {
  const [params, setParams] = useSearchParams();
  const items = useLiveQuery(() => db.artworks.toArray(), []);
  const cols = useLiveQuery(() => db.collections.orderBy('name').toArray(), []);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('recent');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tag = params.get('tag');
  const col = params.get('collection');

  const list = useMemo(() => {
    let l = (items ?? []).filter((a) => matches(a, q));
    if (tag) l = l.filter((a) => a.tags.includes(tag));
    if (col) l = l.filter((a) => a.collectionIds.includes(col));
    const cmp: Record<Sort, (a: SavedArtwork, b: SavedArtwork) => number> = {
      recent: (a, b) => b.createdAt - a.createdAt,
      artist: (a, b) => a.entry.artist.localeCompare(b.entry.artist, 'fr'),
      title: (a, b) => a.entry.title.localeCompare(b.entry.title, 'fr'),
      date: (a, b) => firstYear(a.entry.date) - firstYear(b.entry.date)
    };
    return [...l].sort(cmp[sort]);
  }, [items, q, sort, tag, col]);

  const urls = useMemo(() => list.map((a) => (a.photo ? URL.createObjectURL(a.photo) : a.entry.imageUrl)), [list]);
  useEffect(() => () => urls.forEach((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u)), [urls]);

  const allTags = useMemo(() => [...new Set((items ?? []).flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b, 'fr')), [items]);

  const setFilter = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

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
    setFilter('collection', null);
  }

  return (
    <main className="page">
      <header className="pagehead">
        <h1 className="t-display">{t('collection.title')}</h1>
        <span className="t-small t-muted num">
          {items?.length ?? 0} œuvre{(items?.length ?? 0) > 1 ? 's' : ''}
        </span>
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
          <div className="grid" style={{ rowGap: 12 }}>
            <label className="span-all md-span-5 lg-span-8" style={{ position: 'relative' }}>
              <span className="sr-only">Rechercher dans la collection</span>
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste, titre, mouvement…" style={{ paddingLeft: 40 }} />
              <span style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-3)' }}>
                <Icon name="search" size={20} />
              </span>
            </label>
            <label className="span-all md-span-3 lg-span-4">
              <span className="sr-only">Trier</span>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Ajout le plus récent</option>
                <option value="artist">Artiste (A à Z)</option>
                <option value="title">Titre (A à Z)</option>
                <option value="date">Date de l’œuvre</option>
              </select>
            </label>
          </div>

          {(cols?.length || allTags.length) ? (
            <div className="stack-8">
              {!!cols?.length && (
                <div className="chips" aria-label="Collections thématiques">
                  {cols.map((c) => (
                    <button key={c.id} className="chip" aria-pressed={col === c.id} onClick={() => setFilter('collection', col === c.id ? null : c.id)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {!!allTags.length && (
                <div className="chips" aria-label="Tags">
                  {allTags.map((tg) => (
                    <button key={tg} className="chip" aria-pressed={tag === tg} onClick={() => setFilter('tag', tag === tg ? null : tg)}>
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
          ) : null}

          {list.length === 0 ? (
            <p className="t-muted">Aucune œuvre ne correspond à ces critères.</p>
          ) : (
            <div className="works">
              {list.map((a, i) => (
                <WorkTile key={a.id} to={`/oeuvre/${encodeURIComponent(a.id)}`} img={urls[i]} artist={a.entry.artist} title={a.entry.title} date={a.entry.date} />
              ))}
            </div>
          )}

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
    </main>
  );
}
