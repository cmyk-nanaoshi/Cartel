import sharp from 'sharp';
import type {
  ArtworkEntry,
  Candidate,
  ChatMessage,
  Claim,
  Comparable,
  EntryRequest,
  EntrySection,
  IdentifyResponse,
  LabelFields,
  LabelResponse,
  ObjectKind,
  SectionId,
  SourceRecord,
  UsageInfo,
  VisionAnalysis
} from '../../shared/types.js';
import type { AIProvider } from '../ai/types.js';
import { AIError } from '../ai/types.js';
import { identifySchema, entrySchema, labelSchema, OBJECT_KINDS } from '../ai/schemas.js';
import { ENTRY_SYSTEM, IDENTIFY_SYSTEM, LABEL_SYSTEM, chatSystem, sourcesBlock } from '../ai/prompts.js';
import type { Cache } from '../lib/cache.js';
import { sha256 } from '../lib/cache.js';
import type { Limiter } from '../lib/limits.js';
import type { SourceRegistry } from '../sources/index.js';
import { buildCandidate, confidenceLabel, decideStatus, rankRecords } from './scoring.js';
import { fetchImage, fingerprintQuery, fingerprintReference, similarity } from './visual.js';
import { artistMatch, slug } from '../lib/text.js';

export class InputError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

const SECTION_TITLES: Record<SectionId, string> = {
  resume: 'En bref',
  contexte: 'Contexte historique',
  analyse: 'Analyse formelle',
  technique: 'Technique et matériaux',
  iconographie: 'Iconographie et symboles',
  demarche: 'La démarche de l’artiste',
  provenance: 'Histoire et provenance',
  localisation: 'Où la voir',
  inscriptions: 'Inscriptions et marques'
};
const SECTION_ORDER = Object.keys(SECTION_TITLES) as SectionId[];

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

export class Services {
  constructor(
    public ai: AIProvider,
    public sources: SourceRegistry,
    private cache: Cache,
    private limiter: Limiter,
    private maxImageBytes: number
  ) {}

  private spend(u?: UsageInfo) {
    if (u) this.limiter.record(u.estimatedCostUsd);
  }

  private ensureBudget() {
    if (!this.ai.demo && !this.limiter.budgetLeft())
      throw new InputError('Le budget quotidien d’analyses est atteint. Réessayez demain ou augmentez DAILY_BUDGET_USD.', 429);
  }

