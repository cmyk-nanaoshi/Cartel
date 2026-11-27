import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

// Gestes de navigation, comme sur iOS :
// - glisser depuis le bord gauche revient à la page précédente, depuis le bord droit va à la suivante ;
// - glisser une feuille vers le bas la ferme.
// Les durées et courbes reprennent les transitions « Push » du prototype Figma (300 ms, ease-in-out).
// Safari gère déjà le retour par glissement dans le navigateur : on ne l'ajoute que dans l'app installée,
// pour ne pas déclencher deux retours. Tout mouvement est coupé si le téléphone demande de réduire les animations.

const EDGE = 28; // largeur de la zone de départ au bord de l'écran, en px
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Enveloppe des pages : anime l'arrivée selon le sens de navigation et suit le doigt pendant un glissement de bord. */
export function RouteView({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const type = useNavigationType();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const forward = useRef(0); // pages disponibles « en avant » après un retour
  const [dir, setDir] = useState<'push' | 'pop' | null>(null);
  const lastIdx = useRef<number>(window.history.state?.idx ?? 0);

  // Sens d'arrivée : vers l'avant (de droite) ou vers l'arrière (de gauche).
  useEffect(() => {
    const idx = window.history.state?.idx ?? 0;
    if (type === 'PUSH') forward.current = 0;
    if (type === 'POP') {
      if (idx < lastIdx.current) forward.current += lastIdx.current - idx;
      else forward.current = Math.max(0, forward.current - (idx - lastIdx.current));
    }
    setDir(type === 'POP' && idx < lastIdx.current ? 'pop' : type === 'REPLACE' ? null : 'push');
    lastIdx.current = idx;
  }, [loc.key, type]);

  // Glissement depuis les bords.
  useEffect(() => {
    if (!standalone()) return;
    let start: { x: number; y: number; t: number; side: 'left' | 'right' } | null = null;
    let dx = 0;
    let locked = false;
    const el = () => ref.current;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || document.querySelector('.sheet')) return;
      const t = e.touches[0];
      const canBack = (window.history.state?.idx ?? 0) > 0;
      if (t.clientX <= EDGE && canBack) start = { x: t.clientX, y: t.clientY, t: Date.now(), side: 'left' };
      else if (t.clientX >= window.innerWidth - EDGE && forward.current > 0) start = { x: t.clientX, y: t.clientY, t: Date.now(), side: 'right' };
      else start = null;
      dx = 0;
      locked = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (!locked) {
        if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { start = null; return; } // c'est un défilement vertical
        if (Math.abs(mx) > 8) locked = true;
      }
      if (!locked) return;
      e.preventDefault();
      dx = start.side === 'left' ? Math.max(0, mx) : Math.min(0, mx);
      const v = el();
      if (v && !reduced()) {
        v.style.transition = 'none';
        v.style.transform = `translate3d(${dx}px, 0, 0)`;
      }
    };
    const onEnd = () => {
      if (!start) return;
      const v = el();
      const speed = Math.abs(dx) / Math.max(1, Date.now() - start.t);
      const done = Math.abs(dx) > window.innerWidth * 0.33 || (Math.abs(dx) > 40 && speed > 0.5);
      const side = start.side;
      start = null;
      if (!v) return;
      if (!done) {
        v.style.transition = reduced() ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
        v.style.transform = '';
        return;
      }
      const finish = () => {
        v.style.transition = 'none';
        v.style.transform = '';
        nav(side === 'left' ? -1 : 1);
      };
      if (reduced()) return finish();
      v.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 1, 1)';
      v.style.transform = `translate3d(${side === 'left' ? '100%' : '-100%'}, 0, 0)`;
      window.setTimeout(finish, 200);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [nav]);

  return (
    <div ref={ref} key={loc.key} className={`route-view ${dir ? `enter-${dir}` : ''}`}>
      {children}
    </div>
  );
}

/** Glisser une feuille vers le bas pour la fermer : on simule le toucher du voile, qui ferme déjà la feuille. */
export function SheetDrag() {
  useEffect(() => {
    let body: HTMLElement | null = null;
    let y0 = 0;
    let dy = 0;
    const onStart = (e: TouchEvent) => {
      const b = (e.target as HTMLElement)?.closest?.('.sheet-body') as HTMLElement | null;
      if (!b || b.scrollTop > 0) { body = null; return; }
      body = b;
      y0 = e.touches[0].clientY;
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!body) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 0 && body.scrollTop <= 0) {
        e.preventDefault();
        if (!reduced()) { body.style.transition = 'none'; body.style.transform = `translate3d(0, ${dy}px, 0)`; }
      }
    };
    const onEnd = () => {
      if (!body) return;
      const b = body;
      body = null;
      if (dy > 120) {
        const close = () => b.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (reduced()) return close();
        b.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 1, 1)';
        b.style.transform = 'translate3d(0, 100%, 0)';
        window.setTimeout(close, 200);
      } else {
        b.style.transition = reduced() ? 'none' : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
        b.style.transform = '';
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);
  return null;
}
