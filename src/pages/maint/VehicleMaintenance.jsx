import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Wrench, Droplet } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, StatusBadge } from '../../components/ui.jsx';
import { fmtDate, fmtMoney } from '../../lib/format.js';
import { SERVICE_ORDER_STATUS } from '../../../shared/constants.js';
import { OilStrip } from './OilChanges.jsx';
import { PlansTable, MaintenancesTable, PlanDue, PlanState, catText } from './MaintenanceList.jsx';
import { OrderModal } from './ServiceOrders.jsx';

function useSummary(id) {
  return useFetch(`/vehicles/${id}/maintenance-summary`);
}

/** Resumo para a visão geral do veículo. */
export function VehicleMaintenanceSummary({ vehicle }) {
  const { data, loading, error, reload } = useSummary(vehicle.id);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const next = data.plans.find((p) => !p.is_oil) || null;
  return (
    <div className="grid g2">
      <div className="card">
        <div className="card-head">
          <h3>Troca de óleo</h3>
          <Link to={`?aba=manutencoes`} className="small">
            detalhes
          </Link>
        </div>
        <div className="card-body">
          <OilStrip o={data.oil} />
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Próxima manutenção</h3>
          {data.open_orders.length > 0 && <span className="badge warn">{data.open_orders.length} OS em aberto</span>}
        </div>
        <div className="card-body">
          {next ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{catText(next.categories)}</strong> <PlanState state={next.state} />
              </div>
              <div style={{ marginTop: 4 }}>
                <PlanDue p={next} />
              </div>
              {next.estimated_date && <div className="small muted">Previsão pelo ritmo de rodagem: {fmtDate(next.estimated_date)}</div>}
            </>
          ) : (
            <span className="muted">Nenhuma manutenção programada.</span>
          )}
          <div className="small muted" style={{ marginTop: 8 }}>
            Manutenção no mês: <strong>{fmtMoney(data.cost.month)}</strong> · no ano: <strong>{fmtMoney(data.cost.year)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Aba "Manutenções" da ficha do veículo. */
export function VehicleMaintenanceTab({ vehicle }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);
  const summary = useSummary(vehicle.id);
  const list = useFetch(can('manutencoes') ? `/maintenances${qs({ vehicle_id: vehicle.id, status: 'todos' })}` : null);
  const active = vehicle.status !== 'inativo';
  if (summary.loading && !summary.data) return <Loading />;
  if (summary.error) return <ErrorBox error={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  return (
    <>
      {active && can('manutencoes', 'cadastrar') && (
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn" onClick={() => setModal(true)}>
            <Wrench size={15} /> Abrir OS
          </button>
          <Link to={`/manutencao/nova?veiculo=${vehicle.id}`} className="btn">
            <Plus size={15} /> Registrar manutenção
          </Link>
          <Link to={`/manutencao/nova?oleo=1&veiculo=${vehicle.id}`} className="btn primary">
            <Droplet size={15} /> Registrar troca de óleo
          </Link>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h3>Troca de óleo</h3>
        </div>
        <div className="card-body">
          <OilStrip o={s.oil} />
        </div>
      </div>
      {s.open_orders.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Ordens de serviço em aberto</h3>
          </div>
          <div className="alerts">
            {s.open_orders.map((o) => (
              <Link key={o.id} to={`/manutencao/os/${o.id}`} className="alert-row info">
                <span className="lvl" />
                <strong>OS nº {o.number}</strong>
                <span style={{ flex: 1 }}>{o.reported_problem}</span>
                <span className="small muted">{fmtDate(o.opened_on)}</span>
                <StatusBadge list={SERVICE_ORDER_STATUS} value={o.status} />
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="section-title">Próximas manutenções</div>
      <PlansTable plans={s.plans} showVehicle={false} />
      {can('manutencoes') && (
        <>
          <div className="section-title">Histórico de manutenções</div>
          {list.loading && !list.data ? <Loading /> : list.data && <MaintenancesTable rows={list.data.maintenances} showVehicle={false} />}
        </>
      )}
      {modal && (
        <OrderModal
          presetVehicle={vehicle.id}
          onClose={() => setModal(false)}
          onSaved={(id) => {
            setModal(false);
            navigate(`/manutencao/os/${id}`);
          }}
        />
      )}
    </>
  );
}