  /** Normalise l'image : orientation EXIF, 1568 px max, JPEG. Réduit le coût et uniformise le cache. */
  async prepareImage(buf: Buffer, mime: string) {
    if (!buf.length) throw new InputError('Image vide.');
    if (buf.length > this.maxImageBytes) throw new InputError('Image trop lourde. Taille maximale : ' + Math.round(this.maxImageBytes / 1e6) + ' Mo.', 413);
    if (mime && !ACCEPTED.has(mime)) throw new InputError('Format non pris en charge. Utilisez JPEG, PNG ou WebP.', 415);
    let out: Buffer;
    try {
      out = await sharp(buf).rotate().resize(1568, 1568, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch {
      throw new InputError('Image illisible. Le fichier est peut-être corrompu ou dans un format non pris en charge.', 422);
    }
    const meta = await sharp(out).metadata();
    if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200)
      throw new InputError('Image trop petite pour être analysée (200 px minimum de côté).', 422);
    return { jpeg: out, hash: sha256(out) };
  }

  async identify(buf: Buffer, mime: string): Promise<IdentifyResponse> {
    const { jpeg, hash } = await this.prepareImage(buf, mime);
    const cacheKey = `identify:v2:${this.ai.name}:${hash}`;
    const hit = await this.cache.get<IdentifyResponse>(cacheKey);
    if (hit) return { ...hit, cached: true, usage: undefined };
    this.ensureBudget();

    const { data, usage } = await this.ai.json<VisionAnalysis>({
      task: 'identify',
      system: IDENTIFY_SYSTEM,
      content: [
        { type: 'image', mediaType: 'image/jpeg', base64: jpeg.toString('base64') },
        { type: 'text', text: 'Analyse cette photographie prise par un visiteur et propose tes identifications.' }
      ],
      schema: identifySchema,
      maxTokens: 6000,
      effort: 'medium'
    });
    this.spend(usage);
    const vision = sanitizeVision(data);
    const warnings: string[] = [];
    if (this.ai.demo) warnings.push('Mode démonstration : aucune IA n’a analysé la photo.');

    if (!vision.isArtwork) {
      return this.finish(cacheKey, { analysisId: hash, status: 'not_artwork', vision, candidates: [], warnings, usage });
    }
    if (vision.imageQualityIssue && !vision.hypotheses.length) {
      return this.finish(cacheKey, { analysisId: hash, status: 'unusable_image', vision, candidates: [], warnings, usage });
    }

    // Le cartel visible sur la photo fait foi : son titre et son artiste deviennent l'hypothèse principale.
    const hyps = applyLabelToHypotheses(vision).slice(0, 3);
    const searches = await Promise.all(
      hyps.map(async (h, i) => {
        const first = await this.sources.searchAll({ title: h.title, artist: h.artist, limit: 3 });
        let records = first.records;
        let errors = first.errors;
        // Deuxième essai avec le titre original ou anglais proposé par le modèle.
        const alt = i === 0 ? vision.searchQueries.find((q) => slug(q) !== slug(h.title) && !artistMatch(h.artist, q)) : undefined;
        if (rankRecords(h, records).length === 0 && alt) {
          const second = await this.sources.searchAll({ title: alt, artist: h.artist, limit: 3 });
          records = [...records, ...second.records.map((r) => r)];
          errors = [...errors, ...second.errors];
        }
        return { records, errors };
      })
    );
    for (const s of searches) for (const e of s.errors) if (!warnings.includes(e)) warnings.push(e);

    // Comparaison visuelle, bornée à 2 images par hypothèse.
    let query: Awaited<ReturnType<typeof fingerprintQuery>> | null = null;
    try {
      query = await fingerprintQuery(jpeg);
    } catch {
      query = null;
    }
    const candidates: Candidate[] = [];
    for (let i = 0; i < hyps.length; i++) {
      const h = hyps[i];
      const altTitles = vision.searchQueries;
      const ranked = rankAgainstAll(h, altTitles, searches[i].records);
      let visual: number | null = null;
      if (query) {
        const imgs = ranked.map((m) => m.r.thumbnailUrl ?? m.r.imageUrl).filter(Boolean).slice(0, 2) as string[];
        const scores = await Promise.all(
          imgs.map(async (u) => {
            const b = await fetchImage(u, 5000, this.sources.http.userAgent);
            if (!b) return null;
            try {
              return similarity(query!, await fingerprintReference(b));
            } catch {
              return null;
            }
          })
        );
        const valid = scores.filter((s): s is number => s !== null);
        if (valid.length) visual = Math.max(...valid);
      }
      const cand = buildCandidate(h, ranked, visual);
      if (labelBacked(vision, h)) {
        cand.labelConfirmed = true;
        cand.verified = true;
        cand.confidence = Math.max(cand.confidence, 0.9);
        cand.confidenceLabel = confidenceLabel(cand.confidence);
      }
      candidates.push(cand);
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    const status = decideStatus(candidates);
    if (candidates.length && !candidates.some((c) => c.verified || c.labelConfirmed))
      warnings.push('Aucune notice concordante trouvée dans les bases interrogées : l’identification n’est pas vérifiée.');
    return this.finish(cacheKey, { analysisId: hash, status, vision, candidates, warnings, usage });
  }

  private async finish(key: string, r: Omit<IdentifyResponse, 'provider' | 'demo' | 'cached'>): Promise<IdentifyResponse> {
    const full: IdentifyResponse = { ...r, provider: this.ai.name, demo: this.ai.demo, cached: false };
    // Les résultats incomplets (panne d'une source) sont gardés moins longtemps.
    const ttl = r.warnings.some((w) => w.includes('indisponible')) ? 60 * 30 : 60 * 60 * 24 * 30;
    await this.cache.set(key, full, ttl);
    return full;
  }

  async readLabel(buf: Buffer, mime: string): Promise<LabelResponse> {
    const { jpeg, hash } = await this.prepareImage(buf, mime);
    const key = `label:v1:${this.ai.name}:${hash}`;
    const hit = await this.cache.get<LabelResponse>(key);
    if (hit) return hit;
    this.ensureBudget();
    const { data, usage } = await this.ai.json<LabelFields>({
      task: 'label',
      system: LABEL_SYSTEM,
      content: [
        { type: 'image', mediaType: 'image/jpeg', base64: jpeg.toString('base64') },
        { type: 'text', text: 'Lis ce cartel.' }
      ],
      schema: labelSchema,
      maxTokens: 3000,
      effort: 'low'
    });
    this.spend(usage);
    const out: LabelResponse = { fields: data, provider: this.ai.name, demo: this.ai.demo, usage, warnings: [] };
    await this.cache.set(key, out);
    return out;
  }

  /** Recherche documentaire directe (cartel validé, recherche manuelle, mouvement). */
  async searchSources(q: { title?: string; artist?: string; text?: string }) {
    return this.sources.searchAll({ ...q, limit: 4 });
  }

  async entry(req: EntryRequest): Promise<ArtworkEntry> {
    const c = req.candidate;
    if (!c?.title || !c?.artist) throw new InputError('Titre et artiste requis pour rédiger une fiche.');
    // Le cartel lu sur place est la première source : il fait foi pour l'exemplaire photographié.
    const cartel = labelRecord(req.label);
    const records = [...(cartel ? [cartel] : []), ...(c.records ?? []).filter((r) => r.source !== 'cartel').slice(0, 6)];
    const key = `entry:v2:${this.ai.name}:${c.key}:${records.map((r) => r.id).join(',')}`;
    const hit = await this.cache.get<ArtworkEntry>(key);
    if (hit) return hit;

    const comparables = await this.comparables(c.artist, c.title, records);
    const base = baseEntry(c, records, comparables, req, this.ai);

    if (this.ai.demo) {
      base.warnings.push('Mode démonstration : fiche construite uniquement à partir des notices, sans rédaction par IA.');
      await this.cache.set(key, base, 60 * 60 * 24);
      return base;
    }

    this.ensureBudget();
    const { text, ids } = sourcesBlock(records);
    const context = [
      `Œuvre retenue : « ${c.title} », ${c.artist}${c.date ? `, ${c.date}` : ''}.`,
      req.vision ? `Nature observée sur la photo : ${req.vision.objectKind}. Observation : ${req.vision.description}` : '',
      req.vision?.inscriptions?.length ? `Inscriptions visibles : ${req.vision.inscriptions.join(' | ')}` : '',
      cartel ? 'Le cartel photographié sur place figure dans les sources : il fait foi.' : '',
      records.length ? '' : 'Aucune source n’a été trouvée : toutes les phrases doivent être de type observation, interpretation ou hypothese.',
      '',
      'Sources :',
      text
    ]
      .filter((l) => l !== '')
      .join('\n');
    try {
      const { data, usage } = await this.ai.json<{
        objectKind: string;
        movement: string | null;
        technique: string | null;
        artistLine: string | null;
        sections: { id: SectionId; claims: Claim[] }[];
      }>({
        task: 'entry',
        system: ENTRY_SYSTEM,
        content: [{ type: 'text', text: context }],
        schema: entrySchema,
        maxTokens: 12000,
        effort: 'medium'
      });
      this.spend(usage);
      const entry: ArtworkEntry = {
        ...base,
        objectKind: (OBJECT_KINDS.includes(data.objectKind) ? data.objectKind : base.objectKind) as ObjectKind,
        movement: data.movement ?? base.movement ?? null,
        // Le cartel est déjà en français et fait foi ; sinon, la traduction proposée par le modèle.
        technique: (cartel?.medium ?? data.technique ?? base.technique) || null,
        artistLine: (req.label?.artistDates ? cleanArtistDates(req.label.artistDates) : data.artistLine) || base.artistLine || null,
        sections: normalizeSections(data.sections, ids),
        aiWritten: true,
        model: usage.model,
        usage
      };
      if (entry.sections.some((s) => s.claims.some((cl) => cl.unsourced)))
        entry.warnings.push('Certaines affirmations présentées comme des faits n’étaient étayées par aucune source : elles sont signalées comme non sourcées.');
      await this.cache.set(key, entry);
      return entry;
    } catch (e) {
      if (e instanceof AIError) {
        base.warnings.push(`Rédaction par IA indisponible (${e.message}). Fiche construite à partir des notices seules.`);
        return base;
      }
      throw e;
    }
  }

  private async comparables(artist: string, title: string, own: SourceRecord[]): Promise<Comparable[]> {
    if (/anonyme|inconnu|unknown/i.test(artist)) return [];
    try {
      const { records } = await this.sources.searchAll({ artist, text: artist.split(' ').pop(), limit: 4 });
      const ownIds = new Set(own.map((r) => r.id));
      const pool = records
        .filter((r) => !ownIds.has(r.id) && artistMatch(artist, r.artist) > 0 && slug(r.title ?? '') !== slug(title))
        .filter((r) => r.thumbnailUrl || r.imageUrl)
        .slice(0, 10);
      // Une suggestion sans image visible est contre-productive : on vérifie que l'image se télécharge
      // vraiment avant de la proposer, et on écarte les autres.
      const checked = await Promise.all(
        pool.map(async (r) => {
          const url = r.thumbnailUrl ?? r.imageUrl!;
          const ok = await imageLoads(url, this.sources.http.userAgent);
          return ok ? { r, url } : null;
        })
      );
      return checked
        .filter((x): x is { r: SourceRecord; url: string } => !!x)
        .slice(0, 6)
        .map(({ r, url }) => ({
          title: r.title ?? 'Sans titre',
          artist: r.artist,
          date: r.date,
          url: r.url,
          imageUrl: url,
          sourceId: r.id
        }));
    } catch {
      return [];
    }
  }

  async chat(entry: ArtworkEntry, messages: ChatMessage[], onDelta: (t: string) => void, signal?: AbortSignal) {
    if (!messages.length || messages[messages.length - 1].role !== 'user') throw new InputError('Question manquante.');
    const trimmed = messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    this.ensureBudget();
    const usage = await this.ai.stream({ system: chatSystem(entry), messages: trimmed, maxTokens: 3000 }, onDelta, signal);
    this.spend(usage);
    return usage;
  }
}

function rankAgainstAll(h: VisionAnalysis['hypotheses'][number], altTitles: string[], records: SourceRecord[]) {
  const best = new Map<string, { r: SourceRecord; score: number }>();
  for (const t of [h.title, ...altTitles]) {
    for (const m of rankRecords({ ...h, title: t }, records)) {
      const prev = best.get(m.r.id);
      if (!prev || prev.score < m.score) best.set(m.r.id, m);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

export function sanitizeVision(v: any): VisionAnalysis {
  const arr = (x: any) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);
  const hyps = (Array.isArray(v?.hypotheses) ? v.hypotheses : [])
    .filter((h: any) => h && typeof h.title === 'string' && h.title.trim() && typeof h.artist === 'string')
    .map((h: any) => ({
      title: h.title.trim(),
      artist: h.artist.trim() || 'Anonyme',
      date: typeof h.date === 'string' && h.date.trim() ? h.date.trim() : null,
      confidence: Math.max(0, Math.min(1, Number(h.confidence) || 0)),
      reasoning: String(h.reasoning ?? ''),
      distinguishing: String(h.distinguishing ?? '')
    }))
    .sort((a: any, b: any) => b.confidence - a.confidence);
  return {
    isArtwork: v?.isArtwork !== false,
    label: sanitizeLabel(v?.label),
    imageQualityIssue: typeof v?.imageQualityIssue === 'string' && v.imageQualityIssue.trim() ? v.imageQualityIssue : null,
    objectKind: OBJECT_KINDS.includes(v?.objectKind) ? v.objectKind : 'autre',
    description: String(v?.description ?? ''),
    visibleText: arr(v?.visibleText),
    inscriptions: arr(v?.inscriptions),
    hypotheses: hyps,
    searchQueries: arr(v?.searchQueries).slice(0, 6)
  };
}

/**
 * Remet les sections dans l'ordre éditorial, traduit les identifiants S1… en identifiants de notices
 * et rétrograde tout « fait » qui ne cite aucune notice existante.
 */
export function normalizeSections(sections: { id: SectionId; claims: Claim[] }[], ids: Map<string, string>): EntrySection[] {
  const byId = new Map<SectionId, Claim[]>();
  for (const s of sections ?? []) {
    if (!SECTION_ORDER.includes(s.id)) continue;
    const claims = (s.claims ?? [])
      .filter((c) => c && typeof c.text === 'string' && c.text.trim())
      .map((c) => {
        const srcs = (c.sources ?? [])
          .map((x) => ids.get(String(x).replace(/[\[\]\s]/g, '')))
          .filter((x): x is string => !!x);
        const kind = ['fait', 'observation', 'interpretation', 'hypothese'].includes(c.kind) ? c.kind : 'interpretation';
        if (kind === 'fait' && !srcs.length) return { text: c.text.trim(), kind: 'interpretation' as const, sources: [], unsourced: true };
        // Une observation ou une interprétation ne porte pas d'appel de note, sauf si une source la contient.
        return { text: c.text.trim(), kind, sources: [...new Set(srcs)] } as Claim;
      });
    if (claims.length) byId.set(s.id, [...(byId.get(s.id) ?? []), ...claims]);
  }
  return SECTION_ORDER.filter((id) => byId.has(id)).map((id) => ({ id, title: SECTION_TITLES[id], claims: byId.get(id)! }));
}

/** Fiche minimale, construite uniquement à partir des champs des notices (aucune rédaction libre). */
export function baseEntry(
  c: EntryRequest['candidate'],
  records: SourceRecord[],
  comparables: Comparable[],
  req: EntryRequest,
  ai: AIProvider
): ArtworkEntry {
  const pick = (f: keyof SourceRecord) => {
    const r = records.find((x) => x[f]);
    return r ? { value: String(r[f]), id: r.id } : null;
  };
  const technique = pick('medium');
  const dims = pick('dimensions');
  const inst = pick('institution');
  const loc = pick('location');
  const inv = pick('inventory');
  const mov = pick('movement');
  const desc = pick('description');
  const credit = pick('credit');
  const img = records.find((r) => r.imageUrl && r.source !== 'cartel');
  const cartel = records.find((r) => r.source === 'cartel');
  const facts: EntrySection[] = [];
  const push = (id: SectionId, claims: (Claim | null)[]) => {
    const ok = claims.filter(Boolean) as Claim[];
    if (ok.length) facts.push({ id, title: SECTION_TITLES[id], claims: ok });
  };
  const fact = (text: string, id: string): Claim => ({ text, kind: 'fait', sources: [id] });
  push('resume', [desc ? fact(desc.value, desc.id) : null]);
  push('technique', [technique ? fact(`Technique : ${technique.value}.`, technique.id) : null, dims ? fact(`Dimensions : ${dims.value}.`, dims.id) : null]);
  push('localisation', [
    inst ? fact(`Conservée par : ${inst.value}${loc && loc.value !== inst.value ? `, ${loc.value}` : ''}.`, inst.id) : null,
    inv ? fact(`Numéro d’inventaire : ${inv.value}.`, inv.id) : null
  ]);
  push('provenance', [credit ? fact(`Ligne de crédit : ${credit.value}.`, credit.id) : null]);
  const ins = req.vision?.inscriptions ?? [];
  push('inscriptions', ins.length ? [{ text: `Relevé sur la photo : ${ins.join(' ; ')}.`, kind: 'observation', sources: [] }] : []);

  return {
    key: c.key,
    title: c.title,
    artist: c.artist,
    date: cartel?.date ?? c.date ?? pick('date')?.value ?? null,
    objectKind: (req.vision?.objectKind as ObjectKind) ?? 'autre',
    movement: mov?.value ?? null,
    artistLine: req.label?.artistDates ? cleanArtistDates(req.label.artistDates) : null,
    // pick() lit d'abord le cartel, placé en tête des sources.
    technique: technique?.value ?? null,
    dimensions: dims?.value ?? null,
    institution: inst?.value ?? null,
    location: loc?.value ?? null,
    inventory: inv?.value ?? null,
    imageUrl: img?.imageUrl,
    imageCredit: img ? `${img.sourceLabel}${img.imageLicense ? `, ${img.imageLicense}` : ''}` : undefined,
    sections: facts,
    sources: records,
    comparables,
    provider: ai.name,
    model: null,
    demo: ai.demo,
    aiWritten: false,
    generatedAt: new Date().toISOString(),
    warnings: records.some((r) => r.source !== 'cartel') ? [] : ['Aucune notice de musée n’a été trouvée pour cette œuvre.']
  };
}

// ---------- Cartel ----------

const LABEL_KEYS = ['title', 'artist', 'artistDates', 'date', 'medium', 'dimensions', 'inventory', 'institution', 'creditLine', 'description'] as const;

export function sanitizeLabel(l: any): LabelFields | null {
  if (!l || typeof l !== 'object') return null;
  const out: any = {};
  for (const k of LABEL_KEYS) out[k] = typeof l[k] === 'string' && l[k].trim() ? l[k].trim() : null;
  out.rawText = typeof l.rawText === 'string' ? l.rawText.trim() : '';
  return LABEL_KEYS.some((k) => out[k]) || out.rawText ? (out as LabelFields) : null;
}

/** Le cartel lu sur place devient une source à part entière, citable et prioritaire. */
export function labelRecord(label?: Partial<LabelFields> | null): SourceRecord | null {
  if (!label) return null;
  const has = LABEL_KEYS.some((k) => typeof label[k] === 'string' && label[k]!.trim());
  if (!has) return null;
  const v = (x?: string | null) => (x && x.trim() ? x.trim() : undefined);
  const id = 'cartel:' + sha256(JSON.stringify(LABEL_KEYS.map((k) => label[k] ?? null))).slice(0, 12);
  return {
    id,
    source: 'cartel',
    sourceLabel: 'Cartel photographié sur place',
    url: '',
    title: v(label.title),
    artist: v(label.artist),
    artistBio: v(label.artistDates),
    date: v(label.date),
    medium: v(label.medium),
    dimensions: v(label.dimensions),
    institution: v(label.institution),
    inventory: v(label.inventory),
    credit: v(label.creditLine),
    description: v(label.description)
  };
}

/** « (Japon, 1760-1849) » devient « Japon, 1760-1849 ». */
function cleanArtistDates(s: string) {
  return s.trim().replace(/^\((.*)\)$/, '$1');
}

function labelBacked(vision: VisionAnalysis, h: { reasoning: string }) {
  return !!vision.label && h.reasoning.startsWith(LABEL_REASON);
}

const LABEL_REASON = 'Lu sur le cartel visible sur la photo.';

/** Si le cartel lisible nomme une œuvre que le modèle n'a pas proposée, elle passe en tête. */
export function applyLabelToHypotheses(vision: VisionAnalysis): VisionAnalysis['hypotheses'] {
  const l = vision.label;
  const hyps = [...vision.hypotheses];
  if (!l?.title || !l.artist) return hyps;
  const same = hyps.findIndex((h) => artistMatch(l.artist!, h.artist) > 0);
  if (same >= 0) {
    const [h] = hyps.splice(same, 1);
    return [{ ...h, confidence: Math.max(h.confidence, 0.9), reasoning: `${LABEL_REASON} ${h.reasoning}`.trim() }, ...hyps];
  }
  return [
    { title: l.title, artist: l.artist, date: l.date, confidence: 0.9, reasoning: LABEL_REASON, distinguishing: '' },
    ...hyps
  ];
}

// ---------- Images ----------

const imageOk = new Map<string, { ok: boolean; at: number }>();

/** Vérifie qu'une image de musée se télécharge (résultat gardé une heure). */
export async function imageLoads(url: string, userAgent: string): Promise<boolean> {
  const hit = imageOk.get(url);
  if (hit && Date.now() - hit.at < 3600_000) return hit.ok;
  const b = await fetchImage(url, 5000, userAgent);
  let ok = false;
  if (b && b.length > 500) {
    try {
      const m = await sharp(b).metadata();
      ok = (m.width ?? 0) >= 64 && (m.height ?? 0) >= 64;
    } catch {
      ok = false;
    }
  }
  imageOk.set(url, { ok, at: Date.now() });
  if (imageOk.size > 2000) imageOk.delete(imageOk.keys().next().value!);
  return ok;
}
