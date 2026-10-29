import sharp, { type Sharp } from 'sharp';

// Comparaison visuelle entre la photo du visiteur et l'image de référence d'une notice.
// C'est un signal d'appoint, robuste mais rudimentaire : une photo prise de biais, avec reflets
// ou cadre, restera moins ressemblante qu'une reproduction. Il ne remplace pas l'œil humain.

const SIZE = 24;

export interface Fingerprint {
  gray: Float64Array[]; // une empreinte par recadrage
  hist: Float64Array;
}

async function grayVector(img: Sharp): Promise<Float64Array> {
  const { data } = await img.clone().resize(SIZE, SIZE, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const v = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < v.length; i++) v[i] = data[i];
  return v;
}

async function colorHist(img: Sharp): Promise<Float64Array> {
  const { data } = await img.clone().resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = 4;
  const h = new Float64Array(bins * bins * bins);
  for (let i = 0; i < data.length; i += 3) {
    const r = Math.min(bins - 1, Math.floor((data[i] / 256) * bins));
    const g = Math.min(bins - 1, Math.floor((data[i + 1] / 256) * bins));
    const b = Math.min(bins - 1, Math.floor((data[i + 2] / 256) * bins));
    h[r * bins * bins + g * bins + b]++;
  }
  const total = data.length / 3;
  for (let i = 0; i < h.length; i++) h[i] /= total;
  return h;
}

/** Empreinte de la photo : image entière + recadrages centraux (la photo inclut souvent le cadre et le mur). */
export async function fingerprintQuery(buf: Buffer): Promise<Fingerprint> {
  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const w = meta.width ?? SIZE;
  const h = meta.height ?? SIZE;
  const crops = [1, 0.85, 0.7].map((f) => {
    const cw = Math.max(8, Math.round(w * f));
    const ch = Math.max(8, Math.round(h * f));
    return base.clone().extract({ left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2), width: cw, height: ch });
  });
  const gray = await Promise.all(crops.map(grayVector));
  // L'histogramme se calcule sur le recadrage intermédiaire pour limiter l'influence du mur.
  const hist = await colorHist(crops[1]);
  return { gray, hist };
}

export async function fingerprintReference(buf: Buffer): Promise<Fingerprint> {
  const img = sharp(buf);
  return { gray: [await grayVector(img)], hist: await colorHist(img) };
}

function pearson(a: Float64Array, b: Float64Array) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (!da || !db) return 0;
  return num / Math.sqrt(da * db);
}

function histIntersection(a: Float64Array, b: Float64Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** Score de 0 à 1. Au-delà de 0,6 environ, la ressemblance est nette. */
export function similarity(q: Fingerprint, r: Fingerprint): number {
  const structural = Math.max(...q.gray.map((g) => pearson(g, r.gray[0])));
  const color = histIntersection(q.hist, r.hist);
  return Math.max(0, Math.min(1, 0.65 * Math.max(0, structural) + 0.35 * color));
}

/** Télécharge une vignette de notice (taille et durée bornées). */
export async function fetchImage(url: string, timeoutMs: number, userAgent: string): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: imageHeaders(url, userAgent) });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 5_000_000) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > 5_000_000) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** En-têtes pour les serveurs d'images de musées. L'AIC demande en plus AIC-User-Agent. */
export function imageHeaders(url: string, userAgent: string): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': userAgent, Accept: 'image/avif,image/webp,image/jpeg,image/*;q=0.8' };
  try {
    if (new URL(url).hostname.endsWith('artic.edu')) h['AIC-User-Agent'] = userAgent;
  } catch {
    /* URL invalide : fetch échouera de lui-même */
  }
  return h;
}

/** Hôtes d'images autorisés pour le relais /api/img (pas de relais ouvert vers n'importe quel site). */
export const IMAGE_HOSTS = ['artic.edu', 'metmuseum.org', 'wikimedia.org', 'si.edu', 'rijksmuseum.nl', 'culture.gouv.fr'];

export function allowedImageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    return IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) ? u : null;
  } catch {
    return null;
  }
}
