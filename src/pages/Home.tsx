import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { db } from '../lib/db';
import { Icon, WorkTile, useConfig, Notice } from '../components/ui';
import { t } from '../i18n';

export const MOVEMENTS: { label: string; query: string }[] = [
  { label: 'Renaissance', query: 'Renaissance' },
  { label: 'Baroque', query: 'Baroque' },
  { label: 'Néoclassicisme', query: 'Neoclassicism' },
  { label: 'Romantisme', query: 'Romanticism' },
  { label: 'Impressionnisme', query: 'Impressionism' },
  { label: 'Postimpressionnisme', query: 'Post-Impressionism' },
  { label: 'Art nouveau', query: 'Art Nouveau' },
  { label: 'Cubisme', query: 'Cubism' },
  { label: 'Surréalisme', query: 'Surrealism' },
  { label: 'Bauhaus', query: 'Bauhaus' },
  { label: 'Expressionnisme abstrait', query: 'Abstract Expressionism' },
  { label: 'Ukiyo-e', query: 'Ukiyo-e' }
];

export function Home() {
  const { config, error } = useConfig();
  const recent = useLiveQuery(() => db.artworks.orderBy('createdAt').reverse().limit(4).toArray(), []);
  const urls = useMemo(() => (recent ?? []).map((a) => (a.photo ? URL.createObjectURL(a.photo) : a.entry.imageUrl)), [recent]);
  useEffect(() => () => urls.forEach((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u)), [urls]);

  return (
    <main className="page">
      <header className="hero stack-8">
        <p className="t-small t-muted">Cartel</p>
        <h1 className="t-display measure">Ce que vous regardez, et d’où cela vient.</h1>
      </header>

      <div className="stack-32" style={{ marginTop: 24 }}>
        {error && (
          <Notice kind="error" title="Serveur injoignable">
            L’identification et la recherche documentaire sont indisponibles. Votre collection reste consultable. ({error})
          </Notice>
        )}

        <Link to="/scanner" className="hero-scan">
          <div className="stack-8">
            <h2 className="t-title">{t('home.scanTitle')}</h2>
            <p>{t('home.scanText')}</p>
          </div>
          <span className="scan-disc" style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: '50%', background: 'var(--wall-ink)', color: 'var(--wall)' }}>
            <Icon name="scan" />
          </span>
        </Link>

        <nav className="grid" aria-label="Raccourcis" style={{ rowGap: 0 }}>
          {[
            { to: '/scanner?mode=cartel', label: 'Lire un cartel', hint: 'Extraire titre, artiste, date', icon: 'image' },
            { to: '/hasard', label: t('home.random'), hint: 'Œuvres du domaine public', icon: 'dice' },
            { to: '/recherche', label: 'Rechercher', hint: 'Dans les catalogues de musées', icon: 'search' },
            { to: '/carte', label: 'Musées autour de moi', hint: 'Lieux documentés sur Wikidata', icon: 'map' }
          ].map((l) => (
            <Link key={l.to} to={l.to} className="span-half md-span-4 lg-span-3" style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 12, padding: '16px 0', borderTop: '1px solid var(--rule)', textDecoration: 'none' }}>
              <Icon name={l.icon} />
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{l.label}</span>
                <span className="t-small t-muted">{l.hint}</span>
              </span>
            </Link>
          ))}
        </nav>

        {!!recent?.length && (
          <section className="stack-16">
            <div className="row-between">
              <h2 className="t-head">{t('home.recent')}</h2>
              <Link to="/collection" className="t-small">
                Tout voir
              </Link>
            </div>
            <div className="works">
              {recent.map((a, i) => (
                <WorkTile key={a.id} to={`/oeuvre/${encodeURIComponent(a.id)}`} img={urls[i]} artist={a.entry.artist} title={a.entry.title} date={a.entry.date} saved />
              ))}
            </div>
          </section>
        )}

        <section className="stack-16">
          <h2 className="t-head">{t('home.movements')}</h2>
          <div className="chips">
            {MOVEMENTS.map((m) => (
              <Link key={m.query} className="chip" to={`/recherche?q=${encodeURIComponent(m.query)}&label=${encodeURIComponent(m.label)}`}>
                {m.label}
              </Link>
            ))}
          </div>
          <p className="t-small t-faint">Les œuvres proposées viennent des collections ouvertes de l’Art Institute of Chicago, du Met, de Wikidata et de la base Joconde.</p>
        </section>

        {config && !config.demo && config.costPerScanUsd && (
          <p className="t-small t-faint">
            Analyse par {config.models.vision}. Coût estimé d’un scan complet : {config.costPerScanUsd.low.toFixed(3)} à {config.costPerScanUsd.high.toFixed(3)} $.
          </p>
        )}
      </div>
    </main>
  );
}
