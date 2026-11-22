import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { ArtworkEntry, ChatMessage } from '../../shared/types';
import { db } from '../lib/db';
import { api } from '../lib/api';
import { Notice } from '../components/ui';
import { TopBar } from '../components/Chrome';

const SUGGESTIONS = [
  'Pourquoi cette œuvre est-elle importante ?',
  'Comment analyser sa composition ?',
  'Quelle technique a été utilisée ?',
  'Quelles influences peut-on identifier ?',
  'Comment s’inscrit-elle dans son mouvement ?',
  'Quels liens avec le design contemporain ?'
];

export function Chat() {
  const { key = '' } = useParams();
  const loc = useLocation();
  const [entry, setEntry] = useState<ArtworkEntry | null>((loc.state as any)?.entry ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      if (!entry) {
        const e = (await db.artworks.get(key))?.entry ?? (await db.entries.get(key))?.entry;
        if (e) setEntry(e);
      }
      const thread = await db.chats.get(key);
      if (thread) setMessages(thread.messages);
    })();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function ask(q: string) {
    if (!entry || !q.trim() || streaming) return;
    setError(null);
    const history: ChatMessage[] = [...messages, { role: 'user', content: q.trim() }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let answer = '';
    try {
      await api.chat(
        entry,
        history,
        (d) => {
          answer += d;
          setMessages([...history, { role: 'assistant', content: answer }]);
        },
        ctrl.signal
      );
      const final = [...history, { role: 'assistant' as const, content: answer }];
      await db.chats.put({ id: key, messages: final, updatedAt: Date.now() });
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e.message ?? 'Réponse impossible.');
      setMessages(answer ? [...history, { role: 'assistant', content: answer }] : history);
    } finally {
      setStreaming(false);
    }
  }

  async function clear() {
    await db.chats.delete(key);
    setMessages([]);
  }

  if (!entry)
    return (
      <main>
        <TopBar back="Retour" />
        <div className="page">
          <p>Fiche introuvable. Ouvrez d’abord la fiche de l’œuvre.</p>
        </div>
      </main>
    );

  return (
    <main className="chat">
      <div>
        <TopBar
          back="Fiche"
          backTo={`/oeuvre/${encodeURIComponent(key)}`}
          menu={false}
          right={
            messages.length > 0 ? (
              <button className="btn-discreet t-small" style={{ marginRight: 12 }} onClick={clear}>
                Effacer
              </button>
            ) : null
          }
        />
        <div style={{ padding: '0 var(--margin) 8px' }}>
          <h1 className="t-display">Questions sur l’œuvre</h1>
          <p className="t-small t-muted" style={{ marginTop: 4 }}>
            {entry.artist}, {entry.title}
          </p>
        </div>
      </div>

      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <div>
            <h2 className="rubric">Pour commencer</h2>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="t-small t-muted measure" style={{ marginTop: 24 }}>
              Les réponses s’appuient sur la fiche et ses sources. Ce qui n’en vient pas porte une étiquette, comme sur la fiche.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
            {m.content || (streaming && i === messages.length - 1 ? <span className="spinner" aria-label="Réponse en cours" /> : null)}
          </div>
        ))}
        {messages.length > 0 && !streaming && SUGGESTIONS.filter((q) => !messages.some((m) => m.content === q)).length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 className="rubric">Pour continuer</h2>
            <div className="suggestions">
              {SUGGESTIONS.filter((q) => !messages.some((m) => m.content === q))
                .slice(0, 2)
                .map((q) => (
                  <button key={q} className="chip" onClick={() => ask(q)}>
                    {q}
                  </button>
                ))}
            </div>
          </div>
        )}
        {error && (
          <div style={{ marginTop: 16 }}>
            <Notice kind="error">{error}</Notice>
          </div>
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label className="sr-only" htmlFor="q">
          Votre question
        </label>
        <textarea
          id="q"
          className="textarea"
          rows={1}
          value={input}
          placeholder={messages.length ? 'Approfondir…' : 'Votre question'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <button className="btn" type="submit" disabled={streaming || !input.trim()}>
          Envoyer
        </button>
      </form>
    </main>
  );
}
