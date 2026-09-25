import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Printer, Pencil, Ban, Fuel } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, StatusBadge, Modal, DecimalInput, Dl, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDate, fmtDateTime, fmtNum, fmtMoney, todayISO } from '../../lib/format.js';
import { FUEL_ORDER_STATUS, FUELING_TYPES, TOWED_TYPES, labelOf } from '../../../shared/constants.js';

const toDec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function OrderFormModal({ order, presetVehicle, onClose, onSaved }) {
  const toast = useToast();
  const vehicles = useFetch('/vehicles/options');
  const drivers = useFetch('/drivers/options');
  const [v, setV] = useState({
    vehicle_id: order?.vehicle_id || presetVehicle || '',
    driver_id: order?.driver_id || '',
    order_date: order?.order_date || todayISO(),
    station: order?.station || '',
    fuel_type: order?.fuel_type || '',
    max_liters: toDec(order?.max_liters),
    max_amount: toDec(order?.max_amount),
    notes: order?.notes || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? val.target.value : val ?? '' }));
  const vehicle = useFetch(v.vehicle_id && !order ? `/vehicles/${v.vehicle_id}` : null);
  const veh = vehicle.data?.vehicle;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...v, driver_id: v.driver_id || (!order && veh?.driver_id) || null, fuel_type: v.fuel_type || null, max_liters: v.max_liters || null, max_amount: v.max_amount || null };
      const r = order ? await api(`/fuel-orders/${order.id}`, { method: 'PUT', body }) : await api('/fuel-orders', { method: 'POST', body });
      toast(order ? 'Ordem atualizada.' : `Ordem nº ${r.number} emitida.`);
      onSaved(order ? order.id : r.id);
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const E = errors;
  return (
    <Modal
      wide
      title={order ? `Editar ordem nº ${order.number}` : 'Nova ordem de abastecimento'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !v.vehicle_id || (!v.max_liters && !v.max_amount)} onClick={save}>
            {order ? 'Salvar' : 'Emitir ordem'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Veículo" required error={E.vehicle_id} className="span2">
          <Select
            value={v.vehicle_id}
            onChange={set('vehicle_id')}
            options={(vehicles.data?.vehicles || []).filter((x) => !TOWED_TYPES.includes(x.type)).map((x) => ({ key: x.id, label: `${x.plate}${x.fleet_number ? ` · Frota ${x.fleet_number}` : ''}` }))}
            autoFocus
          />
        </Field>
        <Field label="Motorista" error={E.driver_id} hint={!v.driver_id && veh?.driver_name ? `Padrão: ${veh.driver_name}` : null}>
          <Select value={v.driver_id} onChange={set('driver_id')} options={(drivers.data?.drivers || []).map((d) => ({ key: d.id, label: d.full_name }))} placeholder={veh?.driver_name ? `${veh.driver_name} (atual)` : '—'} />
        </Field>
        <Field label="Data" required error={E.order_date}>
          <input type="date" value={v.order_date} onChange={set('order_date')} />
        </Field>
        <Field label="Posto autorizado" error={E.station} className="span2">
          <input value={v.station} onChange={set('station')} maxLength={120} />
        </Field>
        <Field label="Combustível" error={E.fuel_type}>
          <Select value={v.fuel_type} onChange={set('fuel_type')} options={FUELING_TYPES} placeholder="Qualquer" />
        </Field>
        <Field label="Limite de litros" error={E.max_liters} hint={veh?.tank_capacity ? `Tanque: ${fmtNum(veh.tank_capacity)} L` : null}>
          <DecimalInput value={v.max_liters} onChange={set('max_liters')} />
        </Field>
        <Field label="Limite de valor (R$)" error={E.max_amount}>
          <DecimalInput value={v.max_amount} onChange={set('max_amount')} />
        </Field>
        <Field label="Observações" className="full" error={E.notes}>
          <textarea value={v.notes} onChange={set('notes')} rows={2} maxLength={2000} />
        </Field>
      </div>
      <p className="muted small">Informe pelo menos um limite (litros e/ou valor).</p>
    </Modal>
  );
}

