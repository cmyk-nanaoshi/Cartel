import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { ArtworkEntry, ChatMessage } from '../../shared/types';
import { db } from '../lib/db';
import { api } from '../lib/api';
import { BackLink, Icon, Notice } from '../components/ui';

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
      <main className="page">
        <BackLink />
        <p>Fiche introuvable. Ouvrez d’abord la fiche de l’œuvre.</p>
      </main>
    );

  return (
    <main className="chat">
      <header className="chat-head row-between">
        <div>
          <BackLink to={`/oeuvre/${encodeURIComponent(key)}`} label="Fiche" />
          <div className="t-small">
            <span className="artist">{entry.artist}</span>, <span className="work-title">{entry.title}</span>
          </div>
        </div>
        {messages.length > 0 && (
          <button className="linkbtn t-small" onClick={clear}>
            Effacer
          </button>
        )}
      </header>

      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="stack-16">
            <p className="t-muted measure">
              Posez une question sur cette œuvre. Les réponses s’appuient sur la fiche et ses {entry.sources.length} notice
              {entry.sources.length > 1 ? 's' : ''}, citées entre crochets, et signalent ce qui est incertain.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
            {m.content || (streaming && i === messages.length - 1 ? <span className="spinner" aria-label="Réponse en cours" /> : null)}
          </div>
        ))}
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
        <button className="btn" type="submit" disabled={streaming || !input.trim()} aria-label="Envoyer">
          <Icon name="send" size={20} />
        </button>
      </form>
    </main>
  );
}
