import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { SourceRecord } from '../../shared/types';
import { candidateFromRecord } from '../../shared/slug';
import { api, museumImg } from '../lib/api';
import { Notice } from '../components/ui';
import { TopBar } from '../components/Chrome';
import { MOVEMENTS } from '../lib/movements';
import { t } from '../i18n';

export function RecordGrid({ records }: { records: SourceRecord[] }) {
  const nav = useNavigate();
  const open = (r: SourceRecord) => {
    const c = candidateFromRecord(r);
    nav(`/oeuvre/${encodeURIComponent(c.key)}`, { state: { candidate: c } });
  };
  return (
    <div className="works-2">
      {records.map((r) => (
        <button key={r.id} className="work" onClick={() => open(r)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}>
          <div className="work-frame">
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
            <span className="work-title">{r.title ?? 'Sans titre'}</span>
            <span className="mono">{[r.artist ?? 'Artiste inconnu', r.date].filter(Boolean).join(' · ')}</span>
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

  const empty = !records && !loading && !params.get('q') && !params.get('title') && !params.get('artist');
  return (
    <main>
      <TopBar back="Viseur" backTo="/" />
      <div className="page" style={{ paddingTop: 8 }}>
        <h1 className="t-display">{label ?? t('search.title')}</h1>
        <form
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const p: Record<string, string> = q.trim() ? { q: q.trim() } : {};
            setParams(p, { replace: true });
            run(p);
          }}
        >
          <label className="field">
            <span>Titre, artiste ou musée</span>
            <input className="input" type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste, titre, mouvement…" />
          </label>
        </form>

        {empty ? (
          <div style={{ marginTop: 32 }}>
            <h2 className="rubric">Par mouvement</h2>
            <div className="chips">
              {MOVEMENTS.map((m) => (
                <button
                  key={m.query}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setQ(m.query);
                    setParams({ q: m.query, label: m.label }, { replace: true });
                    run({ q: m.query });
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <h2 className="rubric" style={{ marginTop: 32 }}>Sans idée précise</h2>
            <Link className="btn btn-secondary btn-block" to="/hasard">
              Œuvres au hasard
            </Link>
            <p className="t-small t-muted" style={{ marginTop: 8 }}>Douze œuvres du domaine public, tirées au hasard.</p>
          </div>
        ) : (
          <div className="stack-16" style={{ marginTop: 24 }}>
            {loading && <p className="row t-muted"><span className="spinner" /> Recherche en cours…</p>}
            {records && !records.length && errors.length > 0 && <Notice>La recherche n’a pas abouti. Réessayez dans un instant.</Notice>}
            {records && !loading && (records.length ? (
              <>
                <h2 className="rubric">Résultats</h2>
                <RecordGrid records={records} />
              </>
            ) : <p className="t-muted">Aucune œuvre trouvée. Essayez le titre original ou en anglais.</p>)}
          </div>
        )}
      </div>
    </main>
  );
}
