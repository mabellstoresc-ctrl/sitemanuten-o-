import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Ban, CheckCircle, Printer, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, StatusBadge, Modal, IntInput, DecimalInput, Dl, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import MaintenanceFields, { EMPTY_MAINT, maintBody, parseDec } from './MaintenanceFields.jsx';
import { kmConfirmations } from './MaintenanceForm.jsx';
import { fmtDate, fmtDateTime, fmtKm, fmtNum, fmtMoney, todayISO } from '../../lib/format.js';
import { SERVICE_ORDER_STATUS, SERVICE_ORDER_OPEN, MAINTENANCE_TYPES, labelOf } from '../../../shared/constants.js';

export function OrderModal({ order, presetVehicle, presetType, presetProblem, checklistId, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const vehicles = useFetch('/vehicles/options');
  const [v, setV] = useState({
    vehicle_id: order?.vehicle_id || presetVehicle || '',
    type: order?.type || presetType || 'corretiva',
    opened_on: order?.opened_on || todayISO(),
    km: order?.km ?? null,
    reported_problem: order?.reported_problem || presetProblem || '',
    responsible: order?.responsible || '',
    workshop: order?.workshop || '',
    due_date: order?.due_date || '',
    services_done: order?.services_done || '',
    set_vehicle_status: true,
  });
  const vehicle = useFetch(v.vehicle_id && !order ? `/vehicles/${v.vehicle_id}` : null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? (val.target.type === 'checkbox' ? val.target.checked : val.target.value) : val }));
  const save = async (flags = {}) => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...v, due_date: v.due_date || null, ...(checklistId && !order ? { checklist_id: checklistId } : {}), ...flags };
      const r = order ? await api(`/service-orders/${order.id}`, { method: 'PUT', body }) : await api('/service-orders', { method: 'POST', body });
      toast(order ? 'OS atualizada.' : `OS nº ${r.number} aberta.`);
      onSaved(order ? order.id : r.id);
    } catch (err) {
      const extra = await kmConfirmations(err, dialog, user);
      if (extra) return save({ ...flags, ...extra });
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const veh = vehicle.data?.vehicle;
  return (
    <Modal
      wide
      title={order ? `Editar OS nº ${order.number}` : 'Abrir ordem de serviço'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !v.vehicle_id || !v.reported_problem.trim()} onClick={() => save()}>
            {order ? 'Salvar' : 'Abrir OS'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Veículo" required error={errors.vehicle_id} className="span2">
          <Select
            value={v.vehicle_id}
            onChange={set('vehicle_id')}
            options={(vehicles.data?.vehicles || []).map((x) => ({ key: x.id, label: `${x.plate}${x.fleet_number ? ` · Frota ${x.fleet_number}` : ''}` }))}
            disabled={Boolean(order)}
            autoFocus={!order}
          />
        </Field>
        <Field label="Tipo" error={errors.type}>
          <Select value={v.type} onChange={set('type')} options={MAINTENANCE_TYPES} allowEmpty={false} />
        </Field>
        <Field label="Data de abertura" required error={errors.opened_on}>
          <input type="date" value={v.opened_on} onChange={set('opened_on')} max={todayISO()} />
        </Field>
        {!order && (
          <Field label="Quilometragem" error={errors.km} hint={veh ? `KM atual: ${fmtKm(veh.current_km)}` : null}>
            <IntInput value={v.km} onChange={set('km')} />
          </Field>
        )}
        <Field label="Previsão de conclusão" error={errors.due_date} hint="Gera alerta se atrasar">
          <input type="date" value={v.due_date} onChange={set('due_date')} />
        </Field>
        <Field label="Oficina" error={errors.workshop}>
          <input value={v.workshop} onChange={set('workshop')} maxLength={120} />
        </Field>
        <Field label="Responsável" error={errors.responsible}>
          <input value={v.responsible} onChange={set('responsible')} maxLength={120} />
        </Field>
        <Field label="Problema relatado" required error={errors.reported_problem} className="full">
          <textarea value={v.reported_problem} onChange={set('reported_problem')} rows={3} maxLength={4000} />
        </Field>
        {order && (
          <Field label="Serviços realizados (andamento)" className="full" error={errors.services_done}>
            <textarea value={v.services_done} onChange={set('services_done')} rows={3} maxLength={8000} />
          </Field>
        )}
        {!order && (
          <label className="check full">
            <input type="checkbox" checked={v.set_vehicle_status} onChange={set('set_vehicle_status')} /> Colocar o veículo como “Em manutenção” (volta ao status anterior quando a OS for finalizada ou
            cancelada)
          </label>
        )}
      </div>
    </Modal>
  );
}

export function ServiceOrderList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(params.get('nova') === '1');
  const f = { status: params.get('status') || 'abertas', vehicle_id: params.get('veiculo') || '', type: params.get('tipo') || '', q: params.get('q') || '' };
  const map = { status: 'status', vehicle_id: 'veiculo', type: 'tipo', q: 'q' };
  const setF = (k) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    next.delete('nova');
    if (value) next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  const { data, loading, error, reload } = useFetch(`/service-orders${qs(f)}`);
  const vehicles = useFetch('/vehicles/options?all=1');
  return (
    <Guard module="manutencoes">
      <PageHead title="Ordens de serviço" code="401">
        {can('manutencoes', 'cadastrar') && (
          <button type="button" className="btn primary" onClick={() => setModal(true)}>
            <Plus size={16} /> Abrir OS
          </button>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Situação">
          <Select value={f.status} onChange={setF('status')} options={[{ key: 'abertas', label: 'Em aberto' }, ...SERVICE_ORDER_STATUS, { key: 'todas', label: 'Todas' }]} allowEmpty={false} />
        </Field>
        <Field label="Veículo">
          <Select value={f.vehicle_id} onChange={setF('vehicle_id')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }))} placeholder="Todos" />
        </Field>
        <Field label="Tipo">
          <Select value={f.type} onChange={setF('type')} options={MAINTENANCE_TYPES} placeholder="Todos" />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Nº da OS, placa, problema, oficina…" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={data.orders}
          onRowClick={(o) => navigate(`/manutencao/os/${o.id}`)}
          columns={[
            { key: 'number', label: 'OS', mobile: 'title', render: (o) => <strong>Nº {o.number}</strong> },
            { key: 'opened_on', label: 'Abertura', render: (o) => fmtDate(o.opened_on) },
            { key: 'plate', label: 'Veículo', render: (o) => <span className="plate">{o.plate}</span> },
            { key: 'type', label: 'Tipo', render: (o) => labelOf(MAINTENANCE_TYPES, o.type) },
            { key: 'reported_problem', label: 'Problema', className: 'wrap', render: (o) => o.reported_problem },
            { key: 'workshop', label: 'Oficina', render: (o) => o.workshop || '—' },
            {
              key: 'due_date',
              label: 'Previsão',
              render: (o) => (o.due_date ? <span className={o.late ? 'state-vencida' : ''}>{fmtDate(o.due_date)}{o.late ? ' (atrasada)' : ''}</span> : '—'),
            },
            { key: 'cost', label: 'Custo', className: 'right num', noSort: true, render: (o) => fmtMoney(o.maintenance_total ?? o.parts_total) },
            { key: 'status', label: 'Status', render: (o) => <StatusBadge list={SERVICE_ORDER_STATUS} value={o.status} /> },
          ]}
          empty="Nenhuma OS encontrada."
        />
      )}
      {modal && (
        <OrderModal
          presetType={params.get('tipo') || undefined}
          onClose={() => setModal(false)}
          onSaved={(id) => {
            setModal(false);
            navigate(`/manutencao/os/${id}`);
          }}
        />
      )}
    </Guard>
  );
}

