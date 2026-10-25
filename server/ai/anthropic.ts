import type { UsageInfo } from '../../shared/types.js';
import { estimateCost } from '../lib/cost.js';
import { AIError, modelFor, type AIProvider, type ContentPart, type JsonRequest, type StreamRequest } from './types.js';

// Appels directs à l'API Messages d'Anthropic (https://platform.claude.com/docs/en/api/messages/create).
// Pas de SDK : un simple fetch, pour garder le fournisseur facilement remplaçable.
// Notes Claude Sonnet 5.5 / Haiku 5.5 :
//  - la réflexion adaptative est active par défaut ; on règle sa profondeur avec output_config.effort ;
//  - temperature/top_p renvoient une erreur 400 sur Sonnet 5.5, on ne les envoie donc pas ;
//  - les sorties JSON passent par output_config.format (structured outputs), sans en-tête bêta.

const VERSION = '2023-06-01';

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';
  demo = false;

  constructor(
    private apiKey: string,
    private baseUrl: string,
    public models: { vision: string; text: string; chat: string; label: string }
  ) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante');
  }

  private toBlocks(content: ContentPart[]) {
    return content.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } }
    );
  }

  private async post(body: unknown, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': VERSION
        },
        body: JSON.stringify(body)
      });
    } catch (e: any) {
      throw new AIError(`Connexion à l’API Claude impossible : ${e?.message ?? e}`, 502, 'network');
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j: any = await res.json();
        detail = j?.error?.message ?? '';
      } catch {
        /* corps non JSON */
      }
      if (res.status === 401 || res.status === 403)
        throw new AIError('Clé API Anthropic refusée. Vérifiez ANTHROPIC_API_KEY.', 502, 'auth');
      if (res.status === 429) throw new AIError('Limite de débit de l’API Claude atteinte. Réessayez dans un instant.', 429, 'quota');
      if (res.status === 529 || res.status === 503)
        throw new AIError('L’API Claude est momentanément surchargée.', 503, 'overloaded');
      if (res.status === 400 && /credit|billing|balance/i.test(detail))
        throw new AIError('Crédit API épuisé sur le compte Anthropic.', 402, 'quota');
      throw new AIError(`Erreur de l’API Claude (${res.status}) ${detail}`.trim(), 502);
    }
    return res;
  }

  async json<T>(req: JsonRequest): Promise<{ data: T; usage: UsageInfo }> {
    const model = modelFor(this, req.task);
    const res = await this.post({
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: this.toBlocks(req.content) }],
      output_config: {
        format: { type: 'json_schema', schema: req.schema },
        ...(req.effort ? { effort: req.effort } : {})
      }
    });
    const msg: any = await res.json();
    const usage = this.usage(model, msg?.usage);
    if (msg?.stop_reason === 'refusal')
      throw new AIError('Le modèle a refusé d’analyser cette image.', 422, 'refusal');
    if (msg?.stop_reason === 'max_tokens')
      throw new AIError('Réponse tronquée (limite de longueur atteinte).', 502, 'invalid_output');
    const text = (msg?.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    try {
      return { data: JSON.parse(text) as T, usage };
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
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: { effort: 'low' },
        stream: true
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
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        let ev: any;
        try {
          ev = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        if (ev.type === 'message_start') input = ev.message?.usage?.input_tokens ?? 0;
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onDelta(ev.delta.text);
        else if (ev.type === 'message_delta') output = ev.usage?.output_tokens ?? output;
        else if (ev.type === 'error') throw new AIError(ev.error?.message ?? 'Erreur de flux', 502);
      }
    }
    return { model, inputTokens: input, outputTokens: output, estimatedCostUsd: estimateCost(model, input, output) };
  }

  private usage(model: string, u: any): UsageInfo {
    const input = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
    const output = u?.output_tokens ?? 0;
    return { model, inputTokens: input, outputTokens: output, estimatedCostUsd: estimateCost(model, input, output) };
  }
}
