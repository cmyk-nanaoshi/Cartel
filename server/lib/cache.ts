import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Cache à deux niveaux : mémoire (LRU) puis disque (JSON). Le disque est optionnel. */
export class Cache {
  private mem = new Map<string, { value: unknown; expires: number }>();
  constructor(
    private dir: string | null,
    private maxEntries = 500
  ) {}

  private file(key: string) {
    return join(this.dir!, createHash('sha256').update(key).digest('hex') + '.json');
  }

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.mem.get(key);
    if (hit) {
      if (hit.expires > Date.now()) {
        this.mem.delete(key);
        this.mem.set(key, hit);
        return hit.value as T;
      }
      this.mem.delete(key);
    }
    if (!this.dir) return undefined;
    try {
      const raw = JSON.parse(await readFile(this.file(key), 'utf8'));
      if (raw.expires > Date.now()) {
        this.setMem(key, raw.value, raw.expires);
        return raw.value as T;
      }
    } catch {
      /* absent */
    }
    return undefined;
  }

  async set(key: string, value: unknown, ttlSeconds = 60 * 60 * 24 * 30) {
    const expires = Date.now() + ttlSeconds * 1000;
    this.setMem(key, value, expires);
    if (!this.dir) return;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.file(key), JSON.stringify({ expires, value }));
    } catch {
      // Système de fichiers en lecture seule (serverless) : le cache mémoire suffit.
      this.dir = null;
    }
  }

  private setMem(key: string, value: unknown, expires: number) {
    this.mem.set(key, { value, expires });
    while (this.mem.size > this.maxEntries) {
      const first = this.mem.keys().next().value as string;
      this.mem.delete(first);
    }
  }
}

export function sha256(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}
