import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDate, fmtKm, fmtNum } from '../../lib/format.js';
import { PlanState, MaintenancesTable } from './MaintenanceList.jsx';

/** Faixa ÚLTIMA / PRÓXIMA / ATUAL / RESTAM de um veículo. */
export function OilStrip({ o }) {
  if (!o || !o.maintenance_id) return <div className="muted">Nenhuma troca de óleo registrada.</div>;
  const interval = o.next_km && o.last_km ? o.next_km - o.last_km : null;
  const used = interval ? Math.min(1, Math.max(0, (o.current_km - o.last_km) / interval)) : null;
  const color = o.state === 'vencida' ? 'var(--danger)' : o.state === 'proxima' ? '#f59e0b' : 'var(--ok)';
  return (
    <>
      <div className="oil-strip">
        <div>
          <div className="k">Última troca</div>
          <div className="v">{fmtKm(o.last_km)}</div>
          <div className="small muted">{fmtDate(o.performed_on)}</div>
        </div>
        <div>
          <div className="k">Próxima troca</div>
          <div className="v">{o.next_km ? fmtKm(o.next_km) : '—'}</div>
          <div className="small muted">{o.next_date ? `ou em ${fmtDate(o.next_date)}` : ''}</div>
        </div>
        <div>
          <div className="k">KM atual</div>
          <div className="v">{fmtKm(o.current_km)}</div>
        </div>
        <div>
          <div className="k">{o.km_left !== null && o.km_left < 0 ? 'Passou' : 'Restam'}</div>
          <div className="v" style={{ color }}>{o.km_left !== null ? fmtKm(Math.abs(o.km_left)) : '—'}</div>
          <PlanState state={o.state} />
        </div>
      </div>
      {used !== null && (
        <div className="meter" title={`${fmtNum(used * 100)}% do intervalo usado`}>
          <div style={{ width: `${used * 100}%`, background: color }} />
        </div>
      )}
      <div className="small muted" style={{ marginTop: 6 }}>
        {[o.oil_brand, o.oil_type, o.oil_spec, o.oil_quantity && `${fmtNum(o.oil_quantity, 1)} L`].filter(Boolean).join(' · ')}
        {o.oil_filter || o.fuel_filter || o.air_filter
          ? ` · Filtros: ${[o.oil_filter && 'óleo', o.fuel_filter && 'combustível', o.air_filter && 'ar'].filter(Boolean).join(', ')}`
          : ''}
      </div>
    </>
  );
}

export default function OilChanges() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/maintenance/oil');
  const history = useFetch(`/maintenances${qs({ category: 'troca_oleo', limit: 200 })}`);
  const order = { vencida: 0, proxima: 1, sem_registro: 2, sem_proxima: 3, ok: 4 };
  const rows = [...(data?.vehicles || [])].sort((a, b) => order[a.state] - order[b.state] || (a.km_left ?? 1e9) - (b.km_left ?? 1e9));
  return (
    <Guard anyOf={['manutencoes', 'veiculos']}>
      <PageHead title="Trocas de óleo" code="404">
        {can('manutencoes', 'cadastrar') && (
          <Link to="/manutencao/nova?oleo=1" className="btn primary">
            <Plus size={16} /> Registrar troca de óleo
          </Link>
        )}
      </PageHead>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rowKey="vehicle_id"
          rows={rows}
          onRowClick={(o) => navigate(`/veiculos/${o.vehicle_id}?aba=manutencoes`)}
          columns={[
            { key: 'plate', label: 'Veículo', mobile: 'title', render: (o) => <span className="plate">{o.plate}</span> },
            { key: 'fleet_number', label: 'Frota', render: (o) => o.fleet_number || '—' },
            { key: 'last_km', label: 'Última troca', render: (o) => (o.maintenance_id ? `${fmtKm(o.last_km)} · ${fmtDate(o.performed_on)}` : '—') },
            { key: 'next_km', label: 'Próxima troca', render: (o) => [o.next_km && fmtKm(o.next_km), o.next_date && fmtDate(o.next_date)].filter(Boolean).join(' ou ') || '—' },
            { key: 'current_km', label: 'KM atual', className: 'right num', render: (o) => fmtKm(o.current_km) },
            {
              key: 'km_left',
              label: 'KM restantes',
              className: 'right num',
              render: (o) =>
                o.km_left === null || o.km_left === undefined ? '—' : <span className={o.km_left <= 0 ? 'state-vencida' : o.state === 'proxima' ? 'state-proxima' : ''}>{fmtNum(o.km_left)}</span>,
            },
            { key: 'oil', label: 'Óleo', noSort: true, mobile: false, render: (o) => [o.oil_brand, o.oil_type].filter(Boolean).join(' ') || '—' },
            { key: 'state', label: 'Situação', sort: (o) => order[o.state], render: (o) => <PlanState state={o.state} /> },
          ]}
          empty="Nenhum veículo."
        />
      )}
      {can('manutencoes') && (
        <>
          <div className="section-title">Histórico de trocas</div>
          {history.loading && !history.data ? <Loading /> : history.data && <MaintenancesTable rows={history.data.maintenances} />}
        </>
      )}
    </Guard>
  );
}
