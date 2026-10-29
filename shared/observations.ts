// Observations : où le visiteur a vu une œuvre, déclaré par lui-même.
// Règle de confidentialité : ce qui quitte le téléphone est exactement ce qui est public, rien de plus.
// Une observation privée n'est jamais envoyée ; l'adresse d'une collection privée non plus.

export type PlaceKind = 'musee' | 'vente' | 'galerie' | 'foire' | 'collection_privee' | 'espace_public' | 'autre';

export const PLACE_KINDS: { id: PlaceKind; label: string; nameLabel: string }[] = [
  { id: 'musee', label: 'Musée', nameLabel: 'Nom du musée' },
  { id: 'vente', label: 'Maison de ventes', nameLabel: 'Maison de ventes' },
  { id: 'galerie', label: 'Galerie', nameLabel: 'Nom de la galerie' },
  { id: 'foire', label: 'Foire, salon', nameLabel: 'Nom de la foire ou du salon' },
  { id: 'collection_privee', label: 'Collection privée', nameLabel: 'Nom de la collection' },
  { id: 'espace_public', label: 'Espace public', nameLabel: 'Lieu' },
  { id: 'autre', label: 'Autre', nameLabel: 'Lieu' }
];

export const kindLabel = (k: PlaceKind) => PLACE_KINDS.find((p) => p.id === k)?.label ?? 'Autre';

/** public : tout ce qui a été saisi (sauf l'adresse) ; public_ville : type de lieu et ville ; prive : rien. */
export type Visibility = 'public' | 'public_ville' | 'prive';

export interface Observation {
  id: string;
  artworkKey: string;
  artworkTitle: string;
  artworkArtist: string;
  kind: PlaceKind;
  placeName: string;
  city: string;
  date: string; // AAAA-MM-JJ, date de l'observation
  exhibition?: string; // musée, galerie, foire : exposition ou salle
  lot?: string; // vente
  saleMoment?: 'exposition' | 'vente';
  saleDate?: string;
  estimate?: string;
  address?: string; // collection privée : reste toujours sur le téléphone
  isOwner?: boolean; // collection privée : le visiteur est propriétaire
  visibility: Visibility;
  photo?: Blob;
  createdAt: number;
  updatedAt: number;
}

/** Niveaux permis : sans être propriétaire, une collection privée ne peut pas être entièrement publique. */
export function allowedVisibilities(o: Pick<Observation, 'kind' | 'isOwner'>): Visibility[] {
  if (o.kind === 'collection_privee' && !o.isOwner) return ['public_ville', 'prive'];
  return ['public', 'public_ville', 'prive'];
}

export function defaultVisibility(o: Pick<Observation, 'kind' | 'isOwner'>): Visibility {
  return allowedVisibilities(o)[0];
}

/** Ce qui peut quitter le téléphone. null pour une observation privée. */
export function publicView(o: Observation): Record<string, string | boolean> | null {
  const vis = allowedVisibilities(o).includes(o.visibility) ? o.visibility : 'prive';
  if (vis === 'prive') return null;
  const base: Record<string, string | boolean> = {
    artworkKey: o.artworkKey,
    artworkTitle: o.artworkTitle,
    artworkArtist: o.artworkArtist,
    kind: o.kind,
    city: o.city,
    date: o.date
  };
  if (vis === 'public_ville') return base;
  const full: Record<string, string | boolean> = { ...base, placeName: o.placeName };
  for (const k of ['exhibition', 'lot', 'saleMoment', 'saleDate', 'estimate'] as const) if (o[k]) full[k] = o[k]!;
  if (o.kind === 'collection_privee') full.declaredByOwner = true;
  // L'adresse n'est jamais publique, quel que soit le réglage.
  return full;
}

/** Libellé affiché sur la fiche pour le niveau choisi. */
export function visibilityLabel(o: Observation): string {
  if (o.visibility === 'prive') return 'Privée';
  if (o.visibility === 'public_ville') return 'Publique, ville seulement';
  return 'Publique';
}

/** 2026-10-29 devient 29.10.2026, à la manière d'un registre. */
export function registerDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** « lot 94 », « lot n° 94 » lus sur la photo (étiquette de vente). */
export function lotFromText(lines: string[] = []): string | null {
  for (const l of lines) {
    const m = /\blot\s*(?:n[°o]\.?\s*)?(\d{1,5})\b/i.exec(l);
    if (m) return m[1];
  }
  return null;
}
