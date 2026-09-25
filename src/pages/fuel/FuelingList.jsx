import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Download } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, useToast } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDateTime, fmtNum, fmtMoney, todayISO } from '../../lib/format.js';
import { FUELING_TYPES, TOWED_TYPES, labelOf } from '../../../shared/constants.js';

export function KmlBadge({ f }) {
  if (!f.km_per_liter) return <span className="muted">{f.full_tank ? '—' : 'parcial'}</span>;
  return (
    <span className="nowrap">
      <strong>{fmtNum(f.km_per_liter, 2)}</strong>
      {f.out_of_pattern && (
        <span className={`badge ${f.deviation < 0 ? 'danger' : 'warn'}`} style={{ marginLeft: 6 }} title={`${f.deviation > 0 ? '+' : ''}${fmtNum(f.deviation, 1)}% da média do veículo`}>
          {f.deviation > 0 ? '+' : ''}
          {fmtNum(f.deviation, 0)}%
        </span>
      )}
    </span>
  );
}

export function FuelingsTable({ rows, showVehicle = true, showDriver = true }) {
  const navigate = useNavigate();
  return (
    <DataTable
      dense
      rows={rows}
      onRowClick={(f) => navigate(`/abastecimentos/${f.id}`)}
      columns={[
        { key: 'fueled_at', label: 'Data', mobile: 'title', className: 'nowrap', render: (f) => (
          <span style={{ textDecoration: f.status === 'cancelado' ? 'line-through' : undefined }}>{fmtDateTime(f.fueled_at)}</span>
        ) },
        showVehicle && { key: 'plate', label: 'Veículo', render: (f) => <span className="plate">{f.plate}</span> },
        showDriver && { key: 'driver_name', label: 'Motorista', render: (f) => f.driver_name || '—' },
        { key: 'km', label: 'KM', className: 'right num nowrap', render: (f) => fmtNum(f.km) },
        { key: 'distance', label: 'Rodados', className: 'right num', render: (f) => (f.distance != null ? fmtNum(f.distance) : '—') },
        { key: 'fuel_type', label: 'Comb.', render: (f) => labelOf(FUELING_TYPES, f.fuel_type) },
        { key: 'liters', label: 'Litros', className: 'right num', render: (f) => fmtNum(f.liters, 2) },
        { key: 'price_per_liter', label: 'R$/L', className: 'right num', render: (f) => fmtNum(f.price_per_liter, 3) },
        { key: 'total', label: 'Total', className: 'right num nowrap', render: (f) => fmtMoney(f.total) },
        { key: 'km_per_liter', label: 'Média km/L', className: 'right num', render: (f) => <KmlBadge f={f} /> },
        { key: 'station', label: 'Posto', mobile: false, render: (f) => f.station || '—' },
        { key: 'order_number', label: 'Ordem', render: (f) => (f.order_number ? `Nº ${f.order_number}` : f.order_ref || '—') },
        { key: 'status', label: '', noSort: true, render: (f) => (f.status === 'cancelado' ? <span className="badge off">Cancelado</span> : null) },
      ].filter(Boolean)}
      empty="Nenhum abastecimento no período."
    />
  );
}

export function FuelTotals({ totals }) {
  if (!totals) return null;
  return (
    <div className="kpis" style={{ marginBottom: 10 }}>
      <div className="kpi">
        <div className="label">Abastecimentos</div>
        <div className="value">{totals.fuelings}</div>
      </div>
      <div className="kpi">
        <div className="label">Litros</div>
        <div className="value">{fmtNum(totals.liters, 0)}</div>
      </div>
      <div className="kpi">
        <div className="label">Valor total</div>
        <div className="value" style={{ fontSize: 20 }}>{fmtMoney(totals.total)}</div>
      </div>
      <div className="kpi info">
        <div className="label">Média km/L</div>
        <div className="value">{totals.km_per_liter ? fmtNum(totals.km_per_liter, 2) : '—'}</div>
      </div>
      <div className="kpi">
        <div className="label">Custo por km</div>
        <div className="value" style={{ fontSize: 20 }}>{totals.cost_per_km ? fmtMoney(totals.cost_per_km) : '—'}</div>
      </div>
      <div className="kpi">
        <div className="label">KM (ciclos de tanque cheio)</div>
        <div className="value" style={{ fontSize: 20 }}>{fmtNum(totals.distance)}</div>
      </div>
    </div>
  );
}

