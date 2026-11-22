// Apparence : Automatique suit le réglage du téléphone, Clair et Sombre l'imposent.
// Le choix est gardé dans localStorage pour être appliqué avant le premier rendu, sans éclair blanc.
export type Appearance = 'auto' | 'light' | 'dark';
const KEY = 'cartel.appearance';

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyAppearance(a: Appearance = getAppearance()) {
  const root = document.documentElement;
  if (a === 'auto') delete root.dataset.theme;
  else root.dataset.theme = a;
  const dark = a === 'dark' || (a === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#202B29' : '#FFFFFF');
}

export function setAppearance(a: Appearance) {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    /* navigation privée : le choix vaut pour la session */
  }
  applyAppearance(a);
}
