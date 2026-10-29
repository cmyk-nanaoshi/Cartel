import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, exportBackup, getSetting, importBackup, setSetting } from '../lib/db';
import { download } from '../lib/export';
import { Notice, useConfig, useToast } from '../components/ui';
import { getLang, setLang, t, type Lang } from '../i18n';

export function Profile() {
  const { config, error, reload } = useConfig();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [geo, setGeo] = useState(false);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [counts, setCounts] = useState({ artworks: 0, analyses: 0, entries: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setCode((await getSetting<string>('accessCode')) ?? '');
      setIsAdmin(!!(await getSetting<string>('adminCode')));
      setGeo((await getSetting<boolean>('saveLocation')) ?? false);
      setCounts({ artworks: await db.artworks.count(), analyses: await db.analyses.count(), entries: await db.entries.count() });
    })();
  }, []);

  async function saveCode() {
    await setSetting('accessCode', code.trim());
    toast('Code d’accès enregistré sur cet appareil');
    reload();
  }

  async function toggleGeo(v: boolean) {
    if (v && navigator.geolocation) {
      // Demande l'autorisation tout de suite, pour que le premier scan ne soit pas interrompu.
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => toast('Position refusée : le lieu ne sera pas enregistré'),
        { timeout: 8000 }
      );
    }
    setGeo(v);
    await setSetting('saveLocation', v);
  }

  async function clearCache() {
    await db.analyses.clear();
    await db.entries.clear();
    setCounts((c) => ({ ...c, analyses: 0, entries: 0 }));
    toast('Cache des analyses vidé');
  }

  async function backup() {
    download(await exportBackup(), `cartel-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const n = await importBackup(f);
      toast(`${n} œuvre${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''}`);
      setCounts((c) => ({ ...c, artworks: c.artworks + 0 }));
    } catch (err: any) {
      toast(err.message);
    }
  }

  return (
    <main className="page">
      <header className="pagehead">
        <h1 className="t-display">{t('profile.title')}</h1>
      </header>

      <div className="grid">
        <section className="span-all md-span-4 lg-span-6 stack-16">
          <h2 className="t-head">Intelligence artificielle</h2>
          {error && <Notice kind="error" title="Serveur injoignable">{error}</Notice>}
          {config && (
            <>
              {config.demo ? (
                <Notice title="Mode démonstration">
                  Aucune IA n’est connectée au serveur. L’identification renvoie des hypothèses fixes, les fiches sont construites à partir des notices seules et le cartel est lu par OCR local. Ajoutez ANTHROPIC_API_KEY côté serveur pour activer Claude.
                </Notice>
              ) : (
                <dl className="kv">
                  <dt>Fournisseur</dt>
                  <dd>{config.provider === 'anthropic' ? 'Anthropic (API Claude)' : config.provider}</dd>
                  <dt>Identification</dt>
                  <dd>{config.models.vision}</dd>
                  <dt>Rédaction</dt>
                  <dd>{config.models.text}</dd>
                  <dt>Questions</dt>
                  <dd>{config.models.chat}</dd>
                  {config.costPerScanUsd && (
                    <>
                      <dt>Coût d’un scan</dt>
                      <dd className="num">
                        {config.costPerScanUsd.low.toFixed(3)} à {config.costPerScanUsd.high.toFixed(3)} $ (estimation)
                      </dd>
                    </>
                  )}
                  <dt>Dépensé aujourd’hui</dt>
                  <dd className="num">
                    {config.limits.spentTodayUsd.toFixed(3)} $ sur {config.limits.dailyBudgetUsd} $ autorisés
                  </dd>
                </dl>
              )}
              <p className="t-small t-faint">Les clés API restent sur le serveur. Les réponses déjà obtenues sont mises en cache pour ne pas payer deux fois la même analyse.</p>
            </>
          )}
          {(config?.accessCodeRequired || code) && (
            <div className="stack-8">
              <label className="field">
                <span>Code d’accès au serveur</span>
                <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
              </label>
              <button className="btn btn-small" onClick={saveCode}>
                Enregistrer le code
              </button>
            </div>
          )}

          <h2 className="t-head" style={{ paddingTop: 16 }}>Sources documentaires</h2>
          <ul className="list-plain">
            {config?.sources.map((s) => (
              <li key={s.id}>
                <div className="row-between">
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span className="t-small" style={{ color: s.enabled ? 'var(--ok)' : 'var(--ink-3)' }}>
                    {s.enabled ? 'active' : 'inactive'}
                  </span>
                </div>
                {s.note && <p className="t-small t-muted">{s.note}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section className="span-all md-span-4 lg-span-5 lg-start-8 stack-16">
          <h2 className="t-head">Préférences</h2>
          <fieldset className="stack-8" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="t-small t-muted">Langue de l’interface</legend>
            <div className="chips">
              {(['fr', 'en'] as const).map((v) => (
                <button
                  key={v}
                  className="chip"
                  aria-pressed={lang === v}
                  onClick={() => {
                    setLang(v);
                    setLangState(v);
                    location.reload();
                  }}
                >
                  {v === 'fr' ? 'Français' : 'English (partiel)'}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <input type="checkbox" checked={geo} onChange={(e) => toggleGeo(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
            <span>
              <span style={{ display: 'block', fontWeight: 600 }}>Enregistrer le lieu de mes découvertes</span>
              <span className="t-small t-muted">Désactivé par défaut. La position reste sur cet appareil, elle n’est jamais envoyée au serveur d’analyse.</span>
            </span>
          </label>

          <h2 className="t-head" style={{ paddingTop: 16 }}>Données</h2>
          <dl className="kv">
            <dt>Œuvres enregistrées</dt>
            <dd className="num">{counts.artworks}</dd>
            <dt>Analyses en cache</dt>
            <dd className="num">{counts.analyses}</dd>
            <dt>Fiches en cache</dt>
            <dd className="num">{counts.entries}</dd>
          </dl>
          <p className="t-small t-muted">
            Tout est stocké sur ce téléphone. Pour changer d’appareil, exportez une sauvegarde puis importez-la sur le nouveau.
          </p>
          <div className="row">
            <button className="btn btn-ghost btn-small" onClick={backup}>
              Exporter une sauvegarde
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => fileRef.current?.click()}>
              Importer une sauvegarde
            </button>
            <button className="btn btn-ghost btn-small" onClick={clearCache}>
              Vider le cache
            </button>
          </div>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={restore} />

          {/* Lien visible seulement sur l'appareil où le code d'administration a été saisi (sinon : /admin). */}
          {isAdmin && (
            <Link className="btn btn-ghost btn-small" to="/admin">
              Administration des fiches
            </Link>
          )}
          <p className="t-small t-faint" style={{ paddingTop: 16 }}>
            Cartel 0.1. Données des notices : Joconde (Licence Ouverte), Wikidata (CC0), Art Institute of Chicago et Met (CC0). Fond de carte © OpenStreetMap.
          </p>
        </section>
      </div>
    </main>
  );
}
