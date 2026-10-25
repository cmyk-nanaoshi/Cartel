import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LabelFields, SourceRecord } from '../../shared/types';
import { candidateFromRecord, entryKey, slugify } from '../../shared/slug';
import { session, useSession } from '../lib/session';
import { api } from '../lib/api';
import { BackLink, Notice } from '../components/ui';

const FIELDS: [keyof LabelFields, string][] = [
  ['artist', 'Artiste'],
  ['artistDates', 'Dates de l’artiste'],
  ['title', 'Titre'],
  ['date', 'Date de l’œuvre'],
  ['medium', 'Matériaux et technique'],
  ['dimensions', 'Dimensions'],
  ['inventory', 'Numéro d’inventaire'],
  ['institution', 'Musée ou collection'],
  ['creditLine', 'Mode d’acquisition'],
  ['description', 'Texte descriptif']
];

export function LabelReview() {
  const s = useSession();
  const nav = useNavigate();
  const [f, setF] = useState<LabelFields | undefined>(s.label);
  const [results, setResults] = useState<SourceRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = useMemo(() => (s.labelPhoto ? URL.createObjectURL(s.labelPhoto) : undefined), [s.labelPhoto]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!f)
    return (
      <main className="page stack-16">
        <p>Aucun cartel en cours de lecture.</p>
        <Link className="btn" to="/scanner?mode=cartel">
          Photographier un cartel
        </Link>
      </main>
    );

  const upd = (k: keyof LabelFields, v: string) => setF({ ...f, [k]: v || null });
  const validated = () => {
    session.set({ label: f });
    return f;
  };

  // Le cartel correspond-il à l'œuvre analysée juste avant ?
  const analysed = s.response?.candidates?.[0];
  const matchesAnalysed =
    analysed && f.title && f.artist
      ? slugify(f.artist).split('-').some((p) => p.length > 2 && slugify(analysed.artist).includes(p)) ||
        slugify(f.title).split('-').filter((p) => p.length > 3).some((p) => slugify(analysed.title).includes(p))
      : false;

  async function search() {
    const label = validated();
    if (!label.title && !label.artist) return setErr('Indiquez au moins un titre ou un artiste.');
    setSearching(true);
    setErr(null);
    try {
      const r = await api.search({ title: label.title ?? undefined, artist: label.artist ?? undefined });
      setResults(r.records);
      if (r.errors.length) setErr(r.errors.join(' ; '));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSearching(false);
    }
  }

  function openWith(candidate: any) {
    const label = validated();
    nav(`/oeuvre/${encodeURIComponent(candidate.key)}`, { state: { candidate, label, fromScan: true } });
  }

  return (
    <main className="page">
      <BackLink to="/scanner?mode=cartel" label="Reprendre la photo" />
      <header className="pagehead">
        <h1 className="t-title">Vérifiez le cartel</h1>
      </header>
      <div className="grid">
        <div className="span-all md-span-3 lg-span-4 stack-16">
          {url && <img src={url} alt="Photo du cartel" style={{ width: '100%', border: '1px solid var(--rule)' }} />}
          <p className="t-small t-muted">
            {s.labelSource === 'ocr-local'
              ? 'Texte lu sur votre téléphone par OCR, sans IA. Les champs sont devinés : corrigez-les avant de continuer.'
              : 'Texte lu par l’IA. Relisez et corrigez si besoin : rien n’est enregistré sans votre validation.'}
          </p>
        </div>
        <form className="span-all md-span-5 lg-span-8 stack-16" onSubmit={(e) => (e.preventDefault(), search())}>
          {FIELDS.map(([k, label]) => (
            <label key={k} className="field">
              <span>{label}</span>
              {k === 'description' ? (
                <textarea className="textarea" value={f[k] ?? ''} onChange={(e) => upd(k, e.target.value)} />
              ) : (
                <input className="input" value={f[k] ?? ''} onChange={(e) => upd(k, e.target.value)} />
              )}
            </label>
          ))}
          <details>
            <summary className="t-small t-muted" style={{ cursor: 'pointer' }}>
              Texte brut lu
            </summary>
            <pre className="t-small" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{f.rawText}</pre>
          </details>

          {err && <Notice kind="error">{err}</Notice>}

          {matchesAnalysed && analysed && (
            <Notice kind="info" title="Ce cartel semble correspondre à l’œuvre que vous venez d’analyser">
              <p style={{ margin: '4px 0 8px' }}>
                {analysed.artist}, <i>{analysed.title}</i>
              </p>
              <button type="button" className="btn btn-small" onClick={() => openWith({ key: analysed.key, title: analysed.title, artist: analysed.artist, date: analysed.date, records: analysed.records })}>
                Associer le cartel à cette œuvre
              </button>
            </Notice>
          )}

          <div className="row">
            <button className="btn" type="submit" disabled={searching}>
              {searching ? <span className="spinner" /> : null} Rechercher l’œuvre dans les catalogues
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!f.title || !f.artist}
              onClick={() => openWith({ key: entryKey(f.artist!, f.title!), title: f.title!, artist: f.artist!, date: f.date, records: [] })}
            >
              Créer la fiche depuis le cartel seul
            </button>
          </div>

          {results && (
            <section className="stack-8" aria-label="Notices trouvées">
              <h2 className="t-head">{results.length ? 'Notices trouvées' : 'Aucune notice trouvée'}</h2>
              <ul className="list-plain">
                {results.map((r) => (
                  <li key={r.id} className="row-between">
                    <div>
                      <div className="artist">{r.artist ?? 'Artiste inconnu'}</div>
                      <div className="work-title">{r.title}</div>
                      <div className="t-small t-muted">
                        {[r.date, r.institution, r.sourceLabel].filter(Boolean).join(', ')}
                      </div>
                    </div>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => openWith(candidateFromRecord(r))}>
                      C’est celle-ci
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </form>
      </div>
    </main>
  );
}
