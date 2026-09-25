import { useState } from 'react';
import { useFetch, Loading, ErrorBox, Select } from '../components/ui.jsx';
import { PageHead } from '../components/common.jsx';
import { AlertList } from './Dashboard.jsx';

const LEVELS = [
  { key: 'urgente', label: 'Urgente' },
  { key: 'atencao', label: 'Atenção' },
  { key: 'info', label: 'Informativo' },
];

export default function Alerts() {
  const { data, loading, error, reload } = useFetch('/alerts');
  const [level, setLevel] = useState('');
  const list = (data?.alerts || []).filter((a) => !level || a.level === level);
  const count = (l) => (data?.alerts || []).filter((a) => a.level === l).length;
  return (
    <>
      <PageHead title="Alertas" code="002" sub="Calculados automaticamente a partir dos dados cadastrados.">
        <Select value={level} onChange={(v) => setLevel(v || '')} options={LEVELS.map((l) => ({ ...l, label: `${l.label} (${count(l.key)})` }))} placeholder="Todos os níveis" className="input" style={{ width: 200 }} />
        <button type="button" className="btn" onClick={reload}>
          Atualizar
        </button>
      </PageHead>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="card">
          <AlertList alerts={list} />
        </div>
      )}
    </>
  );
}
