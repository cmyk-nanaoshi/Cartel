import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Candidate } from '../../shared/types';
import { OBJECT_KIND_LABEL } from '../../shared/types';
import { useSession } from '../lib/session';
import { BackLink, Meter, Notice } from '../components/ui';

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
                {c.imageUrl ? (
                  <img className="candidate-img" src={c.imageUrl} alt={`Reproduction : ${c.title}`} loading="lazy" />
                ) : (
                  <div className="candidate-img placeholder">Pas de reproduction libre</div>
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
                  <p className="t-small" style={{ color: c.verified ? 'var(--ok)' : 'var(--warn)' }}>
                    {c.verified ? `Notice trouvée : ${sourceNames(c)}` : 'Aucune notice concordante dans les catalogues interrogés'}
                  </p>
                  <dl className="signals">
                    <dt>Estimation de l’IA</dt>
                    <dd className="num">{Math.round(c.signals.model * 100)} %</dd>
                    <dt>Titre et artiste</dt>
                    <dd className="num">{c.signals.text === null ? 'aucune notice' : `${Math.round(c.signals.text * 100)} % de concordance`}</dd>
                    <dt>Ressemblance d’image</dt>
                    <dd className="num">{c.signals.visual === null ? 'non mesurée (pas d’image de référence)' : `${Math.round(c.signals.visual * 100)} %`}</dd>
                  </dl>
                  {c.reasoning && <p className="t-small t-muted">{c.reasoning}</p>}
                  {(r.status === 'ambiguous' || i > 0) && c.distinguishing && (
                    <p className="t-small">
                      <span className="t-faint">Pour départager : </span>
                      {c.distinguishing}
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
          <p className="reading measure">{r.vision.description}</p>
          {(r.vision.visibleText.length > 0 || r.vision.inscriptions.length > 0) && (
            <dl className="kv">
              {r.vision.inscriptions.length > 0 && (
                <>
                  <dt>Inscriptions</dt>
                  <dd>{r.vision.inscriptions.join(' ; ')}</dd>
                </>
              )}
              {r.vision.visibleText.length > 0 && (
                <>
                  <dt>Texte lisible</dt>
                  <dd>{r.vision.visibleText.join(' ; ')}</dd>
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
            Analyse : {r.usage.model}, {r.usage.inputTokens + r.usage.outputTokens} tokens, environ {r.usage.estimatedCostUsd.toFixed(4)} $.
          </p>
        )}
      </div>
    </main>
  );
}