function FinalizeModal({ so, onClose, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const settings = useFetch('/settings/public');
  const [v, setV] = useState({
    ...EMPTY_MAINT,
    type: so.type,
    performed_on: todayISO(),
    km: so.current_km || so.km || null,
    workshop: so.workshop || '',
    responsible: so.responsible || '',
    description: so.services_done || '',
  });
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? (val.target.type === 'checkbox' ? val.target.checked : val.target.value) : val }));
  const save = async (flags = {}) => {
    if (!v.categories.length) {
      setErrors({ categories: 'Obrigatório' });
      return;
    }
    setBusy(true);
    try {
      const body = { ...maintBody(v, { withParts: false }), completed_on: v.performed_on, services_done: v.description, keep_vehicle_status: keep, ...flags };
      await api(`/service-orders/${so.id}/finalize`, { method: 'POST', body });
      toast(`OS nº ${so.number} finalizada. Manutenção registrada.`);
      onDone();
    } catch (err) {
      const extra = await kmConfirmations(err, dialog, user);
      if (extra) return save({ ...flags, ...extra });
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={`Finalizar OS nº ${so.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Voltar
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => save()}>
            <CheckCircle size={15} /> Finalizar e registrar manutenção
          </button>
        </>
      }
    >
      <div className="form-grid">
        <MaintenanceFields
          v={v}
          set={set}
          setV={setV}
          errors={errors}
          showParts={false}
          partsTotal={so.parts_total}
          dateLabel="Data de conclusão"
          currentKm={so.current_km}
          oilInterval={settings.data?.settings.alertas.oleo_intervalo_km || 15000}
        />
        {so.vehicle_status === 'em_manutencao' && (
          <label className="check full">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Manter o veículo “Em manutenção” (não liberar ainda)
          </label>
        )}
      </div>
    </Modal>
  );
}

function PartsCard({ so, canEdit, reload }) {
  const toast = useToast();
  const [p, setP] = useState({ description: '', part_number: '', quantity: '1', unit_price: '' });
  const add = async (e) => {
    e.preventDefault();
    try {
      await api(`/service-orders/${so.id}/parts`, { method: 'POST', body: { ...p, quantity: p.quantity || 1, unit_price: p.unit_price || 0 } });
      setP({ description: '', part_number: '', quantity: '1', unit_price: '' });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (part) => {
    try {
      await api(`/service-orders/${so.id}/parts/${part.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3>Peças</h3>
        <span className="muted">Total: <strong>{fmtMoney(so.parts_total)}</strong></span>
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
              <th>Lançada por</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {so.parts.map((x) => (
              <tr key={x.id}>
                <td>{x.description}</td>
                <td>{x.part_number || '—'}</td>
                <td className="right num">{fmtNum(x.quantity, x.quantity % 1 ? 2 : 0)}</td>
                <td className="right num">{fmtMoney(x.unit_price)}</td>
                <td className="right num">{fmtMoney(x.total)}</td>
                <td className="small muted">{x.created_by_name}</td>
                {canEdit && (
                  <td>
                    <button type="button" className="btn sm ghost" onClick={() => remove(x)} aria-label="Remover peça">
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!so.parts.length && (
              <tr>
                <td colSpan={7} className="muted">
                  Nenhuma peça lançada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form onSubmit={add} className="card-body form-grid no-print" style={{ borderTop: '1px solid var(--line)' }}>
          <Field label="Peça" className="span2">
            <input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} maxLength={200} />
          </Field>
          <Field label="Código">
            <input value={p.part_number} onChange={(e) => setP({ ...p, part_number: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Qtd.">
            <DecimalInput value={p.quantity} onChange={(val) => setP({ ...p, quantity: val })} />
          </Field>
          <Field label="Valor unitário (R$)">
            <DecimalInput value={p.unit_price} onChange={(val) => setP({ ...p, unit_price: val })} />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn" disabled={!p.description.trim()}>
              <Plus size={14} /> Adicionar ({fmtMoney((parseDec(p.quantity) || 0) * (parseDec(p.unit_price) || 0))})
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ServiceOrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(`/service-orders/${id}`);
  useEffect(() => setModal(null), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const so = data.order;
  const open = SERVICE_ORDER_OPEN.includes(so.status);
  const canEdit = open && can('manutencoes', 'editar');

  const changeStatus = async (status) => {
    const note = await dialog.prompt({ title: `Mudar para "${labelOf(SERVICE_ORDER_STATUS, status)}"`, label: 'Observação (opcional)', required: false, confirmLabel: 'Confirmar' });
    if (note === null) return;
    try {
      await api(`/service-orders/${so.id}/status`, { method: 'POST', body: { status, note } });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const cancel = async () => {
    const reason = await dialog.prompt({ title: `Cancelar OS nº ${so.number}`, label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar OS' });
    if (!reason) return;
    try {
      await api(`/service-orders/${so.id}/cancel`, { method: 'POST', body: { reason } });
      toast('OS cancelada.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Guard module="manutencoes">
      <PageHead title={`Ordem de serviço nº ${so.number}`} back="/manutencao/os" sub={`${so.plate} · aberta em ${fmtDate(so.opened_on)}`}>
        <div className="btn-row no-print">
          <StatusBadge list={SERVICE_ORDER_STATUS} value={so.status} />
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={15} /> Imprimir
          </button>
          {canEdit && (
            <button type="button" className="btn" onClick={() => setModal('edit')}>
              <Pencil size={15} /> Editar
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn primary" onClick={() => setModal('finalize')}>
              <CheckCircle size={15} /> Finalizar
            </button>
          )}
          {open && can('manutencoes', 'cancelar') && (
            <button type="button" className="btn danger" onClick={cancel}>
              <Ban size={15} /> Cancelar
            </button>
          )}
        </div>
      </PageHead>

      <div className="print-only" style={{ marginBottom: 12 }}>
        <div className="print-order">
          <div className="head">
            <img src="/logo-escuro.png" alt="Rododimi" />
            <div style={{ textAlign: 'right' }}>
              <div>ORDEM DE SERVIÇO</div>
              <div className="num">Nº {so.number}</div>
            </div>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="btn-row no-print" style={{ marginBottom: 12 }}>
          <span className="muted small">Mudar status:</span>
          {SERVICE_ORDER_OPEN.filter((s) => s !== so.status).map((s) => (
            <button key={s} type="button" className="btn sm" onClick={() => changeStatus(s)}>
              {labelOf(SERVICE_ORDER_STATUS, s)}
            </button>
          ))}
        </div>
      )}
      {so.late && <div className="notice warn" style={{ marginBottom: 12 }}>OS atrasada: a previsão de conclusão era {fmtDate(so.due_date)}.</div>}
      {so.status === 'cancelada' && (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          Cancelada em {fmtDateTime(so.cancelled_at)} por {so.cancelled_by_name}: {so.cancel_reason}
        </div>
      )}
      {so.maintenance_id && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          Finalizada em {fmtDate(so.completed_on)} · custo total {fmtMoney(so.maintenance_total)} — <Link to={`/manutencao/${so.maintenance_id}`}>ver manutenção registrada</Link>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <Dl
            items={[
              ['Número', `Nº ${so.number}`],
              ['Veículo', <Link key="v" to={`/veiculos/${so.vehicle_id}`} className="plate">{so.plate}</Link>],
              ['Tipo', labelOf(MAINTENANCE_TYPES, so.type)],
              ['Abertura', fmtDate(so.opened_on)],
              ['KM na abertura', so.km ? fmtKm(so.km) : null],
              ['Previsão', so.due_date ? fmtDate(so.due_date) : null],
              ['Conclusão', so.completed_on ? fmtDate(so.completed_on) : null],
              ['Oficina', so.workshop],
              ['Responsável', so.responsible],
              ['Aberta por', `${so.created_by_name} em ${fmtDateTime(so.created_at)}`],
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <div className="muted small">PROBLEMA RELATADO</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{so.reported_problem}</div>
          </div>
          {so.services_done && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">SERVIÇOS REALIZADOS</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{so.services_done}</div>
            </div>
          )}
        </div>
      </div>

      <PartsCard so={so} canEdit={canEdit} reload={reload} />

      <div className="card no-print">
        <div className="card-head">
          <h3>Andamento</h3>
        </div>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {so.log.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap small muted">{fmtDateTime(l.created_at)}</td>
                  <td>
                    {l.from_status ? `${labelOf(SERVICE_ORDER_STATUS, l.from_status)} → ` : ''}
                    <strong>{labelOf(SERVICE_ORDER_STATUS, l.to_status)}</strong>
                  </td>
                  <td>{l.note || ''}</td>
                  <td className="small muted">{l.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="no-print">
        <Attachments entity="service_order" entityId={so.id} canEdit={open && (can('manutencoes', 'editar') || can('manutencoes', 'cadastrar'))} />
      </div>
      <div className="print-only">
        <div className="print-order">
          <div className="sign">
            <div>Responsável pela oficina</div>
            <div>Rododimi — liberação do veículo</div>
          </div>
        </div>
      </div>

      {modal === 'edit' && (
        <OrderModal
          order={so}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            reload();
          }}
        />
      )}
      {modal === 'finalize' && (
        <FinalizeModal
          so={so}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reload();
          }}
        />
      )}
    </Guard>
  );
}
