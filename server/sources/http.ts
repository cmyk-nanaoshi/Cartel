export class SourceError extends Error {
  constructor(
    public source: string,
    message: string
  ) {
    super(`${source}: ${message}`);
  }
}

export interface HttpOptions {
  timeoutMs: number;
  userAgent: string;
  headers?: Record<string, string>;
}

/** fetch JSON avec délai maximal et en-tête User-Agent identifiable (demandé par Wikidata et l'AIC). */
export async function getJson<T = any>(source: string, url: string, opts: HttpOptions): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': opts.userAgent, ...(opts.headers ?? {}) }
    });
    if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e: any) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(source, e?.name === 'AbortError' ? 'délai dépassé' : String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

export function clean(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t || undefined;
}