export function FuelOrderList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(false);
  const f = { status: params.get('status') ?? 'pendente', vehicle_id: params.get('veiculo') || '', from: params.get('de') || '', to: params.get('ate') || '', q: params.get('q') || '' };
  const map = { status: 'status', vehicle_id: 'veiculo', from: 'de', to: 'ate', q: 'q' };
  const setF = (k) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    next.set(map[k], value);
    setParams(next, { replace: true });
  };
  const { data, loading, error, reload } = useFetch(`/fuel-orders${qs(f)}`);
  const vehicles = useFetch('/vehicles/options?all=1');
  return (
    <Guard module="ordens_abastecimento">
      <PageHead title="Ordens de abastecimento" code="302">
        {can('ordens_abastecimento', 'cadastrar') && (
          <button type="button" className="btn primary" onClick={() => setModal(true)}>
            <Plus size={16} /> Nova ordem
          </button>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Situação">
          <Select value={f.status} onChange={setF('status')} options={FUEL_ORDER_STATUS} placeholder="Todas" />
        </Field>
        <Field label="Veículo">
          <Select
            value={f.vehicle_id}
            onChange={setF('vehicle_id')}
            options={(vehicles.data?.vehicles || []).filter((v) => !TOWED_TYPES.includes(v.type)).map((v) => ({ key: v.id, label: v.plate }))}
            placeholder="Todos"
          />
        </Field>
        <Field label="De">
          <input type="date" value={f.from} onChange={setF('from')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={setF('to')} />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Nº da ordem, placa, motorista, posto…" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.orders}
          onRowClick={(o) => navigate(`/abastecimentos/ordens/${o.id}`)}
          columns={[
            { key: 'number', label: 'Nº', mobile: 'title', render: (o) => <strong>Nº {o.number}</strong> },
            { key: 'order_date', label: 'Data', render: (o) => fmtDate(o.order_date) },
            { key: 'plate', label: 'Veículo', render: (o) => <span className="plate">{o.plate}</span> },
            { key: 'driver_name', label: 'Motorista', render: (o) => o.driver_name || '—' },
            { key: 'station', label: 'Posto', render: (o) => o.station || 'Qualquer' },
            { key: 'max_liters', label: 'Limite L', className: 'right num', render: (o) => (o.max_liters ? fmtNum(o.max_liters) : '—') },
            { key: 'max_amount', label: 'Limite R$', className: 'right num', render: (o) => (o.max_amount ? fmtMoney(o.max_amount) : '—') },
            { key: 'used', label: 'Utilizado', noSort: true, render: (o) => (o.fueling_id ? `${fmtNum(o.used_liters, 0)} L · ${fmtMoney(o.used_total)}` : '—') },
            { key: 'status', label: 'Situação', render: (o) => <StatusBadge list={FUEL_ORDER_STATUS} value={o.status} /> },
          ]}
          empty="Nenhuma ordem encontrada."
        />
      )}
      {modal && (
        <OrderFormModal
          onClose={() => setModal(false)}
          onSaved={(id) => {
            setModal(false);
            navigate(`/abastecimentos/ordens/${id}`);
          }}
        />
      )}
    </Guard>
  );
}

function PrintableOrder({ o }) {
  return (
    <div className="print-only">
      <div className="print-order">
        <div className="head">
          <img src="/logo-escuro.png" alt="Rododimi" />
          <div style={{ textAlign: 'right' }}>
            <div>ORDEM DE ABASTECIMENTO</div>
            <div className="num">Nº {o.number}</div>
          </div>
        </div>
        <table>
          <tbody>
            <tr>
              <td className="k">Data</td>
              <td>{fmtDate(o.order_date)}</td>
            </tr>
            <tr>
              <td className="k">Veículo (placa / frota)</td>
              <td>
                <strong>{o.plate}</strong>
                {o.fleet_number ? ` · Frota ${o.fleet_number}` : ''} {o.model ? ` · ${o.model}` : ''}
              </td>
            </tr>
            <tr>
              <td className="k">Motorista</td>
              <td>{o.driver_name || '________________________________'}</td>
            </tr>
            <tr>
              <td className="k">Posto autorizado</td>
              <td>{o.station || 'Qualquer posto'}</td>
            </tr>
            <tr>
              <td className="k">Combustível</td>
              <td>{o.fuel_type ? labelOf(FUELING_TYPES, o.fuel_type) : 'Conforme o veículo'}</td>
            </tr>
            <tr>
              <td className="k">Limite de litros</td>
              <td>{o.max_liters ? `${fmtNum(o.max_liters)} litros` : '—'}</td>
            </tr>
            <tr>
              <td className="k">Limite de valor</td>
              <td>{o.max_amount ? fmtMoney(o.max_amount) : '—'}</td>
            </tr>
            {o.notes && (
              <tr>
                <td className="k">Observações</td>
                <td>{o.notes}</td>
              </tr>
            )}
            <tr>
              <td className="k">KM no abastecimento</td>
              <td>&nbsp;</td>
            </tr>
            <tr>
              <td className="k">Litros / valor abastecidos</td>
              <td>&nbsp;</td>
            </tr>
          </tbody>
        </table>
        <div className="sign">
          <div>Motorista</div>
          <div>Posto (carimbo e assinatura)</div>
        </div>
        <p style={{ fontSize: 11, marginTop: 30 }}>Emitida por {o.created_by_name} em {fmtDateTime(o.created_at)}. Válida somente para o veículo indicado.</p>
      </div>
    </div>
  );
}

