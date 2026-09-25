import { Link, useParams } from 'react-router-dom';
import { Pencil, Ban } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { useFetch, Loading, ErrorBox, Dl, useToast, useDialog, StatusBadge } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import { fmtDateTime, fmtKm, fmtNum, fmtMoney } from '../../lib/format.js';
import { FUELING_TYPES, FUELING_STATUS, labelOf } from '../../../shared/constants.js';
import { KmlBadge } from './FuelingList.jsx';

export default function FuelingDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, error, reload } = useFetch(`/fuelings/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const f = data.fueling;
  const active = f.status === 'ativo';

  const cancel = async () => {
    const reason = await dialog.prompt({
      title: 'Cancelar abastecimento',
      message: 'O abastecimento deixa de contar nas médias e custos. O registro continua no histórico e na auditoria. Se houver ordem vinculada, ela volta para pendente.',
      label: 'Motivo do cancelamento',
      required: true,
      minLength: 5,
      danger: true,
      confirmLabel: 'Cancelar abastecimento',
    });
    if (!reason) return;
    try {
      await api(`/fuelings/${f.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Abastecimento cancelado.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Guard module="abastecimentos">
      <PageHead title={`Abastecimento · ${f.plate}`} back="/abastecimentos" sub={fmtDateTime(f.fueled_at)}>
        <div className="btn-row">
          <StatusBadge list={FUELING_STATUS} value={f.status} />
          {active && can('abastecimentos', 'editar') && (
            <Link to={`/abastecimentos/${f.id}/editar`} className="btn">
              <Pencil size={15} /> Editar
            </Link>
          )}
          {active && can('abastecimentos', 'cancelar') && (
            <button type="button" className="btn danger" onClick={cancel}>
              <Ban size={15} /> Cancelar
            </button>
          )}
        </div>
      </PageHead>

      {!active && (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          Cancelado em {fmtDateTime(f.cancelled_at)} por {f.cancelled_by_name}: {f.cancel_reason}
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi info">
          <div className="label">Média</div>
          <div className="value">
            {f.km_per_liter ? (
              <>
                <KmlBadge f={f} /> <span className="small muted">km/L</span>
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="label">KM rodados</div>
          <div className="value">{f.distance != null ? fmtNum(f.distance) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Custo por km</div>
          <div className="value" style={{ fontSize: 20 }}>{f.cost_per_km ? fmtMoney(f.cost_per_km) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Média geral do veículo</div>
          <div className="value">{f.vehicle_avg ? fmtNum(f.vehicle_avg, 2) : '—'}</div>
        </div>
      </div>
      {!f.km_per_liter && active && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          {!f.full_tank
            ? 'Abastecimento parcial: os litros entram na média do próximo tanque cheio.'
            : f.fuel_type === 'arla32'
              ? 'ARLA 32 entra no custo, mas não no cálculo de consumo.'
              : 'Sem média: é o primeiro tanque cheio registrado deste veículo (serve de referência para o próximo).'}
        </div>
      )}
      {f.calc_distance && f.calc_distance !== f.distance && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          Média calculada sobre {fmtKm(f.calc_distance)} e {fmtNum(f.calc_liters, 2)} L (inclui abastecimentos parciais desde o tanque cheio anterior).
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Dados do abastecimento</h2>
        </div>
        <div className="card-body">
          <Dl
            items={[
              ['Veículo', <Link key="v" to={`/veiculos/${f.vehicle_id}`} className="plate">{f.plate}</Link>],
              ['Motorista', f.driver_id ? <Link key="d" to={`/motoristas/${f.driver_id}`}>{f.driver_name}</Link> : null],
              ['Data e hora', fmtDateTime(f.fueled_at)],
              ['Quilometragem', fmtKm(f.km)],
              ['KM anterior', f.previous_km != null ? fmtKm(f.previous_km) : null],
              ['Combustível', labelOf(FUELING_TYPES, f.fuel_type)],
              ['Litros', `${fmtNum(f.liters, 2)} L`],
              ['Valor por litro', fmtMoney(f.price_per_liter)],
              ['Valor total', fmtMoney(f.total)],
              ['Tanque cheio', f.full_tank ? 'Sim' : 'Não (parcial)'],
              ['Posto', f.station],
              ['Cidade / UF', [f.city, f.state].filter(Boolean).join(' / ')],
              ['Ordem', f.order_id ? <Link key="o" to={`/abastecimentos/ordens/${f.order_id}`}>Nº {f.order_number}</Link> : f.order_ref],
              ['Lançado por', `${f.created_by_name} em ${fmtDateTime(f.created_at)}`],
            ]}
          />
          {f.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{f.notes}</div>}
        </div>
      </div>
      <Attachments entity="fueling" entityId={f.id} canEdit={active && (can('abastecimentos', 'editar') || can('abastecimentos', 'cadastrar'))} />
    </Guard>
  );
}
