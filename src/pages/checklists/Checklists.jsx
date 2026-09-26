import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Printer, Ban, Wrench, Download, Pencil, ArrowUp, ArrowDown, Trash2, CheckCheck, Settings2 } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, Modal, IntInput, Dl, Empty, StatusBadge, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import { OrderModal } from '../maint/ServiceOrders.jsx';
import { kmConfirmations } from '../maint/MaintenanceForm.jsx';
import { fmtDateTime, fmtKm, nowLocalInput } from '../../lib/format.js';
import { CHECKLIST_KINDS, CHECKLIST_RESULTS, VEHICLE_TYPES, TOWED_TYPES, labelOf } from '../../../shared/constants.js';

const ANSWERS = [
  { key: 'ok', label: 'OK', cls: 'ok' },
  { key: 'nok', label: 'Problema', cls: 'danger' },
  { key: 'na', label: 'N/A', cls: 'muted' },
];

function groupItems(items) {
  const groups = [];
  for (const it of items) {
    const g = it.group || it.item_group || 'Itens';
    let cur = groups.find((x) => x.name === g);
    if (!cur) groups.push((cur = { name: g, items: [] }));
    cur.items.push(it);
  }
  return groups;
}

export function ChecklistList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const f = { result: params.get('resultado') || '', vehicle_id: params.get('veiculo') || '', from: params.get('de') || '', to: params.get('ate') || '' };
  const map = { result: 'resultado', vehicle_id: 'veiculo', from: 'de', to: 'ate' };
  const setF = (k) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    if (value) next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  const { data, loading, error, reload } = useFetch(`/checklists${qs(f)}`);
  const vehicles = useFetch('/vehicles/options?all=1');
  return (
    <Guard module="checklists">
      <PageHead title="Checklists" code="601" sub="Vistoria de saída, retorno e inspeções periódicas. Item crítico com problema reprova o checklist.">
        <div className="btn-row">
          {can('checklists', 'exportar') && (
            <button type="button" className="btn" onClick={() => downloadFile(`/checklists/export${qs(f)}`, 'checklists.csv').catch((e) => toast(e.message, 'error'))}>
              <Download size={15} /> Excel
            </button>
          )}
          <Link to="/checklists/modelos" className="btn">
            <Settings2 size={15} /> Modelos
          </Link>
          {can('checklists', 'cadastrar') && (
            <Link to="/checklists/novo" className="btn primary">
              <Plus size={16} /> Novo checklist
            </Link>
          )}
        </div>
      </PageHead>
      <div className="filters">
        <Field label="Resultado">
          <Select value={f.result} onChange={setF('result')} options={[...CHECKLIST_RESULTS, { key: 'pendentes', label: 'Com problema e sem OS' }]} placeholder="Todos" />
        </Field>
        <Field label="Veículo">
          <Select value={f.vehicle_id} onChange={setF('vehicle_id')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }))} placeholder="Todos" />
        </Field>
        <Field label="De">
          <input type="date" value={f.from} onChange={setF('from')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={setF('to')} />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <ChecklistTable rows={data.checklists} onRowClick={(c) => navigate(`/checklists/${c.id}`)} />
      )}
    </Guard>
  );
}