export function FuelOrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [modal, setModal] = useState(false);
  const { data, loading, error, reload } = useFetch(`/fuel-orders/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const o = data.order;
  const pending = o.status === 'pendente';

  const cancel = async () => {
    const reason = await dialog.prompt({ title: `Cancelar ordem nº ${o.number}`, label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar ordem' });
    if (!reason) return;
    try {
      await api(`/fuel-orders/${o.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Ordem cancelada.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Guard module="ordens_abastecimento">
      <PageHead title={`Ordem de abastecimento nº ${o.number}`} back="/abastecimentos/ordens" sub={`${o.plate} · ${fmtDate(o.order_date)}`}>
        <div className="btn-row no-print">
          <StatusBadge list={FUEL_ORDER_STATUS} value={o.status} />
          {pending && (
            <button type="button" className="btn" onClick={() => window.print()}>
              <Printer size={15} /> Imprimir
            </button>
          )}
          {pending && can('abastecimentos', 'cadastrar') && (
            <Link to={`/abastecimentos/novo?ordem=${o.id}`} className="btn primary">
              <Fuel size={15} /> Lançar abastecimento
            </Link>
          )}
          {pending && can('ordens_abastecimento', 'editar') && (
            <button type="button" className="btn" onClick={() => setModal(true)}>
              <Pencil size={15} /> Editar
            </button>
          )}
          {pending && can('ordens_abastecimento', 'cancelar') && (
            <button type="button" className="btn danger" onClick={cancel}>
              <Ban size={15} /> Cancelar
            </button>
          )}
        </div>
      </PageHead>

      <div className="no-print">
        {o.status === 'cancelada' && (
          <div className="notice danger" style={{ marginBottom: 12 }}>
            Cancelada em {fmtDateTime(o.cancelled_at)} por {o.cancelled_by_name}: {o.cancel_reason}
          </div>
        )}
        {o.fueling_id && (
          <div className="notice ok" style={{ marginBottom: 12 }}>
            Utilizada em {fmtDateTime(o.used_at)}: {fmtNum(o.used_liters, 2)} L · {fmtMoney(o.used_total)} —{' '}
            <Link to={`/abastecimentos/${o.fueling_id}`}>ver abastecimento</Link>
          </div>
        )}
        <div className="card">
          <div className="card-body">
            <Dl
              items={[
                ['Número', `Nº ${o.number}`],
                ['Data', fmtDate(o.order_date)],
                ['Veículo', <Link key="v" to={`/veiculos/${o.vehicle_id}`} className="plate">{o.plate}</Link>],
                ['Motorista', o.driver_name],
                ['Posto autorizado', o.station || 'Qualquer'],
                ['Combustível', o.fuel_type ? labelOf(FUELING_TYPES, o.fuel_type) : 'Conforme o veículo'],
                ['Limite de litros', o.max_liters ? `${fmtNum(o.max_liters)} L` : null],
                ['Limite de valor', o.max_amount ? fmtMoney(o.max_amount) : null],
                ['Emitida por', `${o.created_by_name} em ${fmtDateTime(o.created_at)}`],
              ]}
            />
            {o.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{o.notes}</div>}
          </div>
        </div>
      </div>
      <PrintableOrder o={o} />
      {modal && (
        <OrderFormModal
          order={o}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            reload();
          }}
        />
      )}
    </Guard>
  );
}
