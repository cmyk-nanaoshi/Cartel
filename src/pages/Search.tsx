import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SourceRecord } from '../../shared/types';
import { candidateFromRecord } from '../../shared/slug';
import { api, museumImg } from '../lib/api';
import { BackLink, Notice } from '../components/ui';
import { t } from '../i18n';

export function RecordGrid({ records }: { records: SourceRecord[] }) {
  const nav = useNavigate();
  const open = (r: SourceRecord) => {
    const c = candidateFromRecord(r);
    nav(`/oeuvre/${encodeURIComponent(c.key)}`, { state: { candidate: c } });
  };
  return (
    <div className="works">
      {records.map((r) => (
        <button key={r.id} className="work" onClick={() => open(r)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}>
          <div className="work-frame contain">
            {r.thumbnailUrl || r.imageUrl ? (
              <img
                src={museumImg(r.thumbnailUrl ?? r.imageUrl)}
                alt=""
                loading="lazy"
                onError={(e) => {
                  // Image introuvable à la source : on retire l'image cassée et on garde la notice.
                  const el = e.currentTarget;
                  el.replaceWith(Object.assign(document.createElement('span'), { className: 't-small img-missing', textContent: 'Image indisponible' }));
                }}
              />
            ) : (
              <span className="t-small img-missing">Sans image</span>
            )}
          </div>
          <div className="work-label">
            <span className="artist">{r.artist ?? 'Artiste inconnu'}</span>
            <span className="work-title">{r.title ?? 'Sans titre'}</span>
            <span className="t-muted">{[r.date, r.sourceLabel].filter(Boolean).join(', ')}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [artist, setArtist] = useState(params.get('artist') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [records, setRecords] = useState<SourceRecord[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const label = params.get('label');

  async function run(p: { title?: string; artist?: string; q?: string }) {
    if (!p.title && !p.artist && !p.q) return;
    setLoading(true);
    setErrors([]);
    try {
      const r = await api.search(p);
      setRecords(r.records);
      setErrors(r.errors);
    } catch (e: any) {
      setErrors([e.message]);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run({ title: params.get('title') ?? undefined, artist: params.get('artist') ?? undefined, q: params.get('q') ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="page">
      <BackLink />
      <header className="pagehead">
        <h1 className="t-display">{label ?? t('search.title')}</h1>
      </header>
      <form
        className="grid"
        style={{ rowGap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          const p = Object.fromEntries(Object.entries({ title, artist, q }).filter(([, v]) => v.trim()));
          setParams(p, { replace: true });
          run(p);
        }}
      >
        <label className="field span-all md-span-3 lg-span-4">
          <span>Titre</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="La Liberté guidant le peuple" />
        </label>
        <label className="field span-all md-span-3 lg-span-4">
          <span>Artiste</span>
          <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Delacroix" />
        </label>
        <label className="field span-all md-span-2 lg-span-4">
          <span>Mot-clé, mouvement</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Impressionism" />
        </label>
        <div className="span-all">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : null} Rechercher dans les catalogues
          </button>
        </div>
      </form>

      <div className="stack-16" style={{ marginTop: 32 }}>
        {errors.map((e) => (
          <Notice key={e}>{e}</Notice>
        ))}
        {records && !loading && (records.length ? <RecordGrid records={records} /> : <p className="t-muted">Aucune notice trouvée. Essayez le titre original ou en anglais.</p>)}
        <p className="t-small t-faint">Ouvrir une œuvre génère sa fiche (appel à l’IA si elle est configurée).</p>
      </div>
    </main>
  );
}
