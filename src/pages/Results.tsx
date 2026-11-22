import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Candidate } from '../../shared/types';
import { OBJECT_KIND_LABEL } from '../../shared/types';
import { useSession } from '../lib/session';
import { Icon, Meter, Notice } from '../components/ui';
import { TopBar } from '../components/Chrome';
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
      <TopBar back="Viseur" backTo="/" />
      <div className="page" style={{ paddingTop: 8, paddingBottom: 0 }}>
        <h1 className="t-title">{st.title}</h1>
        <p className="t-muted" style={{ marginTop: 8 }}>{st.text}</p>
        {(r.status === 'ambiguous' || r.candidates.length > 1) && (
          <Link className="btn btn-block" to="/scanner?mode=cartel" style={{ marginTop: 16 }}>
            <Icon name="camera" size={20} /> Photographier le cartel
          </Link>
        )}
      </div>

      <div className="page stack-24">
        {r.warnings.map((w) => (
          <Notice key={w}>{w}</Notice>
        ))}

        {r.status === 'unusable_image' && (
          <Notice title="Conseil pour la prochaine photo">{r.vision.imageQualityIssue}</Notice>
        )}

        {r.candidates.length > 0 && (
          <section aria-label="Correspondances">
            <h2 className="rubric">Dans les catalogues</h2>
            {r.candidates.map((c) => (
              <article key={c.key} className="candidate">
                <button className="candidate-open" onClick={() => open(c)} aria-label={`Ouvrir la fiche : ${c.title}`}>
                  {c.imageUrl && !broken.has(c.key) ? (
                    <img className="candidate-img" src={museumImg(c.imageUrl)} alt="" loading="lazy" onError={() => setBroken((b) => new Set(b).add(c.key))} />
                  ) : photoUrl ? (
                    <img className="candidate-img" src={photoUrl} alt="" />
                  ) : (
                    <div className="candidate-img placeholder">Pas de reproduction</div>
                  )}
                  <span className="stack-4">
                    <span className="artist" style={{ display: 'block' }}>{c.artist}</span>
                    <span className="work-title" style={{ display: 'block', fontSize: 17, lineHeight: '24px' }}>{c.title}</span>
                    <span className="mono t-muted" style={{ display: 'block' }}>{frTypo([sourceNames(c), c.date].filter(Boolean).join(' · ') || 'Aucune notice concordante')}</span>
                  </span>
                </button>
                {c.labelConfirmed && <p className="t-small state-ok">Confirmé par le cartel lu sur la photo</p>}
                {!c.labelConfirmed && !c.records.length && <p className="t-small state-warn">Aucune notice concordante dans les catalogues interrogés</p>}
                <details className="t-small">
                  <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>Pourquoi cette proposition</summary>
                  <div className="stack-8" style={{ paddingTop: 8 }}>
                    <Meter c={c} />
                    <dl className="signals">
                      <dt>Estimation</dt>
                      <dd className="num">{Math.round(c.signals.model * 100)} %</dd>
                      <dt>Titre et artiste</dt>
                      <dd className="num">{c.signals.text === null ? 'aucune notice' : `${Math.round(c.signals.text * 100)} % de concordance`}</dd>
                      <dt>Ressemblance d’image</dt>
                      <dd className="num">{c.signals.visual === null ? 'non mesurée (pas d’image de référence)' : `${Math.round(c.signals.visual * 100)} %`}</dd>
                    </dl>
                    {c.reasoning && <p className="t-muted">{frTypo(c.reasoning)}</p>}
                    {c.distinguishing && (
                      <p>
                        <span className="t-faint">Pour départager : </span>
                        {frTypo(c.distinguishing)}
                      </p>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </section>
        )}

        {r.leads && (
          <section className="stack-16" aria-label="Pistes">
            <h2 className="rubric">Pistes</h2>
            {r.leads.artist && (
              <div className="stack-8">
                <p className="t-small t-muted">{r.leads.artistBasis === 'cartel' ? 'Nom lu sur le cartel' : 'Nom lu dans la signature'}</p>
                <p className="artist" style={{ fontSize: 'var(--t-l)', lineHeight: 'var(--lh-l)' }}>{frTypo(r.leads.artist)}</p>
                {r.leads.artistRecords.length > 0 ? (
                  <p className="t-small state-ok">
                    {frTypo(`${r.leads.artistRecords.length} œuvre${r.leads.artistRecords.length > 1 ? 's' : ''} de cet artiste dans les catalogues, mais pas celle-ci`)}
                  </p>
                ) : (
                  <p className="t-small t-muted">Cet artiste n’apparaît pas dans les catalogues de musées interrogés. C’est fréquent pour les artistes vus en galerie ou en vente.</p>
                )}
                <div className="row">
                  <Link className="btn btn-secondary btn-small" to={`/recherche?artist=${encodeURIComponent(r.leads.artist)}`}>
                    Voir cet artiste dans les catalogues
                  </Link>
                </div>
              </div>
            )}
            {r.leads.style && (
              <div className="stack-8">
                <p className="t-small t-muted">Piste de style, ce n’est pas une identification</p>
                <p className="reading measure">{frTypo(r.leads.style)}</p>
              </div>
            )}
          </section>
        )}

        <section className="stack-16">
          <h2 className="rubric">Ce que montre la photo</h2>
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
          <h2 className="rubric">Aucune ne correspond ?</h2>
          <div className="row">
            <Link className="btn btn-secondary btn-small" to="/scanner?mode=cartel">
              Photographier le cartel
            </Link>
            <Link className="btn btn-secondary btn-small" to="/recherche">
              Chercher par titre ou artiste
            </Link>
          </div>
        </section>

      </div>
    </main>
  );
}
