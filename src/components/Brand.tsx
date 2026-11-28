// Logo ARTCOL (maquette Figma « ARTCOL, logo final ») :
// six capitales encadrées comme des œuvres, tournées vers un visiteur placé au centre.
// Le A est sur fond carmin ; chaque autre lettre a un encadrement différent.

type Frame = 'carmin' | 'fin' | 'filet' | 'caisse' | 'toile' | 'epais';
const LETTERS: [string, Frame, number][] = [
  ['A', 'carmin', 36],
  ['R', 'fin', 22],
  ['T', 'filet', 7],
  ['C', 'caisse', -7],
  ['O', 'toile', -22],
  ['L', 'epais', -36]
];

/** Grande version, pour la bienvenue. `size` est la largeur d'un cadre en pixels. */
export function LogoGrand({ size = 48 }: { size?: number }) {
  return (
    <div className="logo-grand" role="img" aria-label="Artcol" style={{ ['--s' as string]: `${size}px` }}>
      {LETTERS.map(([ch, kind, angle]) => (
        <span key={ch} className={`lg-frame lg-${kind}`} style={{ transform: `rotateY(${angle}deg)` }} aria-hidden="true">
          <span className="lg-mat">
            <span className="lg-letter">{ch}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Version courte, pour l'en-tête : le A encadré sur carmin, puis RTCOL. `size` est la hauteur des capitales. */
export function LogoCourt({ size = 18 }: { size?: number }) {
  return (
    <span className="logo-court" style={{ ['--s' as string]: `${size}px` }} aria-hidden="true">
      <span className="lc-a">A</span>
      <span className="lc-rest">RTCOL</span>
    </span>
  );
}
