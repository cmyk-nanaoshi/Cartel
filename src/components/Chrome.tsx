import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './ui';
import { LogoCourt } from './Brand';

// Navigation C2 (maquettes Figma) : la caméra d'abord, un menu en haut à droite.
const ITEMS = [
  { to: '/collection', label: 'Collection', icon: 'grid' },
  { to: '/carte', label: 'Carte', icon: 'map' },
  { to: '/recherche', label: 'Rechercher', icon: 'search' },
  { to: '/profil', label: 'Profil', icon: 'user' }
];

export function Logo() {
  return (
    <Link to="/" className="tb-logo" aria-label="Artcol, retour au viseur">
      <LogoCourt size={17} />
    </Link>
  );
}

function Menu() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="iconbtn" aria-label="Menu" aria-expanded={open} aria-controls="menu" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'close' : 'menu'} />
      </button>
      {open && (
        <>
          <div className="menu-veil" onClick={() => setOpen(false)} aria-hidden />
          <nav id="menu" className="menu" aria-label="Menu principal">
            {ITEMS.map((i) => (
              <NavLink key={i.to} to={i.to} aria-current={loc.pathname.startsWith(i.to) ? 'page' : undefined}>
                <Icon name={i.icon} size={20} />
                {i.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </>
  );
}

/** Barre du haut. Viseur : logo centré. Section : retour à gauche. Le menu reste à droite, sauf avis contraire. */
export function TopBar({ back, backTo, right, menu = true }: { back?: string; backTo?: string; right?: ReactNode; menu?: boolean }) {
  const nav = useNavigate();
  const goBack = () => (backTo ? nav(backTo) : window.history.state?.idx > 0 ? nav(-1) : nav('/'));
  return (
    <header className="topbar">
      <div className="tb-left">
        {back ? (
          <button type="button" className="back" onClick={goBack}>
            <Icon name="back" size={20} /> {back}
          </button>
        ) : null}
      </div>
      <div>{back ? null : <Logo />}</div>
      <div className="tb-right">
        {right}
        {menu && <Menu />}
      </div>
    </header>
  );
}