function ChecklistTable({ rows, onRowClick, showVehicle = true }) {
  return (
    <DataTable
      dense
      rows={rows}
      onRowClick={onRowClick}
      columns={[
        { key: 'number', label: 'Nº', mobile: 'title', render: (c) => <strong>Nº {c.number}</strong> },
        { key: 'performed_at', label: 'Data/hora', render: (c) => fmtDateTime(c.performed_at) },
        showVehicle && { key: 'plate', label: 'Veículo', render: (c) => <span className="plate">{c.plate}</span> },
        { key: 'template_name', label: 'Modelo' },
        { key: 'driver_name', label: 'Motorista', render: (c) => c.driver_name || '—' },
        { key: 'km', label: 'KM', className: 'right num', render: (c) => (c.km ? fmtKm(c.km) : '—') },
        {
          key: 'result',
          label: 'Resultado',
          render: (c) =>
            c.status === 'cancelado' ? (
              <span className="badge off">Cancelado</span>
            ) : (
              <>
                <StatusBadge list={CHECKLIST_RESULTS} value={c.result} />
                {c.nok_count > 0 && <span className="muted small"> {c.nok_count} item(ns)</span>}
              </>
            ),
        },
        { key: 'service_order_number', label: 'OS', render: (c) => (c.service_order_number ? `Nº ${c.service_order_number}` : c.result !== 'ok' && c.status === 'ativo' ? <span className="state-vencida small">sem OS</span> : '—') },
      ].filter(Boolean)}
      empty="Nenhum checklist encontrado."
    />
  );
}

export function VehicleChecklistsTab({ vehicle }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(`/checklists${qs({ vehicle_id: vehicle.id, limit: 100 })}`);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Checklists</h2>
        {can('checklists', 'cadastrar') && vehicle.status !== 'inativo' && (
          <Link to={`/checklists/novo?veiculo=${vehicle.id}`} className="btn sm primary" style={{ marginLeft: 'auto' }}>
            <Plus size={14} /> Novo checklist
          </Link>
        )}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : <ChecklistTable rows={data.checklists} showVehicle={false} onRowClick={(c) => navigate(`/checklists/${c.id}`)} />}
    </div>
  );
}

