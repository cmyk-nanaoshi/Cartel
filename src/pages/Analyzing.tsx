import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { session, useSession } from '../lib/session';
import { api, ApiError } from '../lib/api';
import { db } from '../lib/db';
import { sha256Hex } from '../lib/image';
import { ocrLabel } from '../lib/ocr';

type StepState = 'todo' | 'active' | 'done';

// Les étapes affichées correspondent à des appels réels, pas à une animation minutée.
export function Analyzing() {
  const s = useSession();
  const nav = useNavigate();
  const started = useRef(false);
  const [steps, setSteps] = useState<{ label: string; state: StepState }[]>([]);
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const shown = s.mode === 'label' ? s.labelPhoto : s.photo;
  const url = useMemo(() => (shown ? URL.createObjectURL(shown) : undefined), [shown]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!shown) {
      nav('/scanner', { replace: true });
      return;
    }
    s.mode === 'label' ? runLabel() : runArtwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(i: number, state: StepState) {
    setSteps((arr) => arr.map((x, j) => (j === i ? { ...x, state } : x)));
  }

  async function runArtwork() {
    setSteps([
      { label: 'Photo préparée et compressée sur le téléphone', state: 'done' },
      { label: 'Observation de l’image par l’IA, puis vérification dans les catalogues de musées', state: 'active' }
    ]);
    try {
      const hash = await sha256Hex(s.photo!);
      session.set({ photoHash: hash });
      // Une photo déjà analysée n'est pas renvoyée au serveur.
      const local = await db.analyses.get(hash);
      const response = local?.response ?? (await api.identify(s.photo!));
      if (!local) await db.analyses.put({ id: hash, response, createdAt: Date.now() });
      set(1, 'done');
      session.set({ response });
      nav('/resultats', { replace: true });
    } catch (e: any) {
      const retry = !(e instanceof ApiError) || [0, 429, 502, 503].includes(e.status);
      setError({ msg: e?.message ?? 'Analyse impossible.', retry });
    }
  }

  async function runLabel() {
    setSteps([
      { label: 'Photo du cartel préparée', state: 'done' },
      { label: 'Lecture du texte par l’IA', state: 'active' }
    ]);
    try {
      const r = await api.label(s.labelPhoto!);
      set(1, 'done');
      session.set({ label: r.fields, labelSource: 'ia' });
      nav('/cartel', { replace: true });
      return;
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'access') {
        setError({ msg: e.message, retry: false });
        return;
      }
      // Repli gratuit : OCR exécuté sur le téléphone.
      setSteps([
        { label: 'Photo du cartel préparée', state: 'done' },
        { label: `Lecture par IA indisponible (${e?.message ?? 'erreur'})`, state: 'done' },
        { label: 'Lecture du texte sur le téléphone (OCR local)', state: 'active' }
      ]);
    }
    try {
      const fields = await ocrLabel(s.labelPhoto!, setOcrProgress);
      session.set({ label: fields, labelSource: 'ocr-local' });
      nav('/cartel', { replace: true });
    } catch (e: any) {
      setError({ msg: 'Lecture du cartel impossible : ' + (e?.message ?? 'erreur OCR'), retry: true });
    }
  }

  return (
    <div className="analyzing">
      <div className="photo">{url && <img src={url} alt="Votre photo" />}</div>
      <div>
        <ol className="steps" aria-live="polite">
          {steps.map((st, i) => (
            <li key={i} data-state={st.state}>
              <span className="mark" aria-hidden />
              <span>
                {st.label}
                {st.state === 'active' && ocrProgress !== null && i === steps.length - 1 ? ` (${Math.round(ocrProgress * 100)} %)` : ''}
              </span>
            </li>
          ))}
        </ol>
        {error && (
          <div style={{ padding: '0 var(--margin) 48px', maxWidth: 480, margin: '0 auto' }} className="stack-16">
            <p role="alert" style={{ color: 'var(--wall-ink)' }}>{error.msg}</p>
            <div className="row">
              {error.retry && (
                <button
                  className="btn btn-wall"
                  onClick={() => {
                    setError(null);
                    s.mode === 'label' ? runLabel() : runArtwork();
                  }}
                >
                  Réessayer
                </button>
              )}
              <button className="btn btn-ghost" style={{ color: 'var(--wall-ink)', borderColor: 'var(--wall-ink-2)' }} onClick={() => nav('/scanner', { replace: true })}>
                Reprendre la photo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