function monthStart() {
  const t = todayISO();
  return `${t.slice(0, 8)}01`;
}

export default function FuelingList() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const f = {
    vehicle_id: params.get('veiculo') || '',
    driver_id: params.get('motorista') || '',
    from: params.get('de') ?? monthStart(),
    to: params.get('ate') || '',
    fuel_type: params.get('comb') || '',
    station: params.get('posto') || '',
    status: params.get('status') || '',
    fora_padrao: params.get('fora') || '',
  };
  const map = { vehicle_id: 'veiculo', driver_id: 'motorista', from: 'de', to: 'ate', fuel_type: 'comb', station: 'posto', status: 'status', fora_padrao: 'fora' };
  const setF = (k) => (val) => {
    const value = val && val.target ? (val.target.type === 'checkbox' ? (val.target.checked ? '1' : '') : val.target.value) : val || '';
    const next = new URLSearchParams(params);
    if (value || k === 'from') next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  const query = qs(f);
  const { data, loading, error, reload } = useFetch(`/fuelings${query}`);
  const vehicles = useFetch('/vehicles/options?all=1');
  const drivers = useFetch('/drivers/options?all=1');

  return (
    <Guard module="abastecimentos">
      <PageHead title="Abastecimentos" code="303">
        {can('abastecimentos', 'exportar') && (
          <button type="button" className="btn" onClick={() => downloadFile(`/fuelings/export${query}`, 'abastecimentos.csv').catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Exportar (Excel/CSV)
          </button>
        )}
        {can('abastecimentos', 'cadastrar') && (
          <Link to="/abastecimentos/novo" className="btn primary">
            <Plus size={16} /> Novo abastecimento
          </Link>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Veículo">
          <Select
            value={f.vehicle_id}
            onChange={setF('vehicle_id')}
            options={(vehicles.data?.vehicles || []).filter((v) => !TOWED_TYPES.includes(v.type)).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · ${v.fleet_number}` : ''}` }))}
            placeholder="Todos"
          />
        </Field>
        <Field label="Motorista">
          <Select value={f.driver_id} onChange={setF('driver_id')} options={(drivers.data?.drivers || []).map((d) => ({ key: d.id, label: d.full_name }))} placeholder="Todos" />
        </Field>
        <Field label="De">
          <input type="date" value={f.from} onChange={setF('from')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={setF('to')} />
        </Field>
        <Field label="Combustível">
          <Select value={f.fuel_type} onChange={setF('fuel_type')} options={FUELING_TYPES} placeholder="Todos" />
        </Field>
        <Field label="Posto">
          <input value={f.station} onChange={setF('station')} placeholder="Nome do posto" />
        </Field>
        <Field label="Situação">
          <Select value={f.status} onChange={setF('status')} options={[{ key: 'cancelado', label: 'Cancelados' }, { key: 'todos', label: 'Todos' }]} placeholder="Válidos" />
        </Field>
        <label className="check" style={{ height: 34 }}>
          <input type="checkbox" checked={f.fora_padrao === '1'} onChange={setF('fora_padrao')} /> Só consumo fora do padrão
        </label>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          <FuelTotals totals={data.totals} />
          {data.truncated && <div className="notice warn" style={{ marginBottom: 10 }}>Mostrando os 500 mais recentes. Use os filtros ou exporte para ver todos.</div>}
          <FuelingsTable rows={data.fuelings} />
          <p className="muted small">
            A média é calculada entre tanques cheios: KM rodados desde o tanque cheio anterior ÷ litros abastecidos no período. Consumo mais de 20% acima ou abaixo da média do veículo é
            destacado.
          </p>
        </>
      )}
    </Guard>
  );
}
