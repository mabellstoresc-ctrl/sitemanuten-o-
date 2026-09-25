import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, StatusBadge, Field, Select } from '../../components/ui.jsx';
import { PageHead } from '../../components/common.jsx';
import { fmtCpf, fmtDate } from '../../lib/format.js';
import { DRIVER_STATUS } from '../../../shared/constants.js';

export function CnhBadge({ date, days }) {
  if (!date) return <span className="muted">—</span>;
  const tone = days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok';
  const text = days < 0 ? `vencida há ${-days}d` : days === 0 ? 'vence hoje' : days <= 60 ? `${days} dias` : null;
  return (
    <span className="nowrap">
      {fmtDate(date)} {text && <span className={`badge ${tone}`}>{text}</span>}
    </span>
  );
}

export default function DriverList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const status = params.get('status') || '';
  const cnh = params.get('cnh') || '';
  const inativos = params.get('inativos') === '1';
  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const { data, loading, error, reload } = useFetch(`/drivers${qs({ q: params.get('q'), status, cnh, inativos: inativos ? '1' : '' })}`);

  return (
    <>
      <PageHead title="Motoristas" code="201" sub="Motoristas são apenas cadastrados — não têm acesso ao sistema.">
        {can('motoristas', 'cadastrar') && (
          <Link to="/motoristas/novo" className="btn primary">
            <Plus size={16} /> Novo motorista
          </Link>
        )}
      </PageHead>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', q.trim());
        }}
      >
        <Field label="Buscar" className="grow">
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParam('q', q.trim())} placeholder="Nome, CPF, CNH ou placa…" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(v) => setParam('status', v)} options={DRIVER_STATUS} placeholder="Todos (ativos)" />
        </Field>
        <Field label="CNH">
          <Select value={cnh} onChange={(v) => setParam('cnh', v)} options={[{ key: 'vencendo', label: 'Vencendo em 30 dias / vencidas' }]} placeholder="Todas" />
        </Field>
        <label className="check" style={{ height: 34 }}>
          <input type="checkbox" checked={inativos} onChange={(e) => setParam('inativos', e.target.checked ? '1' : '')} /> Incluir inativos
        </label>
      </form>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.drivers}
          onRowClick={(d) => navigate(`/motoristas/${d.id}`)}
          columns={[
            { key: 'full_name', label: 'Nome', mobile: 'title', render: (d) => <strong>{d.full_name}</strong> },
            { key: 'cpf', label: 'CPF', className: 'nowrap', render: (d) => fmtCpf(d.cpf) },
            { key: 'cnh_category', label: 'Cat.', render: (d) => d.cnh_category || '—' },
            { key: 'cnh_expiry', label: 'Validade CNH', render: (d) => <CnhBadge date={d.cnh_expiry} days={d.cnh_days_left} /> },
            { key: 'phone', label: 'Telefone', render: (d) => d.phone || '—' },
            { key: 'vehicle_plate', label: 'Veículo atual', render: (d) => (d.vehicle_plate ? <span className="plate">{d.vehicle_plate}</span> : <span className="muted">—</span>) },
            { key: 'status', label: 'Status', render: (d) => <StatusBadge list={DRIVER_STATUS} value={d.status} /> },
          ]}
          empty="Nenhum motorista encontrado."
        />
      )}
    </>
  );
}
