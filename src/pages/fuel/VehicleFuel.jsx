import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Fuel, FileText } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox } from '../../components/ui.jsx';
import { fmtDate, fmtKm, fmtNum, fmtMoney } from '../../lib/format.js';
import { FuelingsTable } from './FuelingList.jsx';
import { ConsumptionChart, PerFuelingChart } from './FuelAverages.jsx';
import { OrderFormModal } from './FuelOrders.jsx';

/** Quadro de combustível da ficha do veículo. */
export function VehicleFuelSummary({ vehicle, compact = false }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [orderModal, setOrderModal] = useState(false);
  const { data, loading, error, reload } = useFetch(`/vehicles/${vehicle.id}/fuel-summary`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data;
  const active = vehicle.status !== 'inativo';
  return (
    <div className="card">
      <div className="card-head">
        <h3>Combustível</h3>
        <div className="btn-row">
          {active && can('ordens_abastecimento', 'cadastrar') && (
            <button type="button" className="btn sm" onClick={() => setOrderModal(true)}>
              <FileText size={14} /> Nova ordem
            </button>
          )}
          {active && can('abastecimentos', 'cadastrar') && (
            <Link to={`/abastecimentos/novo?veiculo=${vehicle.id}`} className="btn sm primary">
              <Fuel size={14} /> Abastecer
            </Link>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="dl">
          <div>
            <div className="k">Média atual</div>
            <div className="v" style={{ fontSize: 18 }}>{s.last_average ? `${fmtNum(s.last_average.km_per_liter, 2)} km/L` : '—'}</div>
          </div>
          <div>
            <div className="k">Média 90 dias</div>
            <div className="v" style={{ fontSize: 18 }}>{s.last_90_days?.km_per_liter ? `${fmtNum(s.last_90_days.km_per_liter, 2)} km/L` : '—'}</div>
          </div>
          <div>
            <div className="k">Média geral</div>
            <div className="v">{s.overall?.km_per_liter ? `${fmtNum(s.overall.km_per_liter, 2)} km/L` : '—'}</div>
          </div>
          <div>
            <div className="k">Último abastecimento</div>
            <div className="v">
              {s.last ? (
                <Link to={`/abastecimentos/${s.last.id}`}>
                  {fmtDate(s.last.fueled_at)} · {fmtNum(s.last.liters, 0)} L · {fmtKm(s.last.km)}
                </Link>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="k">Combustível no mês</div>
            <div className="v">{fmtMoney(s.month?.total || 0)}</div>
          </div>
          {!compact && (
            <div>
              <div className="k">Custo por km (geral)</div>
              <div className="v">{s.overall?.cost_per_km ? fmtMoney(s.overall.cost_per_km) : '—'}</div>
            </div>
          )}
          <div>
            <div className="k">Ordens pendentes</div>
            <div className="v">
              {s.pending_orders ? <Link to={`/abastecimentos/ordens?veiculo=${vehicle.id}&status=pendente`}>{s.pending_orders}</Link> : 0}
            </div>
          </div>
        </div>
      </div>
      {orderModal && (
        <OrderFormModal
          presetVehicle={vehicle.id}
          onClose={() => setOrderModal(false)}
          onSaved={(id) => {
            setOrderModal(false);
            navigate(`/abastecimentos/ordens/${id}`);
          }}
        />
      )}
    </div>
  );
}

/** Aba "Abastecimentos" da ficha do veículo. */
export function VehicleFuelTab({ vehicle }) {
  const { can } = useAuth();
  const list = useFetch(can('abastecimentos') ? `/fuelings${qs({ vehicle_id: vehicle.id, status: 'todos', limit: 300 })}` : null);
  if (!can('abastecimentos')) return <VehicleFuelSummary vehicle={vehicle} />;
  return (
    <>
      <VehicleFuelSummary vehicle={vehicle} />
      <ConsumptionChart vehicleId={vehicle.id} />
      <PerFuelingChart vehicleId={vehicle.id} />
      <div className="section-title">Abastecimentos</div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : <FuelingsTable rows={list.data.fuelings} showVehicle={false} />}
    </>
  );
}

/** Aba "Abastecimentos" da ficha do motorista. */
export function DriverFuelTab({ driverId }) {
  const { data, loading, error, reload } = useFetch(`/fuelings${qs({ driver_id: driverId, status: 'todos', limit: 300 })}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <FuelingsTable rows={data.fuelings} showDriver={false} />;
}
