import type { ChatMessage, UsageInfo } from '../../shared/types.js';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; base64: string };

export type TaskName = 'identify' | 'label' | 'entry';

export interface JsonRequest {
  task: TaskName;
  system: string;
  content: ContentPart[];
  schema: Record<string, unknown>;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface StreamRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export class AIError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code: 'refusal' | 'quota' | 'auth' | 'overloaded' | 'invalid_output' | 'network' | 'other' = 'other'
  ) {
    super(message);
  }
}

/**
 * Contrat commun à tous les fournisseurs d'IA. Changer de fournisseur = écrire une classe
 * qui implémente cette interface ; le reste de l'application n'en dépend pas.
 */
export interface AIProvider {
  name: string;
  demo: boolean;
  models: { vision: string; text: string; chat: string; label: string };
  json<T>(req: JsonRequest): Promise<{ data: T; usage: UsageInfo }>;
  stream(req: StreamRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<UsageInfo>;
}

export function modelFor(p: AIProvider, task: TaskName) {
  return task === 'identify' ? p.models.vision : task === 'label' ? p.models.label : p.models.text;
}
