import { useSyncExternalStore } from 'react';
import type { IdentifyResponse, LabelFields } from '../../shared/types';

// État de la session de scan en cours (en mémoire). Les fiches générées, elles, sont mises en cache dans IndexedDB.

export interface ScanState {
  mode: 'artwork' | 'label';
  photo?: Blob; // version envoyée (1568 px)
  thumb?: Blob; // version conservée (640 px)
  photoHash?: string;
  labelPhoto?: Blob; // photo du cartel
  response?: IdentifyResponse;
  label?: LabelFields;
  labelSource?: 'ia' | 'ocr-local';
  geo?: { lat: number; lon: number; accuracy?: number };
}

let state: ScanState = { mode: 'artwork' };
const listeners = new Set<() => void>();

export const session = {
  get: () => state,
  set(patch: Partial<ScanState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  reset(mode: ScanState['mode'] = 'artwork') {
    state = { mode };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  }
};

export function useSession() {
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}
