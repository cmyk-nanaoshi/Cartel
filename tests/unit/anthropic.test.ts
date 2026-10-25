// Vérifie la forme exacte des requêtes envoyées à l'API Claude et le traitement des réponses,
// à l'aide d'un fetch simulé (aucune clé réelle n'est utilisée).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../server/ai/anthropic';
import { identifySchema } from '../../server/ai/schemas';

afterEach(() => vi.unstubAllGlobals());

const models = { vision: 'claude-sonnet-5-5', text: 'claude-sonnet-5-5', chat: 'claude-haiku-5-5', label: 'claude-haiku-5-5' };

describe('AnthropicProvider', () => {
  it('envoie une requête structurée conforme et lit la réponse JSON', async () => {
    let sent: any;
    let headers: any;
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      sent = JSON.parse(init.body);
      headers = init.headers;
      return new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 2000, output_tokens: 500 }
        })
      );
    });
    const p = new AnthropicProvider('sk-test', 'https://api.anthropic.com', models);
    const r = await p.json<{ ok: boolean }>({
      task: 'identify',
      system: 'sys',
      content: [{ type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' }, { type: 'text', text: 'go' }],
      schema: identifySchema,
      maxTokens: 6000,
      effort: 'medium'
    });
    expect(r.data.ok).toBe(true);
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.output_config).toEqual({ format: { type: 'json_schema', schema: identifySchema }, effort: 'medium' });
    expect(sent.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    // Paramètres refusés par Sonnet 5.5 : jamais envoyés
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('tool_choice');
    expect(sent).not.toHaveProperty('thinking');
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(r.usage.estimatedCostUsd).toBeCloseTo((2000 * 2 + 500 * 10) / 1e6, 8);
  });

  it('respecte les contraintes de schéma des sorties structurées', () => {
    const walk = (s: any) => {
      if (s?.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
      }
      for (const k of ['minLength', 'maxLength', 'minimum', 'maximum']) expect(s?.[k]).toBeUndefined();
      Object.values(s ?? {}).forEach((v) => typeof v === 'object' && walk(v));
    };
    walk(identifySchema);
  });

  it('traduit les erreurs en messages utiles', async () => {
    const p = new AnthropicProvider('bad', 'https://api.anthropic.com', models);
    const req = { task: 'label' as const, system: '', content: [], schema: {}, maxTokens: 10 };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
    await expect(p.json(req)).rejects.toMatchObject({ code: 'auth' });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }));
    await expect(p.json(req)).rejects.toMatchObject({ code: 'quota', status: 429 });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Your credit balance is too low' } }), { status: 400 }));
    await expect(p.json(req)).rejects.toMatchObject({ code: 'quota', status: 402 });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [], usage: {} })));
    await expect(p.json(req)).rejects.toMatchObject({ code: 'refusal' });
  });

  it('lit un flux SSE et ignore les blocs de réflexion', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 900 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Une ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'réponse.' } },
      { type: 'message_delta', usage: { output_tokens: 42 } },
      { type: 'message_stop' }
    ];
    const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    let sent: any;
    vi.stubGlobal('fetch', async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      // Découpage arbitraire pour tester la reconstruction des événements
      const enc = new TextEncoder().encode(body);
      return new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < enc.length; i += 37) c.enqueue(enc.slice(i, i + 37));
            c.close();
          }
        })
      );
    });
    const p = new AnthropicProvider('k', 'https://api.anthropic.com', models);
    let out = '';
    const usage = await p.stream({ system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 }, (t) => (out += t));
    expect(out).toBe('Une réponse.');
    expect(usage).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 900, outputTokens: 42 });
    expect(sent.stream).toBe(true);
  });
});
