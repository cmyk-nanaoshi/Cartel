// Typographie française appliquée aux textes affichés (fiches, cartels, notices, IA).
// Les modèles et les notices mélangent espaces ordinaires, absentes ou doublées :
// on normalise pour qu'aucun signe double ne se retrouve seul en début de ligne.

const NBSP = ' '; // espace insécable : avant « : » et à l'intérieur des guillemets
const NNBSP = ' '; // espace fine insécable : avant ; ! ?

/** Applique les espaces insécables françaises. Sans effet sur les URL, les heures ni les ratios. */
export function frTypo(input: string | null | undefined): string {
  if (!input) return '';
  let s = input;
  // Guillemets français : espace insécable à l'intérieur, ajoutée si absente.
  s = s.replace(/«[ \t  ]*/g, `«${NBSP}`).replace(/[ \t  ]*»/g, `${NBSP}»`);
  // ; ! ? : espace fine insécable. On la remplace si une espace existe, on l'ajoute après une lettre
  // ou un signe fermant, mais jamais à l'intérieur d'une URL (« ?q= », « https: »).
  s = s.replace(/(\S)[ \t  ]*([;!?])(?=\s|$|[»)\]])/g, (m, before: string, sign: string) =>
    /[\/=&]/.test(before) ? m : `${before}${NNBSP}${sign}`
  );
  // Deux-points : on remplace l'espace ordinaire précédente, sans en ajouter (heures, 4:3, URL).
  s = s.replace(/[ \t ]+:(?=\s|$)/g, `${NBSP}:`);
  // Espaces doublées.
  s = s.replace(/ {2,}/g, ' ');
  return s;
}

/** Nombre au format français (virgule décimale). */
export function frNumber(n: number, maxFraction = 3): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: maxFraction });
}
