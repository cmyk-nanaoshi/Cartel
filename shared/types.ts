// Types partagés entre le client (PWA) et le serveur (API).

export type ObjectKind =
  | 'peinture'
  | 'sculpture'
  | 'photographie'
  | 'dessin'
  | 'estampe'
  | 'installation'
  | 'objet_design'
  | 'art_urbain'
  | 'architecture'
  | 'arts_decoratifs'
  | 'autre';

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  peinture: 'Peinture',
  sculpture: 'Sculpture',
  photographie: 'Photographie',
  dessin: 'Dessin',
  estampe: 'Estampe',
  installation: 'Installation',
  objet_design: 'Objet de design',
  art_urbain: 'Art urbain',
  architecture: 'Architecture',
  arts_decoratifs: 'Arts décoratifs',
  autre: 'Autre'
};

export type SourceId = 'cartel' | 'met' | 'aic' | 'wikidata' | 'joconde' | 'rijksmuseum' | 'smithsonian' | 'fixture';

/** Notice issue d'une base documentaire réelle. Rien ici n'est produit par l'IA. */
export interface SourceRecord {
  id: string; // `${source}:${identifiant natif}`
  source: SourceId;
  sourceLabel: string;
  url: string; // page consultable
  title?: string;
  artist?: string;
  artistBio?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  institution?: string;
  location?: string;
  inventory?: string;
  movement?: string;
  classification?: string;
  description?: string;
  credit?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  imageLicense?: string;
  coordinates?: { lat: number; lon: number };
}

export interface VisionHypothesis {
  title: string;
  artist: string;
  date: string | null;
  confidence: number; // 0..1, auto-évaluée par le modèle
  reasoning: string;
  distinguishing: string;
}

export interface VisionAnalysis {
  isArtwork: boolean;
  /** Cartel visible sur la photo de l'œuvre, lu champ par champ. null s'il n'y en a pas. */
  label: LabelFields | null;
  imageQualityIssue: string | null;
  objectKind: ObjectKind;
  description: string;
  visibleText: string[];
  inscriptions: string[];
  hypotheses: VisionHypothesis[];
  searchQueries: string[];
}

export interface CandidateSignals {
  model: number;
  text: number | null;
  visual: number | null;
  sourcesFound: number;
}

export interface Candidate {
  key: string;
  title: string;
  artist: string;
  date: string | null;
  confidence: number;
  confidenceLabel: 'élevée' | 'moyenne' | 'faible';
  verified: boolean; // au moins une notice concordante dans une base, ou le cartel lu sur la photo
  labelConfirmed?: boolean; // titre et artiste lus sur le cartel visible sur la photo
  signals: CandidateSignals;
  reasoning: string;
  distinguishing: string;
  records: SourceRecord[];
  imageUrl?: string;
}

export type IdentifyStatus = 'identified' | 'ambiguous' | 'uncertain' | 'not_artwork' | 'unusable_image';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  model: string;
}

export interface IdentifyResponse {
  analysisId: string;
  status: IdentifyStatus;
  vision: VisionAnalysis;
  candidates: Candidate[];
  provider: string;
  demo: boolean;
  cached: boolean;
  usage?: UsageInfo;
  warnings: string[];
}

export interface LabelFields {
  title: string | null;
  artist: string | null;
  artistDates: string | null;
  date: string | null;
  medium: string | null;
  dimensions: string | null;
  inventory: string | null;
  institution: string | null;
  creditLine: string | null;
  description: string | null;
  rawText: string;
}

export interface LabelResponse {
  fields: LabelFields;
  provider: string;
  demo: boolean;
  usage?: UsageInfo;
  warnings: string[];
}

/**
 * fait : documenté par une source (cartel ou notice) ;
 * observation : visible sur la photo du visiteur ;
 * interpretation : lecture ou savoir général non tiré des sources ;
 * hypothese : incertain ou débattu.
 */
export type ClaimKind = 'fait' | 'observation' | 'interpretation' | 'hypothese';

export interface Claim {
  text: string;
  kind: ClaimKind;
  sources: string[]; // identifiants de SourceRecord
  unsourced?: boolean; // le modèle a affirmé un fait sans source : rétrogradé
}

export type SectionId =
  | 'resume'
  | 'contexte'
  | 'analyse'
  | 'technique'
  | 'iconographie'
  | 'demarche'
  | 'provenance'
  | 'localisation'
  | 'cartel'
  | 'inscriptions';

export interface EntrySection {
  id: SectionId;
  title: string;
  claims: Claim[];
}

export interface Comparable {
  title: string;
  artist?: string;
  date?: string;
  url: string;
  imageUrl?: string;
  sourceId: string;
}

export interface ArtworkEntry {
  key: string;
  title: string;
  artist: string;
  date: string | null;
  objectKind: ObjectKind;
  movement: string | null;
  /** Nationalité et dates de l'artiste, en français (« japonais, 1760-1849 »). */
  artistLine?: string | null;
  technique: string | null;
  dimensions: string | null;
  institution: string | null;
  location: string | null;
  inventory: string | null;
  imageUrl?: string;
  imageCredit?: string;
  sections: EntrySection[];
  sources: SourceRecord[];
  comparables: Comparable[];
  provider: string;
  model: string | null;
  demo: boolean;
  aiWritten: boolean;
  generatedAt: string;
  usage?: UsageInfo;
  warnings: string[];
  /** Fiche partagée : identifiant de l'œuvre et statut de validation par l'administrateur. */
  verification?: { workId: string; status: WorkStatus; reused: boolean };
}

export type WorkStatus = 'provisoire' | 'validee' | 'rejetee';

export interface WorkSummary {
  workId: string;
  status: WorkStatus;
  title: string;
  artist: string;
  imageUrl?: string;
  uses: number;
  reports: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntryRequest {
  candidate: Pick<Candidate, 'key' | 'title' | 'artist' | 'date' | 'records'>;
  vision?: Pick<VisionAnalysis, 'objectKind' | 'description' | 'visibleText' | 'inscriptions'>;
  /** Cartel lu sur place (photo du cartel validée, ou cartel visible sur la photo de l'œuvre). Il fait foi. */
  label?: Partial<LabelFields>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  entry: ArtworkEntry;
  messages: ChatMessage[];
}

export interface ServerConfig {
  provider: string;
  demo: boolean;
  models: { vision: string | null; text: string | null; chat: string | null };
  sources: { id: SourceId; label: string; enabled: boolean; note?: string }[];
  accessCodeRequired: boolean;
  storage: 'postgres' | 'memoire';
  limits: { perMinute: number; dailyBudgetUsd: number; spentTodayUsd: number };
  costPerScanUsd: { low: number; high: number } | null;
}

export interface MapPlace {
  id: string;
  name: string;
  kind: 'musee' | 'oeuvre_publique';
  lat: number;
  lon: number;
  url: string;
  website?: string;
  description?: string;
}
