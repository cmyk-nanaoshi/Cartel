import type {
  ArtworkEntry,
  ChatMessage,
  EntryRequest,
  IdentifyResponse,
  LabelResponse,
  MapPlace,
  ServerConfig,
  SourceRecord,
  WorkStatus,
  WorkSummary,
  UsageInfo
} from '../../shared/types';
import { getSetting } from './db';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/**
 * Adresse d'affichage d'une image de musée : relayée par notre serveur, car certains musées
 * (l'AIC notamment) bloquent l'affichage direct sur téléphone. Les photos locales passent telles quelles.
 */
export function museumImg(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (/^(blob:|data:|\/)/.test(u)) return u;
  return `${BASE}/api/img?u=${encodeURIComponent(u)}`;
}

async function headers(extra: Record<string, string> = {}) {
  const code = await getSetting<string>('accessCode');
  return { ...(code ? { 'x-access-code': code } : {}), ...extra };
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 90_000): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new ApiError('Pas de connexion internet. Vos fiches enregistrées restent consultables.', 0, 'offline');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...init, signal: init.signal ?? ctrl.signal, headers: await headers(init.headers as any) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(body?.error ?? `Erreur ${res.status}`, res.status, body?.code);
    return body as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') throw new ApiError('Le serveur met trop de temps à répondre. Réessayez.', 0, 'timeout');
    throw new ApiError('Serveur injoignable. Vérifiez votre connexion.', 0, 'network');
  } finally {
    clearTimeout(t);
  }
}

async function adminHeaders(extra: Record<string, string> = {}) {
  const code = await getSetting<string>('adminCode');
  return { ...(code ? { 'x-admin-code': code } : {}), ...extra };
}

export interface AdminWork {
  workId: string;
  status: WorkStatus;
  entry: ArtworkEntry;
  recordIds: string[];
  uses: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  reports: { reason: string; createdAt: string }[];
}
export type AdminCounts = Record<WorkStatus | 'signalees', number>;

export const admin = {
  async list(status?: WorkStatus | 'signalees') {
    return request<{ works: WorkSummary[]; counts: AdminCounts; storage: string }>(
      `/api/admin/works${status ? `?status=${status}` : ''}`,
      { headers: await adminHeaders() },
      30_000
    );
  },
  async get(id: string) {
    return request<AdminWork>(`/api/admin/works/${encodeURIComponent(id)}`, { headers: await adminHeaders() }, 30_000);
  },
  async setStatus(id: string, status: WorkStatus) {
    return request<{ ok: true }>(
      `/api/admin/works/${encodeURIComponent(id)}/status`,
      { method: 'POST', body: JSON.stringify({ status }), headers: await adminHeaders({ 'content-type': 'application/json' }) },
      30_000
    );
  },
  async remove(id: string) {
    return request<{ ok: true }>(`/api/admin/works/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await adminHeaders() }, 30_000);
  }
};

export const api = {
  config: () => request<ServerConfig>('/api/config', {}, 10_000),

  identify(image: Blob) {
    const fd = new FormData();
    fd.append('image', image, 'photo.jpg');
    return request<IdentifyResponse>('/api/identify', { method: 'POST', body: fd }, 120_000);
  },

  label(image: Blob) {
    const fd = new FormData();
    fd.append('image', image, 'cartel.jpg');
    return request<LabelResponse>('/api/label', { method: 'POST', body: fd }, 60_000);
  },

  entry(req: EntryRequest) {
    return request<ArtworkEntry>(
      '/api/entry',
      { method: 'POST', body: JSON.stringify(req), headers: { 'content-type': 'application/json' } },
      120_000
    );
  },

  report(workId: string, reason: string) {
    return request<{ ok: true }>(
      '/api/report',
      { method: 'POST', body: JSON.stringify({ workId, reason }), headers: { 'content-type': 'application/json' } },
      30_000
    );
  },

  search(q: { title?: string; artist?: string; q?: string }) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<{ records: SourceRecord[]; errors: string[] }>(`/api/search?${p}`, {}, 30_000);
  },

  discover: () => request<{ records: SourceRecord[]; error?: string }>('/api/discover', {}, 20_000),

  places: (lat: number, lon: number, radius: number) =>
    request<{ places: MapPlace[]; error?: string }>(`/api/places?lat=${lat}&lon=${lon}&radius=${radius}`, {}, 30_000),

  /** Conversation en flux (Server-Sent Events). */
  async chat(entry: ArtworkEntry, messages: ChatMessage[], onDelta: (t: string) => void, signal?: AbortSignal): Promise<UsageInfo | null> {
    const res = await fetch(BASE + '/api/chat', {
      method: 'POST',
      signal,
      body: JSON.stringify({ entry, messages }),
      headers: await headers({ 'content-type': 'application/json' })
    }).catch(() => {
      throw new ApiError('Serveur injoignable. Vérifiez votre connexion.', 0, 'network');
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ApiError(b?.error ?? `Erreur ${res.status}`, res.status, b?.code);
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let usage: UsageInfo | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: ?(.*)$/m.exec(block)?.[1];
        const data = /^data: ?(.*)$/m.exec(block)?.[1];
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (ev === 'delta') onDelta(parsed);
        else if (ev === 'done') usage = parsed.usage;
        else if (ev === 'error') throw new ApiError(parsed.error, 502);
      }
    }
    return usage;
  }
};