export function ChecklistForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [params] = useSearchParams();
  const vehicles = useFetch('/vehicles/options');
  const drivers = useFetch('/drivers/options');
  const templates = useFetch('/checklist-templates');
  const [vehicleId, setVehicleId] = useState(params.get('veiculo') || '');
  const [templateId, setTemplateId] = useState('');
  const [head, setHead] = useState({ performed_at: nowLocalInput(), km: null, driver_id: '', inspector: user.full_name || '', notes: '' });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const vehicle = (vehicles.data?.vehicles || []).find((v) => v.id === vehicleId);
  const detail = useFetch(vehicleId ? `/vehicles/${vehicleId}` : null);
  const towed = vehicle && TOWED_TYPES.includes(vehicle.type);
  const options = (templates.data?.templates || []).filter((t) => !vehicle || !t.vehicle_types.length || t.vehicle_types.includes(vehicle.type));
  const tpl = useFetch(templateId ? `/checklist-templates/${templateId}` : null);
  const items = tpl.data?.template.items || [];

  // Escolhe o modelo e o motorista automaticamente ao trocar o veículo
  useEffect(() => {
    if (!vehicle) return;
    if (!options.some((t) => t.id === templateId)) setTemplateId(options[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, templates.data, vehicles.data]);
  useEffect(() => {
    const v = detail.data?.vehicle;
    if (v) setHead((h) => ({ ...h, driver_id: v.driver_id || h.driver_id, km: null }));
  }, [detail.data]);
  useEffect(() => setAnswers({}), [templateId]);

  const answered = items.filter((it) => answers[it.key]?.answer).length;
  const setAnswer = (key, answer) => setAnswers((a) => ({ ...a, [key]: { ...a[key], answer } }));
  const setNote = (key, note) => setAnswers((a) => ({ ...a, [key]: { ...a[key], note } }));
  const allOk = () => setAnswers((a) => Object.fromEntries(items.map((it) => [it.key, a[it.key]?.answer ? a[it.key] : { answer: 'ok' }])));

  const save = async (flags = {}) => {
    if (answered < items.length) {
      toast(`Responda todos os itens (${items.length - answered} sem resposta).`, 'error');
      const first = items.find((it) => !answers[it.key]?.answer);
      document.getElementById(`ck-${first?.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const missingNote = items.filter((it) => answers[it.key].answer === 'nok' && it.critical && !answers[it.key].note?.trim());
    if (missingNote.length && !flags.skipNote) {
      const ok = await dialog.confirm({ title: 'Itens críticos sem descrição', message: `Descreva o problema em: ${missingNote.map((i) => i.label).join('; ')}.\n\nSalvar mesmo assim?`, confirmLabel: 'Salvar assim' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const body = {
        template_id: templateId,
        vehicle_id: vehicleId,
        driver_id: head.driver_id || null,
        performed_at: new Date(head.performed_at).toISOString(),
        km: towed ? null : head.km,
        inspector: head.inspector,
        notes: head.notes,
        answers: items.map((it) => ({ key: it.key, answer: answers[it.key].answer, note: answers[it.key].note || null })),
        ...flags,
      };
      delete body.skipNote;
      const r = await api('/checklists', { method: 'POST', body });
      toast(`Checklist nº ${r.number} salvo — ${labelOf(CHECKLIST_RESULTS, r.result)}.`, r.result === 'ok' ? 'ok' : 'error');
      navigate(`/checklists/${r.id}`, { replace: true });
    } catch (err) {
      const extra = await kmConfirmations(err, dialog, user);
      if (extra) return save({ ...flags, skipNote: true, ...extra });
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Guard module="checklists" action="cadastrar">
      <PageHead title="Novo checklist" code="602" back="/checklists" />
      <div className="card">
        <div className="card-body form-grid">
          <Field label="Veículo" required>
            <Select value={vehicleId} onChange={(v) => setVehicleId(v || '')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · Frota ${v.fleet_number}` : ''} — ${labelOf(VEHICLE_TYPES, v.type)}` }))} autoFocus={!vehicleId} />
          </Field>
          <Field label="Modelo de checklist" required>
            <Select value={templateId} onChange={(v) => setTemplateId(v || '')} options={options.map((t) => ({ key: t.id, label: t.name }))} />
          </Field>
          <Field label="Data/hora" required>
            <input type="datetime-local" value={head.performed_at} max={nowLocalInput()} onChange={(e) => setHead({ ...head, performed_at: e.target.value })} />
          </Field>
          {!towed && (
            <Field label="Quilometragem" hint={vehicle ? `KM atual: ${fmtKm(vehicle.current_km)}` : 'Atualiza o KM do veículo'}>
              <IntInput value={head.km} onChange={(n) => setHead({ ...head, km: n })} />
            </Field>
          )}
          {!towed && (
            <Field label="Motorista">
              <Select value={head.driver_id} onChange={(v) => setHead({ ...head, driver_id: v || '' })} options={(drivers.data?.drivers || []).map((d) => ({ key: d.id, label: d.full_name }))} placeholder="Nenhum" />
            </Field>
          )}
          <Field label="Vistoriador">
            <input value={head.inspector} onChange={(e) => setHead({ ...head, inspector: e.target.value })} maxLength={120} />
          </Field>
        </div>
      </div>

      {templateId && (tpl.loading && !tpl.data ? <Loading /> : (
        <div className="card">
          <div className="card-head">
            <h2>
              Itens ({answered}/{items.length})
            </h2>
            <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={allOk}>
              <CheckCheck size={14} /> Marcar os restantes como OK
            </button>
          </div>
          <div className="card-body">
            {groupItems(items).map((g) => (
              <div key={g.name} className="ck-group">
                <div className="section-title">{g.name}</div>
                {g.items.map((it) => {
                  const a = answers[it.key] || {};
                  return (
                    <div key={it.key} id={`ck-${it.key}`} className={`ck-item ${a.answer === 'nok' ? 'nok' : ''} ${!a.answer ? 'pending' : ''}`}>
                      <div className="ck-label">
                        {it.label} {it.critical && <span className="badge danger" title="Item crítico: com problema reprova o checklist">crítico</span>}
                      </div>
                      <div className="ck-buttons" role="radiogroup" aria-label={it.label}>
                        {ANSWERS.map((o) => (
                          <button key={o.key} type="button" role="radio" aria-checked={a.answer === o.key} className={`btn sm ${a.answer === o.key ? `sel ${o.cls}` : ''}`} onClick={() => setAnswer(it.key, o.key)}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {a.answer === 'nok' && <input className="input ck-note" placeholder="Descreva o problema" value={a.note || ''} maxLength={500} onChange={(e) => setNote(it.key, e.target.value)} />}
                    </div>
                  );
                })}
              </div>
            ))}
            <Field label="Observações gerais" className="full">
              <textarea rows={2} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} maxLength={4000} />
            </Field>
            <div className="form-actions">
              <span className="left muted small">Fotos dos problemas podem ser anexadas depois de salvar.</span>
              <button type="button" className="btn" onClick={() => navigate(-1)}>
                Cancelar
              </button>
              <button type="button" className="btn primary" disabled={busy || !vehicleId || !items.length} onClick={() => save()}>
                {busy ? 'Salvando…' : 'Salvar checklist'}
              </button>
            </div>
          </div>
        </div>
      ))}
      {!options.length && vehicle && templates.data && <div className="notice warn">Nenhum modelo de checklist ativo para {labelOf(VEHICLE_TYPES, vehicle.type).toLowerCase()}. Crie um em Checklists → Modelos.</div>}
    </Guard>
  );
}

export function ChecklistDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [osModal, setOsModal] = useState(false);
  const { data, loading, error, reload } = useFetch(`/checklists/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.checklist;
  const nok = c.answers.filter((a) => a.answer === 'nok');
  const active = c.status === 'ativo';
  const cancel = async () => {
    const reason = await dialog.prompt({ title: `Cancelar checklist nº ${c.number}`, label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar checklist' });
    if (!reason) return;
    try {
      await api(`/checklists/${c.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Checklist cancelado.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const problem = `Checklist nº ${c.number} (${c.template_name}) — itens com problema:\n${nok.map((a) => `• ${a.label}${a.note ? `: ${a.note}` : ''}`).join('\n')}`;
  return (
    <Guard module="checklists">
      <PageHead title={`Checklist nº ${c.number}`} back="/checklists" sub={`${c.plate} · ${c.template_name} · ${fmtDateTime(c.performed_at)}`}>
        <div className="btn-row no-print">
          {active ? <StatusBadge list={CHECKLIST_RESULTS} value={c.result} /> : <span className="badge off">Cancelado</span>}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={15} /> Imprimir
          </button>
          {active && nok.length > 0 && !c.service_order_id && can('manutencoes', 'cadastrar') && (
            <button type="button" className="btn primary" onClick={() => setOsModal(true)}>
              <Wrench size={15} /> Abrir OS com os problemas
            </button>
          )}
          {active && can('checklists', 'cancelar') && (
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
              <div>CHECKLIST — {labelOf(CHECKLIST_RESULTS, c.result).toUpperCase()}</div>
              <div className="num">Nº {c.number}</div>
            </div>
          </div>
        </div>
      </div>
      {!active && (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          Cancelado em {fmtDateTime(c.cancelled_at)} por {c.cancelled_by_name}: {c.cancel_reason}
        </div>
      )}
      {c.service_order_id && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          Problemas encaminhados na <Link to={`/manutencao/os/${c.service_order_id}`}>OS nº {c.service_order_number}</Link>.
        </div>
      )}
      {active && nok.length > 0 && !c.service_order_id && <div className="notice warn" style={{ marginBottom: 12 }}>{nok.length} item(ns) com problema sem OS aberta.</div>}
      <div className="card">
        <div className="card-body">
          <Dl
            items={[
              ['Veículo', <Link key="v" to={`/veiculos/${c.vehicle_id}?aba=checklists`} className="plate">{c.plate}</Link>],
              ['Modelo', `${c.template_name} (${labelOf(CHECKLIST_KINDS, c.kind)})`],
              ['Data/hora', fmtDateTime(c.performed_at)],
              ['KM', c.km ? fmtKm(c.km) : null],
              ['Motorista', c.driver_name],
              ['Vistoriador', c.inspector],
              ['Resultado', `${labelOf(CHECKLIST_RESULTS, c.result)}${c.nok_count ? ` — ${c.nok_count} com problema${c.critical_count ? ` (${c.critical_count} crítico)` : ''}` : ''}`],
              ['Lançado por', `${c.created_by_name} em ${fmtDateTime(c.created_at)}`],
            ]}
          />
          {c.notes && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">OBSERVAÇÕES</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Itens</h3>
        </div>
        <div className="table-wrap">
          <table className="t dense">
            <tbody>
              {groupItems(c.answers).map((g) => [
                <tr key={g.name} className="group-row">
                  <td colSpan={3}>{g.name}</td>
                </tr>,
                ...g.items.map((a) => (
                  <tr key={a.item_key} className={a.answer === 'nok' ? 'row-nok' : ''}>
                    <td>
                      {a.label} {a.critical && <span className="badge danger">crítico</span>}
                    </td>
                    <td className="nowrap">
                      <span className={`badge ${a.answer === 'ok' ? 'ok' : a.answer === 'nok' ? 'danger' : 'muted'}`}>{ANSWERS.find((x) => x.key === a.answer).label}</span>
                    </td>
                    <td className="small">{a.note || ''}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
      <div className="no-print">
        <Attachments entity="checklist" entityId={c.id} canEdit={active && (can('checklists', 'cadastrar') || can('checklists', 'editar'))} title="Fotos" />
      </div>
      <div className="print-only">
        <div className="print-order">
          <div className="sign">
            <div>Vistoriador</div>
            <div>Motorista</div>
          </div>
        </div>
      </div>
      {osModal && (
        <OrderModal
          presetVehicle={c.vehicle_id}
          presetType="corretiva"
          presetProblem={problem}
          checklistId={c.id}
          onClose={() => setOsModal(false)}
          onSaved={(osId) => {
            setOsModal(false);
            navigate(`/manutencao/os/${osId}`);
          }}
        />
      )}
    </Guard>
  );
}

// ---------------- Modelos ----------------
export function ChecklistTemplates() {
  const { can } = useAuth();
  const [edit, setEdit] = useState(null);
  const { data, loading, error, reload } = useFetch('/checklist-templates?all=1');
  return (
    <Guard module="checklists">
      <PageHead title="Modelos de checklist" code="603" back="/checklists" sub="Monte os itens que o vistoriador confere. Itens críticos com problema reprovam o checklist.">
        {can('checklists', 'cadastrar') && (
          <button type="button" className="btn primary" onClick={() => setEdit({})}>
            <Plus size={16} /> Novo modelo
          </button>
        )}
      </PageHead>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.templates}
          onRowClick={can('checklists', 'editar') ? (t) => setEdit(t) : undefined}
          columns={[
            { key: 'name', label: 'Modelo', mobile: 'title', render: (t) => <strong>{t.name}</strong> },
            { key: 'kind', label: 'Tipo', render: (t) => labelOf(CHECKLIST_KINDS, t.kind) },
            { key: 'vehicle_types', label: 'Veículos', render: (t) => (t.vehicle_types.length ? t.vehicle_types.map((x) => labelOf(VEHICLE_TYPES, x)).join(', ') : 'Todos') },
            { key: 'item_count', label: 'Itens', className: 'right num' },
            { key: 'uses', label: 'Usado', className: 'right num', render: (t) => `${t.uses}×` },
            { key: 'is_active', label: 'Situação', render: (t) => <span className={`badge ${t.is_active ? 'ok' : 'off'}`}>{t.is_active ? 'Ativo' : 'Desativado'}</span> },
            can('checklists', 'editar') && { key: 'edit', label: '', noSort: true, render: () => <Pencil size={14} /> },
          ].filter(Boolean)}
        />
      )}
      {edit && (
        <TemplateModal
          id={edit.id}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </Guard>
  );
}

function TemplateModal({ id, onClose, onSaved }) {
  const toast = useToast();
  const existing = useFetch(id ? `/checklist-templates/${id}` : null);
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!id) setV({ name: '', kind: 'saida', vehicle_types: [], is_active: true, items: [{ group: '', label: '', critical: false }] });
    else if (existing.data) setV({ ...existing.data.template, items: existing.data.template.items.map((i) => ({ ...i, group: i.group || '' })) });
  }, [id, existing.data]);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => [...new Set((v?.items || []).map((i) => i.group).filter(Boolean))], [v]);
  if (!v) return null;
  const setItem = (i, patch) => setV((s) => ({ ...s, items: s.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  const move = (i, d) =>
    setV((s) => {
      const items = [...s.items];
      const j = i + d;
      if (j < 0 || j >= items.length) return s;
      [items[i], items[j]] = [items[j], items[i]];
      return { ...s, items };
    });
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: v.name, kind: v.kind, vehicle_types: v.vehicle_types, is_active: v.is_active, items: v.items.filter((i) => i.label.trim()) };
      if (id) await api(`/checklist-templates/${id}`, { method: 'PUT', body });
      else await api('/checklist-templates', { method: 'POST', body });
      toast('Modelo salvo.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggleType = (t) => setV((s) => ({ ...s, vehicle_types: s.vehicle_types.includes(t) ? s.vehicle_types.filter((x) => x !== t) : [...s.vehicle_types, t] }));
  return (
    <Modal
      wide
      title={id ? `Editar modelo — ${v.name}` : 'Novo modelo de checklist'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !v.name.trim()} onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome" required className="span2">
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={100} autoFocus />
        </Field>
        <Field label="Tipo">
          <Select value={v.kind} onChange={(k) => setV({ ...v, kind: k || 'saida' })} options={CHECKLIST_KINDS} allowEmpty={false} />
        </Field>
        {id && (
          <label className="check">
            <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> Ativo
          </label>
        )}
        <div className="field full">
          <label>Aplica-se a (nenhum marcado = todos os veículos)</label>
          <div className="chip-grid">
            {VEHICLE_TYPES.map((t) => (
              <label key={t.key} className={`chip ${v.vehicle_types.includes(t.key) ? 'on' : ''}`}>
                <input type="checkbox" checked={v.vehicle_types.includes(t.key)} onChange={() => toggleType(t.key)} /> {t.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>
        Itens ({v.items.length})
      </div>
      <datalist id="ck-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="tpl-items">
        {v.items.map((it, i) => (
          <div key={i} className="tpl-item">
            <input className="input" placeholder="Grupo (ex.: Freios)" list="ck-groups" value={it.group} onChange={(e) => setItem(i, { group: e.target.value })} maxLength={60} style={{ width: 150 }} />
            <input className="input" placeholder="Item a conferir" value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} maxLength={200} style={{ flex: 1, minWidth: 160 }} />
            <label className="check small" title="Com problema reprova o checklist">
              <input type="checkbox" checked={it.critical} onChange={(e) => setItem(i, { critical: e.target.checked })} /> Crítico
            </label>
            <button type="button" className="btn sm ghost" onClick={() => move(i, -1)} aria-label="Subir">
              <ArrowUp size={14} />
            </button>
            <button type="button" className="btn sm ghost" onClick={() => move(i, 1)} aria-label="Descer">
              <ArrowDown size={14} />
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setV((s) => ({ ...s, items: s.items.filter((_, n) => n !== i) }))} aria-label="Remover">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setV((s) => ({ ...s, items: [...s.items, { group: s.items[s.items.length - 1]?.group || '', label: '', critical: false }] }))}>
        <Plus size={14} /> Adicionar item
      </button>
      {id && <p className="muted small">Alterar o modelo não muda os checklists já feitos (eles guardam os itens da época).</p>}
      {!v.items.length && <Empty>Inclua pelo menos um item.</Empty>}
    </Modal>
  );
}
