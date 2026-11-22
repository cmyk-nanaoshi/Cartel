import { useEffect, useState } from 'react';
import type { SourceRecord } from '../../shared/types';
import { api } from '../lib/api';
import { Notice } from '../components/ui';
import { TopBar } from '../components/Chrome';
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
    <main>
      <TopBar back="Rechercher" backTo="/recherche" menu={false} />
      <div className="page" style={{ paddingTop: 8 }}>
        <h1 className="t-display">{t('random.title')}</h1>
        <p className="t-small t-muted" style={{ marginTop: 4 }}>
          Douze œuvres du domaine public, tirées au hasard.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 16, marginBottom: 24 }} onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : null} Tirer d’autres œuvres
        </button>
        {error && <Notice kind="error">{error}</Notice>}
        {records && <RecordGrid records={records} />}
      </div>
    </main>
  );
}
