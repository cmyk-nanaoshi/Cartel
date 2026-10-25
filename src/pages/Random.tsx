import { useEffect, useState } from 'react';
import type { SourceRecord } from '../../shared/types';
import { api } from '../lib/api';
import { BackLink, Notice } from '../components/ui';
import { RecordGrid } from './Search';
import { t } from '../i18n';

export function Random() {
  const [records, setRecords] = useState<SourceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.discover();
      setRecords(r.records);
      if (r.error) setError(r.error);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="page">
      <BackLink />
      <header className="pagehead">
        <h1 className="t-display">{t('random.title')}</h1>
        <button className="btn btn-ghost btn-small" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : null} Tirer d’autres œuvres
        </button>
      </header>
      <p className="t-small t-muted" style={{ marginBottom: 24 }}>
        Douze œuvres tirées au hasard dans le domaine public de l’Art Institute of Chicago.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {records && <RecordGrid records={records} />}
    </main>
  );
}
