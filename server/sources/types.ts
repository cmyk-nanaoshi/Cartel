import type { SourceId, SourceRecord } from '../../shared/types.js';
import type { HttpOptions } from './http.js';

export interface SourceQuery {
  title?: string;
  artist?: string;
  text?: string; // recherche libre (mouvement, thème)
  limit?: number;
}

export interface SourceAdapter {
  id: SourceId;
  label: string;
  /** Conditions d'utilisation résumées, affichées dans les paramètres. */
  note: string;
  enabled: boolean;
  search(q: SourceQuery, http: HttpOptions): Promise<SourceRecord[]>;
}
