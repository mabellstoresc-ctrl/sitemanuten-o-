import { Link, useParams } from 'react-router-dom';
import { Pencil, Ban } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { useFetch, Loading, ErrorBox, Dl, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import { fmtDate, fmtDateTime, fmtKm, fmtNum, fmtMoney } from '../../lib/format.js';
import { MAINTENANCE_TYPES, OIL_CATEGORY, labelOf } from '../../../shared/constants.js';
import { catText } from './MaintenanceList.jsx';

export default function MaintenanceDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, error, reload } = useFetch(`/maintenances/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const m = data.maintenance;
  const active = m.status === 'ativo';
  const isOil = m.categories.includes(OIL_CATEGORY);

  const cancel = async () => {
    const reason = await dialog.prompt({
      title: 'Cancelar manutenção',
      message: 'A manutenção deixa de contar nos custos e nos alertas de próxima manutenção. O registro continua no histórico.',
      label: 'Motivo',
      required: true,
      minLength: 5,
      danger: true,
      confirmLabel: 'Cancelar manutenção',
    });
    if (!reason) return;
    try {
      await api(`/maintenances/${m.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Manutenção cancelada.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Guard module="manutencoes">
      <PageHead
        title={`${isOil ? 'Troca de óleo' : `Manutenção ${labelOf(MAINTENANCE_TYPES, m.type).toLowerCase()}`} · ${m.plate}`}
        back={m.type === 'preventiva' ? '/manutencao/preventivas' : '/manutencao/corretivas'}
        sub={`${fmtDate(m.performed_on)} · ${catText(m.categories)}`}
      >
        <div className="btn-row">
          <span className={`badge ${active ? 'ok' : 'off'}`}>{active ? 'Válida' : 'Cancelada'}</span>
          {active && can('manutencoes', 'editar') && (
            <Link to={`/manutencao/${m.id}/editar`} className="btn">
              <Pencil size={15} /> Editar
            </Link>
          )}
          {active && !m.service_order_id && can('manutencoes', 'cancelar') && (
            <button type="button" className="btn danger" onClick={cancel}>
              <Ban size={15} /> Cancelar
            </button>
          )}
        </div>
      </PageHead>
      {!active && (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          Cancelada em {fmtDateTime(m.cancelled_at)} por {m.cancelled_by_name}: {m.cancel_reason}
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Dados da manutenção</h2>
        </div>
        <div className="card-body">
          <Dl
            items={[
              ['Veículo', <Link key="v" to={`/veiculos/${m.vehicle_id}`} className="plate">{m.plate}</Link>],
              ['Tipo', labelOf(MAINTENANCE_TYPES, m.type)],
              ['Data', fmtDate(m.performed_on)],
              ['Quilometragem', m.km ? fmtKm(m.km) : null],
              ['Oficina', m.workshop],
              ['Responsável', m.responsible],
              ['Categorias', catText(m.categories)],
              ['Nota fiscal', m.invoice_number],
              ['Ordem de serviço', m.service_order_id ? <Link key="o" to={`/manutencao/os/${m.service_order_id}`}>Nº {m.service_order_number}</Link> : null],
              ['Peças', fmtMoney(m.parts_cost)],
              ['Mão de obra', fmtMoney(m.labor_cost)],
              ['Total', <strong key="t">{fmtMoney(m.total)}</strong>],
              ['Próxima (KM)', m.next_km ? fmtKm(m.next_km) : null],
              ['Próxima (data)', m.next_date ? fmtDate(m.next_date) : null],
              ['Registrado por', `${m.created_by_name} em ${fmtDateTime(m.created_at)}`],
            ]}
          />
          {m.description && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">DESCRIÇÃO / SERVIÇOS</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.description}</div>
            </div>
          )}
          {m.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{m.notes}</div>}
        </div>
      </div>
      {isOil && (
        <div className="card">
          <div className="card-head">
            <h3>Troca de óleo</h3>
          </div>
          <div className="card-body">
            <Dl
              items={[
                ['Marca', m.oil_brand],
                ['Tipo', m.oil_type],
                ['Especificação', m.oil_spec],
                ['Quantidade', m.oil_quantity ? `${fmtNum(m.oil_quantity, 1)} L` : null],
                ['Filtro de óleo', m.oil_filter ? 'Trocado' : 'Não'],
                ['Filtro de combustível', m.fuel_filter ? 'Trocado' : 'Não'],
                ['Filtro de ar', m.air_filter ? 'Trocado' : 'Não'],
              ]}
            />
          </div>
        </div>
      )}
      {m.parts.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Peças utilizadas</h3>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Peça</th>
                  <th>Código</th>
                  <th className="right">Qtd.</th>
                  <th className="right">Unitário</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {m.parts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.description}</td>
                    <td>{p.part_number || '—'}</td>
                    <td className="right num">{fmtNum(p.quantity, p.quantity % 1 ? 2 : 0)}</td>
                    <td className="right num">{fmtMoney(p.unit_price)}</td>
                    <td className="right num">{fmtMoney(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Attachments entity="maintenance" entityId={m.id} canEdit={active && (can('manutencoes', 'editar') || can('manutencoes', 'cadastrar'))} />
    </Guard>
  );
}
