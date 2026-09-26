import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, RefreshCw, Trash2, Plus, Ban } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { useFetch, Loading, ErrorBox, StatusBadge, Tabs, Dl, DataTable, useToast, useDialog, Modal, Field, Select } from '../../components/ui.jsx';
import { PageHead } from '../../components/common.jsx';
import { DocumentsPanel } from '../docs/Documents.jsx';
import { CnhBadge } from './DriverList.jsx';
import { fmtCpf, fmtDate, fmtDateTime, fmtKm, todayISO } from '../../lib/format.js';
import { DRIVER_STATUS, OCCURRENCE_TYPES, labelOf } from '../../../shared/constants.js';
import { ACTION_LABELS } from '../../../shared/labels.js';
import { ChangeList } from '../admin/Audit.jsx';
import { DriverFuelTab } from '../fuel/VehicleFuel.jsx';

function StatusModal({ driver, onClose, onSaved }) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(driver.status);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const needsCancel = status === 'inativo' || driver.status === 'inativo';
  const allowed = !needsCancel || can('motoristas', 'cancelar');
  const save = async () => {
    setBusy(true);
    try {
      await api(`/drivers/${driver.id}/status`, { method: 'POST', body: { status, reason } });
      toast('Status alterado.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Status do motorista"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !allowed || status === driver.status || (status === 'inativo' && !reason.trim())} onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Novo status">
          <Select value={status} onChange={setStatus} options={DRIVER_STATUS} allowEmpty={false} autoFocus />
        </Field>
        <Field label={status === 'inativo' ? 'Motivo (obrigatório)' : 'Observação'} className="full">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
      {status === 'inativo' && driver.vehicle_id && <div className="notice warn" style={{ marginTop: 10 }}>O motorista será desvinculado do veículo {driver.vehicle_plate}.</div>}
      {!allowed && <div className="notice danger" style={{ marginTop: 10 }}>Inativar ou reativar exige a permissão “Cancelar” em Motoristas.</div>}
    </Modal>
  );
}

function OccurrenceModal({ driver, onClose, onSaved }) {
  const toast = useToast();
  const vehicles = useFetch('/vehicles/options?all=1');
  const [form, setForm] = useState({ occurred_on: todayISO(), type: '', description: '', vehicle_id: driver.vehicle_id || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    setBusy(true);
    try {
      await api(`/drivers/${driver.id}/occurrences`, { method: 'POST', body: { ...form, vehicle_id: form.vehicle_id || null } });
      toast('Ocorrência registrada.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Registrar ocorrência"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !form.type || !form.description.trim() || !form.occurred_on} onClick={save}>
            Registrar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Data" required>
          <input type="date" value={form.occurred_on} onChange={set('occurred_on')} max={todayISO()} />
        </Field>
        <Field label="Tipo" required>
          <Select value={form.type} onChange={set('type')} options={OCCURRENCE_TYPES} autoFocus />
        </Field>
        <Field label="Veículo" className="full">
          <Select
            value={form.vehicle_id}
            onChange={set('vehicle_id')}
            options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · ${v.fleet_number}` : ''}` }))}
            placeholder="Nenhum"
          />
        </Field>
        <Field label="Descrição" required className="full">
          <textarea value={form.description} onChange={set('description')} rows={4} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

function VehiclesTab({ id }) {
  const { data, loading, error, reload } = useFetch(`/drivers/${id}/assignments`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data.assignments}
      columns={[
        { key: 'plate', label: 'Veículo', mobile: 'title', render: (a) => <Link to={`/veiculos/${a.vehicle_id}`} className="plate">{a.plate}</Link> },
        { key: 'model', label: 'Modelo', render: (a) => a.model || '—' },
        { key: 'start_at', label: 'Início', render: (a) => fmtDateTime(a.start_at) },
        { key: 'end_at', label: 'Fim', render: (a) => (a.end_at ? fmtDateTime(a.end_at) : <span className="badge ok">Atual</span>) },
        { key: 'km_driven', label: 'KM no período', className: 'right num', render: (a) => fmtKm(a.km_driven) },
        { key: 'notes', label: 'Obs.', render: (a) => a.notes || '—' },
      ]}
      empty="Nenhum veículo utilizado até agora."
    />
  );
}

function OccurrencesTab({ driver, canEdit }) {
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [modal, setModal] = useState(false);
  const { data, loading, error, reload } = useFetch(`/drivers/${driver.id}/occurrences`);
  const cancel = async (o) => {
    const reason = await dialog.prompt({ title: 'Cancelar ocorrência', label: 'Motivo do cancelamento', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar ocorrência' });
    if (!reason) return;
    try {
      await api(`/occurrences/${o.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Ocorrência cancelada.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ocorrências</h2>
        {canEdit && (
          <button type="button" className="btn primary sm" onClick={() => setModal(true)}>
            <Plus size={14} /> Registrar
          </button>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={data.occurrences}
          columns={[
            { key: 'occurred_on', label: 'Data', mobile: 'title', render: (o) => fmtDate(o.occurred_on) },
            { key: 'type', label: 'Tipo', render: (o) => labelOf(OCCURRENCE_TYPES, o.type) },
            { key: 'plate', label: 'Veículo', render: (o) => (o.plate ? <span className="plate">{o.plate}</span> : '—') },
            {
              key: 'description',
              label: 'Descrição',
              render: (o) => (
                <span style={{ textDecoration: o.cancelled_at ? 'line-through' : undefined }}>
                  {o.description}
                  {o.cancelled_at && <div className="small muted">Cancelada por {o.cancelled_by_name}: {o.cancel_reason}</div>}
                </span>
              ),
            },
            { key: 'created_by_name', label: 'Registrado por' },
            {
              key: 'actions',
              label: '',
              noSort: true,
              render: (o) =>
                !o.cancelled_at && can('motoristas', 'cancelar') ? (
                  <button type="button" className="btn sm ghost" title="Cancelar ocorrência" onClick={() => cancel(o)}>
                    <Ban size={14} />
                  </button>
                ) : null,
            },
          ]}
          empty="Nenhuma ocorrência registrada."
        />
      )}
      {modal && (
        <OccurrenceModal
          driver={driver}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AuditTab({ id }) {
  const { data, loading, error, reload } = useFetch(`/drivers/${id}/audit`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data.entries}
      columns={[
        { key: 'created_at', label: 'Data', mobile: 'title', render: (e) => fmtDateTime(e.created_at) },
        { key: 'username', label: 'Usuário' },
        { key: 'action', label: 'Ação', render: (e) => ACTION_LABELS[e.action] || e.action },
        { key: 'changes', label: 'Alterações', noSort: true, render: (e) => <ChangeList changes={e.changes} /> },
        { key: 'reason', label: 'Motivo', render: (e) => e.reason || '—' },
      ]}
      empty="Nenhuma alteração registrada."
    />
  );
}

export default function DriverDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'geral';
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(`/drivers/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data.driver;
  const canEdit = can('motoristas', 'editar') && d.status !== 'inativo';

  const remove = async () => {
    const reason = await dialog.prompt({
      title: 'Excluir motorista',
      message: `Excluir definitivamente ${d.full_name}? Use apenas para cadastro feito por engano. Para desligamentos, use "Inativar".`,
      label: 'Motivo da exclusão',
      required: true,
      minLength: 5,
      danger: true,
      confirmLabel: 'Excluir',
    });
    if (!reason) return;
    try {
      await api(`/drivers/${d.id}`, { method: 'DELETE', body: { reason } });
      toast('Motorista excluído.');
      navigate('/motoristas', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <PageHead title={d.full_name} back="/motoristas" sub={`CPF ${fmtCpf(d.cpf)}`}>
        <div className="btn-row">
          <StatusBadge list={DRIVER_STATUS} value={d.status} />
          {can('motoristas', 'editar') && (
            <button type="button" className="btn" onClick={() => setModal('status')}>
              <RefreshCw size={15} /> Status
            </button>
          )}
          {can('motoristas', 'editar') && (
            <Link to={`/motoristas/${d.id}/editar`} className="btn">
              <Pencil size={15} /> Editar
            </Link>
          )}
          {can('motoristas', 'excluir') && (
            <button type="button" className="btn danger icon" onClick={remove} title="Excluir cadastro">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </PageHead>

      <Tabs
        tabs={[
          { key: 'geral', label: 'Visão geral' },
          { key: 'veiculos', label: 'Veículos utilizados' },
          { key: 'ocorrencias', label: 'Ocorrências' },
          can('abastecimentos') && { key: 'abastecimentos', label: 'Abastecimentos' },
          { key: 'documentos', label: 'Documentos' },
          { key: 'historico', label: 'Histórico' },
        ].filter(Boolean)}
        active={tab}
        onChange={(k) => setParams({ aba: k }, { replace: true })}
      />

      {tab === 'geral' && (
        <>
          <div className="grid g2">
            <div className="card">
              <div className="card-head">
                <h3>CNH</h3>
              </div>
              <div className="card-body">
                <Dl
                  items={[
                    ['Número', d.cnh_number],
                    ['Categoria', d.cnh_category],
                    ['Validade', <CnhBadge key="c" date={d.cnh_expiry} days={d.cnh_days_left} />],
                  ]}
                />
                {d.cnh_days_left !== null && d.cnh_days_left < 0 && <div className="notice danger" style={{ marginTop: 10 }}>CNH vencida. O motorista não deve dirigir até a renovação.</div>}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h3>Veículo atual</h3>
              </div>
              <div className="card-body">
                {d.vehicle_id ? (
                  <>
                    <Link to={`/veiculos/${d.vehicle_id}`} className="plate" style={{ fontSize: 18 }}>
                      {d.vehicle_plate}
                    </Link>
                    {d.vehicle_fleet && <span className="muted"> · Frota {d.vehicle_fleet}</span>}
                    <div className="muted small">desde {fmtDateTime(d.vehicle_since)}</div>
                  </>
                ) : (
                  <span className="muted">Sem veículo. Vincule pela ficha do veículo.</span>
                )}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Dados</h3>
            </div>
            <div className="card-body">
              <Dl
                items={[
                  ['Nome', d.full_name],
                  ['CPF', fmtCpf(d.cpf)],
                  ['Telefone', d.phone],
                  ['Admissão', fmtDate(d.admission_date)],
                  ['Status', labelOf(DRIVER_STATUS, d.status)],
                  ['Cadastrado em', fmtDateTime(d.created_at)],
                ]}
              />
              {d.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{d.notes}</div>}
            </div>
          </div>
        </>
      )}
      {tab === 'veiculos' && <VehiclesTab id={d.id} />}
      {tab === 'ocorrencias' && <OccurrencesTab driver={d} canEdit={canEdit} />}
      {tab === 'abastecimentos' && <DriverFuelTab driverId={d.id} />}
      {tab === 'documentos' && <DocumentsPanel driverId={d.id} fileEntity="driver" canEditFiles={canEdit} />}
      {tab === 'historico' && <AuditTab id={d.id} />}

      {modal === 'status' && (
        <StatusModal
          driver={d}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            reload();
          }}
        />
      )}
    </>
  );
}
