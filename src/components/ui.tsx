import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ArtworkEntry, Candidate, ServerConfig } from '../../shared/types';
import { api } from '../lib/api';

// ---------- Icônes (traits simples, 24 px) ----------
const paths: Record<string, ReactNode> = {
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14" />,
  scan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  grid: <path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 16 5-5 5 5 3-3 5 5" />
    </>
  ),
  flip: <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />,
  send: <path d="M4 12 20 4l-6 16-3-7-7-1z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="15" r="1" fill="currentColor" />
      <circle cx="15" cy="9" r="1" fill="currentColor" />
      <circle cx="9" cy="15" r="1" fill="currentColor" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
};

export function Icon({ name, size = 24, label }: { name: keyof typeof paths | string; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {paths[name]}
    </svg>
  );
}

// ---------- Configuration serveur partagée ----------
const ConfigCtx = createContext<{ config: ServerConfig | null; error: string | null; reload: () => void }>({
  config: null,
  error: null,
  reload: () => {}
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [n]);
  const value = useMemo(() => ({ config, error, reload: () => setN((x) => x + 1) }), [config, error]);
  return <ConfigCtx.Provider value={value}>{children}</ConfigCtx.Provider>;
}

export const useConfig = () => useContext(ConfigCtx);

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      <div aria-live="polite">{msg && <div className="toast">{msg}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Cartel ----------
export function Cartel({ entry, saved }: { entry: Pick<ArtworkEntry, 'artist' | 'title' | 'date' | 'technique' | 'dimensions' | 'institution' | 'inventory' | 'movement'> & { artistBio?: string }; saved?: boolean }) {
  const rows: [string, string | null | undefined][] = [
    ['Technique', entry.technique],
    ['Dimensions', entry.dimensions],
    ['Mouvement', entry.movement],
    ['Conservation', entry.institution],
    ['Inventaire', entry.inventory]
  ];
  return (
    <div className="cartel" aria-label="Cartel de l’œuvre">
      <div className="artist">{entry.artist}</div>
      {entry.artistBio && <div className="artist-bio">{entry.artistBio}</div>}
      <h1 className="work-title">
        {entry.title}
        {entry.date ? <span style={{ fontStyle: 'normal' }}>, {entry.date}</span> : null}
      </h1>
      {rows.some(([, v]) => v) && (
        <dl>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      )}
      {saved && <span className="redot" title="Dans votre collection" />}
    </div>
  );
}

// ---------- Confiance ----------
export function Meter({ c }: { c: Pick<Candidate, 'confidence' | 'confidenceLabel'> }) {
  return (
    <div className="meter" data-level={c.confidenceLabel}>
      <span className="meter-bar" aria-hidden>
        <i style={{ width: `${Math.round(c.confidence * 100)}%` }} />
      </span>
      <span>
        Confiance {c.confidenceLabel} <span className="num t-faint">({Math.round(c.confidence * 100)} %)</span>
      </span>
    </div>
  );
}

export function Notice({ kind = 'warn', title, children }: { kind?: 'warn' | 'info' | 'error'; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice ${kind === 'warn' ? '' : kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function BackLink({ to = -1 as any, label = 'Retour' }: { to?: string | number; label?: string }) {
  if (typeof to === 'number')
    return (
      <button className="back linkbtn" style={{ textDecoration: 'none' }} onClick={() => history.back()}>
        <Icon name="back" size={16} /> {label}
      </button>
    );
  return (
    <Link className="back" to={to}>
      <Icon name="back" size={16} /> {label}
    </Link>
  );
}

export function WorkTile({
  to,
  href,
  img,
  artist,
  title,
  date,
  saved,
  contain
}: {
  to?: string;
  href?: string;
  img?: string;
  artist?: string;
  title?: string;
  date?: string | null;
  saved?: boolean;
  contain?: boolean;
}) {
  const inner = (
    <>
      <div className={`work-frame ${contain ? 'contain' : ''}`}>
        {img ? <img src={img} alt="" loading="lazy" /> : <span className="t-small" style={{ color: 'var(--wall-ink-2)' }}>Sans image</span>}
      </div>
      {saved && <span className="redot" title="Dans votre collection" />}
      <div className="work-label">
        {artist && <span className="artist">{artist}</span>}
        <span className="work-title">{title || 'Sans titre'}</span>
        {date && <span className="t-muted">{date}</span>}
      </div>
    </>
  );
  if (to)
    return (
      <Link className="work" to={to}>
        {inner}
      </Link>
    );
  return (
    <a className="work" href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  );
}

export function DemoRibbon() {
  const { config } = useConfig();
  if (!config?.demo) return null;
  return <div className="demo-ribbon">Mode démonstration : identification simulée, aucune IA connectée</div>;
}
