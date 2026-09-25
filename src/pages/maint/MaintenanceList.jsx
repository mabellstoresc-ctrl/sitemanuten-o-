import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Download } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, useToast } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDate, fmtKm, fmtNum, fmtMoney } from '../../lib/format.js';
import { MAINTENANCE_TYPES, MAINTENANCE_CATEGORIES, labelOf } from '../../../shared/constants.js';

export const catText = (cats) => cats.map((c) => labelOf(MAINTENANCE_CATEGORIES, c)).join(', ');

export function PlanState({ state }) {
  const map = { vencida: ['danger', 'Vencida'], proxima: ['warn', 'Próxima'], ok: ['ok', 'Em dia'], sem_registro: ['muted', 'Sem registro'], sem_proxima: ['muted', 'Sem próxima'] };
  const [tone, label] = map[state] || ['muted', state];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function PlanDue({ p }) {
  const bits = [];
  if (p.next_km !== null && p.next_km !== undefined) {
    bits.push(
      <div key="km">
        {fmtKm(p.next_km)}{' '}
        <span className={`small ${p.km_left <= 0 ? 'state-vencida' : 'muted'}`}>
          ({p.km_left <= 0 ? `passou ${fmtNum(-p.km_left)} km` : `faltam ${fmtNum(p.km_left)} km`})
        </span>
      </div>,
    );
  }
  if (p.next_date) {
    bits.push(
      <div key="d">
        {fmtDate(p.next_date)}{' '}
        <span className={`small ${p.days_left < 0 ? 'state-vencida' : 'muted'}`}>
          ({p.days_left < 0 ? `venceu há ${-p.days_left} d` : p.days_left === 0 ? 'hoje' : `em ${p.days_left} d`})
        </span>
      </div>,
    );
  }
  return <>{bits.length ? bits : '—'}</>;
}

/** Tabela de próximas manutenções. */
export function PlansTable({ plans, showVehicle = true }) {
  const navigate = useNavigate();
  return (
    <DataTable
      rowKey="maintenance_id"
      rows={plans}
      onRowClick={(p) => navigate(`/manutencao/${p.maintenance_id}`)}
      columns={[
        showVehicle && { key: 'plate', label: 'Veículo', mobile: 'title', render: (p) => <span className="plate">{p.plate}</span> },
        { key: 'categories', label: 'Itens', mobile: showVehicle ? undefined : 'title', noSort: true, render: (p) => catText(p.categories) },
        { key: 'performed_on', label: 'Última', render: (p) => `${fmtDate(p.performed_on)}${p.km ? ` · ${fmtKm(p.km)}` : ''}` },
        { key: 'due', label: 'Próxima', noSort: true, render: (p) => <PlanDue p={p} /> },
        { key: 'estimated_date', label: 'Previsão pelo KM', render: (p) => (p.estimated_date ? `${fmtDate(p.estimated_date)}` : '—') },
        { key: 'state', label: 'Situação', sort: (p) => ({ vencida: 0, proxima: 1, ok: 2 })[p.state], render: (p) => <PlanState state={p.state} /> },
      ].filter(Boolean)}
      empty="Nenhuma próxima manutenção programada."
    />
  );
}

export function MaintenancesTable({ rows, showVehicle = true }) {
  const navigate = useNavigate();
  return (
    <DataTable
      dense
      rows={rows}
      onRowClick={(m) => navigate(`/manutencao/${m.id}`)}
      columns={[
        { key: 'performed_on', label: 'Data', mobile: 'title', render: (m) => <span style={{ textDecoration: m.status === 'cancelado' ? 'line-through' : undefined }}>{fmtDate(m.performed_on)}</span> },
        showVehicle && { key: 'plate', label: 'Veículo', render: (m) => <span className="plate">{m.plate}</span> },
        { key: 'type', label: 'Tipo', render: (m) => <span className={`badge ${m.type === 'preventiva' ? 'info' : 'warn'}`}>{labelOf(MAINTENANCE_TYPES, m.type)}</span> },
        { key: 'categories', label: 'Categorias', noSort: true, className: 'wrap', render: (m) => catText(m.categories) },
        { key: 'km', label: 'KM', className: 'right num', render: (m) => (m.km ? fmtNum(m.km) : '—') },
        { key: 'workshop', label: 'Oficina', render: (m) => m.workshop || '—' },
        { key: 'total', label: 'Total', className: 'right num', render: (m) => fmtMoney(m.total) },
        { key: 'next', label: 'Próxima', noSort: true, render: (m) => [m.next_km && fmtKm(m.next_km), m.next_date && fmtDate(m.next_date)].filter(Boolean).join(' / ') || '—' },
        { key: 'service_order_number', label: 'OS', render: (m) => (m.service_order_number ? `Nº ${m.service_order_number}` : '—') },
        { key: 'status', label: '', noSort: true, render: (m) => (m.status === 'cancelado' ? <span className="badge off">Cancelada</span> : null) },
      ].filter(Boolean)}
      empty="Nenhuma manutenção encontrada."
    />
  );
}

export default function MaintenanceList({ type }) {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const f = {
    type,
    vehicle_id: params.get('veiculo') || '',
    category: params.get('categoria') || '',
    from: params.get('de') || '',
    to: params.get('ate') || '',
    workshop: params.get('oficina') || '',
    status: params.get('status') || '',
  };
  const map = { vehicle_id: 'veiculo', category: 'categoria', from: 'de', to: 'ate', workshop: 'oficina', status: 'status' };
  const setF = (k) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    if (value) next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  const query = qs(f);
  const { data, loading, error, reload } = useFetch(`/maintenances${query}`);
  const plans = useFetch(type === 'preventiva' ? `/maintenance/plans${qs({ vehicle_id: f.vehicle_id })}` : null, [f.vehicle_id]);
  const vehicles = useFetch('/vehicles/options?all=1');
  const pending = (plans.data?.plans || []).filter((p) => p.state !== 'ok');

  return (
    <Guard module="manutencoes">
      <PageHead title={type === 'preventiva' ? 'Manutenções preventivas' : 'Manutenções corretivas'} code={type === 'preventiva' ? '402' : '403'}>
        {can('manutencoes', 'exportar') && (
          <button type="button" className="btn" onClick={() => downloadFile(`/maintenances/export${query}`, 'manutencoes.csv').catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Exportar
          </button>
        )}
        {can('manutencoes', 'cadastrar') && (
          <>
            <Link to={`/manutencao/os?nova=1&tipo=${type}`} className="btn">
              <Plus size={15} /> Abrir OS
            </Link>
            <Link to={`/manutencao/nova?tipo=${type}${f.vehicle_id ? `&veiculo=${f.vehicle_id}` : ''}`} className="btn primary">
              <Plus size={16} /> Registrar manutenção
            </Link>
          </>
        )}
      </PageHead>

      {type === 'preventiva' && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <h2>Próximas e vencidas</h2>
            <Link to="/manutencao/calendario" className="small">
              Ver calendário
            </Link>
          </div>
          {plans.loading && !plans.data ? <Loading /> : pending.length ? <PlansTable plans={pending} /> : <div className="empty">Nenhuma manutenção vencida ou próxima. 👍</div>}
        </div>
      )}

      <div className="filters">
        <Field label="Veículo">
          <Select value={f.vehicle_id} onChange={setF('vehicle_id')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }))} placeholder="Todos" />
        </Field>
        <Field label="Categoria">
          <Select value={f.category} onChange={setF('category')} options={MAINTENANCE_CATEGORIES} placeholder="Todas" />
        </Field>
        <Field label="De">
          <input type="date" value={f.from} onChange={setF('from')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={setF('to')} />
        </Field>
        <Field label="Oficina">
          <input value={f.workshop} onChange={setF('workshop')} />
        </Field>
        <Field label="Situação">
          <Select value={f.status} onChange={setF('status')} options={[{ key: 'cancelado', label: 'Canceladas' }, { key: 'todos', label: 'Todas' }]} placeholder="Válidas" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis" style={{ marginBottom: 10 }}>
            <div className="kpi">
              <div className="label">Manutenções</div>
              <div className="value">{data.totals.count}</div>
            </div>
            <div className="kpi">
              <div className="label">Peças</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtMoney(data.totals.parts)}</div>
            </div>
            <div className="kpi">
              <div className="label">Mão de obra</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtMoney(data.totals.labor)}</div>
            </div>
            <div className="kpi">
              <div className="label">Total</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtMoney(data.totals.total)}</div>
            </div>
          </div>
          <MaintenancesTable rows={data.maintenances} />
        </>
      )}
    </Guard>
  );
}
