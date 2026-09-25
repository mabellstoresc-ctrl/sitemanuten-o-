import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, StatusBadge, Field, Select } from '../../components/ui.jsx';
import { PageHead } from '../../components/common.jsx';
import { fmtKm } from '../../lib/format.js';
import { VEHICLE_TYPES, VEHICLE_STATUS, TOWED_TYPES, labelOf } from '../../../shared/constants.js';

export default function VehicleList({ group = 'frota' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const status = params.get('status') || '';
  const type = params.get('type') || '';
  const inativos = params.get('inativos') === '1';
  const towed = group === 'implementos';

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const { data, loading, error, reload } = useFetch(`/vehicles${qs({ group, status, type, q: params.get('q'), inativos: inativos ? '1' : '' })}`);

  const types = VEHICLE_TYPES.filter((t) => TOWED_TYPES.includes(t.key) === towed);

  const columns = [
    { key: 'plate', label: 'Placa', mobile: 'title', render: (v) => <span className="plate">{v.plate}</span> },
    { key: 'fleet_number', label: 'Frota', render: (v) => v.fleet_number || '—' },
    { key: 'type', label: 'Tipo', render: (v) => labelOf(VEHICLE_TYPES, v.type) },
    { key: 'model', label: 'Marca / modelo', render: (v) => [v.brand, v.model].filter(Boolean).join(' ') || '—' },
    { key: 'year_model', label: 'Ano', render: (v) => (v.year_manufacture ? `${v.year_manufacture}/${v.year_model || ''}` : '—') },
    towed
      ? { key: 'tractor', label: 'Engatado em', sort: (v) => v.tractor?.plate, render: (v) => (v.tractor ? <span className="plate">{v.tractor.plate}</span> : <span className="muted">—</span>) }
      : { key: 'driver_name', label: 'Motorista', render: (v) => v.driver_name || <span className="muted">—</span> },
    !towed && {
      key: 'trailers',
      label: 'Implementos',
      noSort: true,
      mobile: false,
      render: (v) => (v.trailers?.length ? v.trailers.map((t) => t.plate).join(', ') : <span className="muted">—</span>),
    },
    !towed && { key: 'current_km', label: 'KM atual', className: 'right num nowrap', render: (v) => fmtKm(v.current_km) },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge list={VEHICLE_STATUS} value={v.status} /> },
  ].filter(Boolean);

  return (
    <>
      <PageHead title={towed ? 'Implementos e carretas' : 'Veículos'} code={towed ? '103' : '101'}>
        {can('veiculos', 'cadastrar') && (
          <Link to={towed ? '/veiculos/novo?tipo=carreta' : '/veiculos/novo'} className="btn primary">
            <Plus size={16} /> {towed ? 'Novo implemento' : 'Novo veículo'}
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
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParam('q', q.trim())} placeholder="Placa, frota, modelo, motorista…" />
        </Field>
        <Field label="Tipo">
          <Select value={type} onChange={(v) => setParam('type', v)} options={types} placeholder="Todos" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(v) => setParam('status', v)} options={VEHICLE_STATUS} placeholder="Todos (ativos)" />
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
          columns={columns}
          rows={data.vehicles}
          onRowClick={(v) => navigate(`/veiculos/${v.id}`)}
          empty={towed ? 'Nenhum implemento cadastrado.' : 'Nenhum veículo encontrado.'}
        />
      )}
    </>
  );
}
