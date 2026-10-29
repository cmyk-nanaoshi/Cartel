import Dexie, { type Table } from 'dexie';
import type { ArtworkEntry, ChatMessage, IdentifyResponse, LabelFields } from '../../shared/types';
import type { Observation } from '../../shared/observations';

// Stockage local (IndexedDB). Les photos, notes et fiches persistent après fermeture de l'application.
// Chaque enregistrement porte updatedAt pour une future synchronisation entre appareils.

export interface SavedArtwork {
  id: string; // clé de la fiche
  entry: ArtworkEntry;
  photo?: Blob; // photo prise par l'utilisateur (1568 px, ou vignette 640 px pour les anciens enregistrements)
  notes: string;
  tags: string[];
  collectionIds: string[];
  geo?: { lat: number; lon: number; accuracy?: number };
  label?: LabelFields;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeCollection {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface CachedAnalysis {
  id: string; // empreinte SHA-256 de la photo envoyée
  response: IdentifyResponse;
  createdAt: number;
}

export interface ChatThread {
  id: string; // clé de fiche
  messages: ChatMessage[];
  updatedAt: number;
}

class CartelDB extends Dexie {
  artworks!: Table<SavedArtwork, string>;
  collections!: Table<ThemeCollection, string>;
  analyses!: Table<CachedAnalysis, string>;
  entries!: Table<{ id: string; entry: ArtworkEntry; createdAt: number }, string>;
  chats!: Table<ChatThread, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  observations!: Table<Observation, string>;

  constructor() {
    super('cartel');
    this.version(1).stores({
      artworks: 'id, createdAt, updatedAt, *tags, *collectionIds',
      collections: 'id, name, createdAt',
      analyses: 'id, createdAt',
      entries: 'id, createdAt',
      chats: 'id, updatedAt',
      settings: 'key'
    });
    // v2 : lieux où le visiteur a vu une œuvre (traçabilité).
    this.version(2).stores({ observations: 'id, artworkKey, date, updatedAt' });
  }
}

export const db = new CartelDB();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  try {
    return (await db.settings.get(key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- Sauvegarde et restauration (JSON) ----------

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function dataUrlToBlob(s: string): Promise<Blob> {
  return (await fetch(s)).blob();
}

export async function exportBackup(): Promise<Blob> {
  const artworks = await db.artworks.toArray();
  const out = {
    format: 'cartel-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    collections: await db.collections.toArray(),
    chats: await db.chats.toArray(),
    observations: await Promise.all(
      (await db.observations.toArray()).map(async (o) => ({ ...o, photo: o.photo ? await blobToDataUrl(o.photo) : undefined }))
    ),
    artworks: await Promise.all(artworks.map(async (a) => ({ ...a, photo: a.photo ? await blobToDataUrl(a.photo) : undefined })))
  };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(file: Blob): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.format !== 'cartel-backup') throw new Error('Ce fichier n’est pas une sauvegarde Cartel.');
  const artworks: SavedArtwork[] = await Promise.all(
    (data.artworks ?? []).map(async (a: any) => ({ ...a, photo: a.photo ? await dataUrlToBlob(a.photo) : undefined }))
  );
  const observations: Observation[] = await Promise.all(
    (data.observations ?? []).map(async (o: any) => ({ ...o, photo: o.photo ? await dataUrlToBlob(o.photo) : undefined }))
  );
  await db.transaction('rw', [db.artworks, db.collections, db.chats, db.observations], async () => {
    // Fusion : on garde la version la plus récente de chaque élément.
    for (const a of artworks) {
      const cur = await db.artworks.get(a.id);
      if (!cur || cur.updatedAt < a.updatedAt) await db.artworks.put(a);
    }
    for (const c of data.collections ?? []) {
      const cur = await db.collections.get(c.id);
      if (!cur || cur.updatedAt < c.updatedAt) await db.collections.put(c);
    }
    for (const t of data.chats ?? []) {
      const cur = await db.chats.get(t.id);
      if (!cur || cur.updatedAt < t.updatedAt) await db.chats.put(t);
    }
    for (const o of observations) {
      const cur = await db.observations.get(o.id);
      if (!cur || cur.updatedAt < o.updatedAt) await db.observations.put(o);
    }
  });
  return artworks.length;
}
