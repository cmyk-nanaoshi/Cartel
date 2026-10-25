import type { UsageInfo } from '../../shared/types.js';
import { estimateCost } from '../lib/cost.js';
import { AIError, modelFor, type AIProvider, type ContentPart, type JsonRequest, type StreamRequest } from './types.js';

// Fournisseur alternatif : toute API compatible « OpenAI Chat Completions » (OpenAI, Mistral, OpenRouter, etc.).
// Il illustre la séparation fournisseur / application. Il n'a pas été testé contre un service réel.

export class OpenAICompatibleProvider implements AIProvider {
  name = 'openai';
  demo = false;

  constructor(
    private apiKey: string,
    private baseUrl: string,
    public models: { vision: string; text: string; chat: string; label: string }
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY manquante');
  }

  private parts(content: ContentPart[]) {
    return content.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}` } }
    );
  }

  private async post(body: unknown, signal?: AbortSignal) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    }).catch((e) => {
      throw new AIError(`Connexion impossible : ${e?.message ?? e}`, 502, 'network');
    });
    if (!res.ok) {
      if (res.status === 401) throw new AIError('Clé API refusée.', 502, 'auth');
      if (res.status === 429) throw new AIError('Quota du fournisseur atteint.', 429, 'quota');
      throw new AIError(`Erreur du fournisseur (${res.status})`, 502);
    }
    return res;
  }

  async json<T>(req: JsonRequest): Promise<{ data: T; usage: UsageInfo }> {
    const model = modelFor(this, req.task);
    const res = await this.post({
      model,
      max_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: this.parts(req.content) }
      ],
      response_format: { type: 'json_schema', json_schema: { name: req.task, strict: true, schema: req.schema } }
    });
    const j: any = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '';
    const input = j?.usage?.prompt_tokens ?? 0;
    const output = j?.usage?.completion_tokens ?? 0;
    try {
      return {
        data: JSON.parse(text),
        usage: { model, inputTokens: input, outputTokens: output, estimatedCostUsd: estimateCost(model, input, output) }
      };
    } catch {
      throw new AIError('Réponse du modèle illisible (JSON invalide).', 502, 'invalid_output');
    }
  }

  async stream(req: StreamRequest, onDelta: (t: string) => void, signal?: AbortSignal): Promise<UsageInfo> {
    const model = this.models.chat;
    const res = await this.post(
      {
        model,
        max_tokens: req.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: req.system }, ...req.messages]
      },
      signal
    );
    let input = 0;
    let output = 0;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const ev = JSON.parse(data);
          const d = ev?.choices?.[0]?.delta?.content;
          if (d) onDelta(d);
          if (ev?.usage) {
            input = ev.usage.prompt_tokens ?? input;
            output = ev.usage.completion_tokens ?? output;
          }
        } catch {
          /* ligne partielle */
        }
      }
    }
    return { model, inputTokens: input, outputTokens: output, estimatedCostUsd: estimateCost(model, input, output) };
  }
}
