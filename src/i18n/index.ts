// Internationalisation minimale : un dictionnaire par langue, le français par défaut.
// Pour ajouter une langue : créer un objet avec les mêmes clés et l'ajouter à DICTS.
import { fr } from './fr';
import { en } from './en';

export type Lang = 'fr' | 'en';
type Dict = typeof fr;
export type Key = keyof Dict;

const DICTS: Record<Lang, Partial<Dict>> = { fr, en };

let lang: Lang = (localStorage.getItem('lang') as Lang) || 'fr';

export function setLang(l: Lang) {
  lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
}

export function getLang() {
  return lang;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = (DICTS[lang][key] ?? fr[key]) as string;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
