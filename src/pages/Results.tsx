import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Candidate } from '../../shared/types';
import { OBJECT_KIND_LABEL } from '../../shared/types';
import { useSession } from '../lib/session';
import { BackLink, Meter, Notice } from '../components/ui';
import { museumImg } from '../lib/api';
import { frNumber, frTypo } from '../../shared/typo';

const STATUS: Record<string, { title: string; text: string }> = {
  identified: { title: 'Œuvre identifiée', text: 'L’hypothèse principale concorde avec au moins une notice de musée.' },
  ambiguous: { title: 'Plusieurs œuvres possibles', text: 'Les hypothèses sont proches. Comparez les indices ci-dessous avant de choisir.' },
  uncertain: { title: 'Identification incertaine', text: 'Aucune hypothèse n’est assez solide. Les pistes ci-dessous ne sont pas des identifications.' },
  not_artwork: { title: 'Pas d’œuvre reconnue sur la photo', text: 'L’image ne semble pas montrer une œuvre, un objet d’art ou un monument.' },
  unusable_image: { title: 'Photo inexploitable', text: 'L’image ne permet pas une analyse fiable.' }
};

function sourceNames(c: Candidate) {
  return [...new Set(c.records.map((r) => r.sourceLabel))].join(', ');
}

export function Results() {
  const s = useSession();
  const nav = useNavigate();
  const r = s.response;
  const photoUrl = useMemo(() => (s.thumb ? URL.createObjectURL(s.thumb) : undefined), [s.thumb]);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  if (!r)
    return (
      <main className="page stack-16">
        <p>Aucune analyse en cours.</p>
        <Link className="btn" to="/scanner">
          Scanner une œuvre
        </Link>
      </main>
    );

  const st = STATUS[r.status];
  const open = (c: Candidate) =>
    nav(`/oeuvre/${encodeURIComponent(c.key)}`, {
      state: {
        candidate: { key: c.key, title: c.title, artist: c.artist, date: c.date, records: c.records },
        vision: { objectKind: r.vision.objectKind, description: r.vision.description, visibleText: r.vision.visibleText, inscriptions: r.vision.inscriptions },
        // Le cartel fait foi : celui validé par le visiteur, sinon celui lu sur la photo de l'œuvre.
        label: s.label ?? r.vision.label ?? undefined,
        fromScan: true
      }
    });

  return (
    <main>
      <div className="wall">
        <div className="page" style={{ paddingBottom: 24 }}>
          <div className="grid" style={{ alignItems: 'end' }}>
            <div className="span-half md-span-3 lg-span-3">{photoUrl && <img src={photoUrl} alt="Votre photo" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', objectPosition: 'left bottom' }} />}</div>
            <div className="span-half md-span-5 lg-span-8 stack-8">
              <p className="t-small" style={{ color: 'var(--wall-ink-2)' }}>
                {OBJECT_KIND_LABEL[r.vision.objectKind]}
                {r.cached ? ', résultat déjà en cache' : ''}
              </p>
              <h1 className="t-title">{st.title}</h1>
              <p className="t-small" style={{ color: 'var(--wall-ink-2)' }}>{st.text}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="page stack-24">
        <BackLink to="/scanner" label="Nouvelle photo" />
        {r.warnings.map((w) => (
          <Notice key={w}>{w}</Notice>
        ))}

        {r.status === 'unusable_image' && (
          <Notice title="Conseil pour la prochaine photo">{r.vision.imageQualityIssue}</Notice>
        )}

        {r.candidates.length > 0 && (
          <section aria-label="Correspondances">
            {r.candidates.map((c, i) => (
              <article key={c.key} className="candidate">
                {c.imageUrl && !broken.has(c.key) ? (
                  <img
                    className="candidate-img"
                    src={museumImg(c.imageUrl)}
                    alt={`Reproduction : ${c.title}`}
                    loading="lazy"
                    onError={() => setBroken((b) => new Set(b).add(c.key))}
                  />
                ) : photoUrl ? (
                  <img className="candidate-img" src={photoUrl} alt="Votre photo" />
                ) : (
                  <div className="candidate-img placeholder">Pas de reproduction</div>
                )}
                <div className="stack-8">
                  <div>
                    <div className="artist">{c.artist}</div>
                    <div className="work-title" style={{ fontSize: 'var(--t-l)', lineHeight: 'var(--lh-l)' }}>
                      {c.title}
                      {c.date ? <span style={{ fontStyle: 'normal' }}>, {c.date}</span> : null}
                    </div>
                  </div>
                  <Meter c={c} />
                  {c.labelConfirmed && <p className="t-small" style={{ color: 'var(--ok)' }}>Confirmé par le cartel lu sur la photo</p>}
                  {(c.records.length > 0 || !c.labelConfirmed) && (
                    <p className="t-small" style={{ color: c.records.length ? 'var(--ok)' : 'var(--warn)' }}>
                      {frTypo(c.records.length ? `Notice trouvée : ${sourceNames(c)}` : 'Aucune notice concordante dans les catalogues interrogés')}
                    </p>
                  )}
                  <dl className="signals">
                    <dt>Estimation de l’IA</dt>
                    <dd className="num">{Math.round(c.signals.model * 100)} %</dd>
                    <dt>Titre et artiste</dt>
                    <dd className="num">{c.signals.text === null ? 'aucune notice' : `${Math.round(c.signals.text * 100)} % de concordance`}</dd>
                    <dt>Ressemblance d’image</dt>
                    <dd className="num">{c.signals.visual === null ? 'non mesurée (pas d’image de référence)' : `${Math.round(c.signals.visual * 100)} %`}</dd>
                  </dl>
                  {c.reasoning && <p className="t-small t-muted">{frTypo(c.reasoning)}</p>}
                  {(r.status === 'ambiguous' || i > 0) && c.distinguishing && (
                    <p className="t-small">
                      <span className="t-faint">Pour départager : </span>
                      {frTypo(c.distinguishing)}
                    </p>
                  )}
                  <div>
                    <button className={`btn btn-small ${i === 0 ? '' : 'btn-ghost'}`} onClick={() => open(c)}>
                      Ouvrir la fiche
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="stack-16">
          <h2 className="t-head">Ce que l’IA voit sur la photo</h2>
          <p className="reading measure">{frTypo(r.vision.description)}</p>
          {(r.vision.visibleText.length > 0 || r.vision.inscriptions.length > 0) && (
            <dl className="kv">
              {r.vision.inscriptions.length > 0 && (
                <>
                  <dt>Inscriptions</dt>
                  <dd>
                    {r.vision.inscriptions.map((x, i) => (
                      <span key={i} className="kv-line">{frTypo(x)}</span>
                    ))}
                  </dd>
                </>
              )}
              {r.vision.visibleText.length > 0 && (
                <>
                  <dt>Texte lisible</dt>
                  <dd>
                    {r.vision.visibleText.map((x, i) => (
                      <span key={i} className="kv-line">{frTypo(x)}</span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          )}
        </section>

        <section className="stack-8">
          <h2 className="t-head">Aucune ne correspond ?</h2>
          <div className="row">
            <Link className="btn btn-ghost btn-small" to="/scanner?mode=cartel">
              Photographier le cartel
            </Link>
            <Link className="btn btn-ghost btn-small" to="/recherche">
              Chercher par titre ou artiste
            </Link>
          </div>
        </section>

        {r.usage && r.usage.estimatedCostUsd > 0 && (
          <p className="t-small t-faint">
            {frTypo(
              `Analyse : ${r.usage.model}, ${frNumber(r.usage.inputTokens + r.usage.outputTokens, 0)} jetons, environ ${frNumber(r.usage.estimatedCostUsd, 3)} $.`
            )}
          </p>
        )}
      </div>
    </main>
  );
}
