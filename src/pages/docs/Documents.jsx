import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Ban, FileUp, Download, Upload } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs, uploadFile, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, Modal, DecimalInput, Dl, Empty, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import { readOfficialDocument } from '../../lib/pdfText.js';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../../lib/format.js';
import { DOCUMENT_TYPES, DOCUMENT_OWNERS, DOCUMENT_STATUS, TOWED_TYPES, TRACTOR_TYPES, UPLOAD_MAX_BYTES, labelOf } from '../../../shared/constants.js';

export const DOC_STATES = {
  vencido: { label: 'Vencido', tone: 'danger' },
  vencendo: { label: 'Vencendo', tone: 'warn' },
  vigente: { label: 'Vigente', tone: 'ok' },
  sem_validade: { label: 'Sem vencimento', tone: 'muted' },
  substituido: { label: 'Substituído', tone: 'muted' },
  cancelado: { label: 'Cancelado', tone: 'off' },
};

export function DocState({ doc }) {
  const s = DOC_STATES[doc.state] || { label: doc.state, tone: 'muted' };
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

function daysText(d) {
  if (d.status !== 'ativo' || d.days_left === null || d.days_left === undefined) return '';
  if (d.days_left < 0) return `venceu há ${-d.days_left} dia(s)`;
  if (d.days_left === 0) return 'vence hoje';
  return `faltam ${fmtNum(d.days_left)} dia(s)`;
}

const shortType = (t) => labelOf(DOCUMENT_TYPES, t).replace(/ \(.*\)$/, '');
const dec = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));

/** Cadastro / edição de documento. preset: { owner, vehicle_id, driver_id, type } */
export function DocumentModal({ doc, preset = {}, onClose, onSaved }) {
  const toast = useToast();
  const vehicles = useFetch('/vehicles/options?all=1');
  const drivers = useFetch('/drivers/options');
  const [v, setV] = useState(() => ({
    owner: doc?.owner || preset.owner || 'veiculo',
    vehicle_id: doc?.vehicle_id || preset.vehicle_id || '',
    driver_id: doc?.driver_id || preset.driver_id || '',
    type: doc?.type || preset.type || '',
    number: doc?.number || '',
    issuer: doc?.issuer || '',
    issued_on: doc?.issued_on || '',
    valid_from: doc?.valid_from || '',
    expires_on: doc?.expires_on || '',
    exercise_year: doc?.exercise_year || '',
    pbtc: dec(doc?.pbtc),
    combination: doc?.combination || '',
    amount: dec(doc?.amount),
    notes: doc?.notes || '',
    authorized: (doc?.authorized || []).map((a) => a.id),
  }));
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? val.target.value : val ?? '' }));
  const types = DOCUMENT_TYPES.filter((t) => t.owners.includes(v.owner));
  const allVehicles = vehicles.data?.vehicles || [];
  const towed = allVehicles.filter((x) => TOWED_TYPES.includes(x.type));

  // Lê CRLV / AET do PDF e preenche os campos
  const onFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > UPLOAD_MAX_BYTES && f.type === 'application/pdf') {
      toast('Arquivo maior que 4 MB. Reduza o PDF antes de anexar.', 'error');
      return;
    }
    setFile(f);
    if (doc) return;
    setReading(true);
    try {
      const d = await readOfficialDocument(f);
      if (!d) return;
      const byPlate = (p) => allVehicles.find((x) => x.plate === p);
      if (d.kind === 'crlv') {
        const target = byPlate(d.plate);
        setV((s) => ({
          ...s,
          owner: 'veiculo',
          type: 'crlv',
          vehicle_id: target?.id || s.vehicle_id,
          number: d.crv_number || s.number,
          issuer: d.issuer || s.issuer,
          issued_on: d.issued_on || s.issued_on,
          exercise_year: d.exercise_year || s.exercise_year,
        }));
        toast(target ? `CRLV ${d.exercise_year} de ${d.plate} lido. Confira e salve.` : `CRLV de ${d.plate} lido, mas a placa não está cadastrada. Use "Importar CRLV/AET" para cadastrar o veículo junto.`, target ? 'ok' : 'error');
      } else if (d.kind === 'aet') {
        const found = d.plates.map(byPlate).filter(Boolean);
        const tractor = found.find((x) => TRACTOR_TYPES.includes(x.type));
        setV((s) => ({
          ...s,
          owner: 'veiculo',
          type: 'aet',
          vehicle_id: tractor?.id || s.vehicle_id,
          number: d.number || s.number,
          issuer: d.issuer || s.issuer,
          valid_from: d.valid_from || s.valid_from,
          expires_on: d.expires_on || s.expires_on,
          pbtc: d.pbtc ? dec(d.pbtc) : s.pbtc,
          combination: d.combination || s.combination,
          notes: s.notes || (d.art ? `ART nº ${d.art}` : ''),
          authorized: found.filter((x) => TOWED_TYPES.includes(x.type)).map((x) => x.id),
        }));
        const missing = d.plates.filter((p) => !byPlate(p));
        toast(missing.length ? `AET lida. Placas não cadastradas: ${missing.join(', ')}` : 'AET lida. Confira e salve.', missing.length ? 'error' : 'ok');
      }
    } catch {
      toast('Não foi possível ler o PDF automaticamente. Preencha os campos.', 'error');
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = {
      ...v,
      vehicle_id: v.owner === 'veiculo' ? v.vehicle_id || null : null,
      driver_id: v.owner === 'motorista' ? v.driver_id || null : null,
      authorized_vehicle_ids: v.type === 'aet' ? v.authorized : [],
    };
    delete body.authorized;
    try {
      let id = doc?.id;
      if (doc) {
        for (const k of ['owner', 'vehicle_id', 'driver_id', 'type']) delete body[k];
        await api(`/documents/${doc.id}`, { method: 'PUT', body });
      } else {
        const r = await api('/documents', { method: 'POST', body });
        id = r.id;
        if (r.status === 'substituido') toast('Documento salvo como histórico: já existe um mais recente vigente.');
        else if (r.replaced) toast(`Documento salvo. O anterior passou para "substituído".`);
      }
      if (file) {
        try {
          await uploadFile({ entity: 'document', entityId: id, category: 'documento', file });
        } catch (err) {
          toast(`Documento salvo, mas o arquivo não foi enviado: ${err.message}`, 'error');
        }
      }
      toast(doc ? 'Documento atualizado.' : 'Documento cadastrado.');
      onSaved(id);
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      if (err.code === 'DOCUMENTO_DUPLICADO' && err.data?.id) {
        toast('Este documento já está cadastrado.', 'error');
        onSaved(err.data.id);
      } else toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleAuth = (id) => setV((s) => ({ ...s, authorized: s.authorized.includes(id) ? s.authorized.filter((x) => x !== id) : [...s.authorized, id] }));

  return (
    <Modal
      wide
      title={doc ? `Editar ${shortType(doc.type)}` : 'Novo documento'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || reading || !v.type} onClick={save}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="notice info" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 200 }}>
          {file ? (
            <>
              Arquivo: <strong>{file.name}</strong>
            </>
          ) : doc ? (
            'Anexe o arquivo na tela do documento.'
          ) : (
            'Anexe o PDF ou a foto. CRLV digital e AET (DNIT/DER) em PDF são lidos e preenchem os campos sozinhos.'
          )}
        </span>
        {!doc && (
          <>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={onFile} />
            <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={reading}>
              <FileUp size={14} /> {reading ? 'Lendo…' : file ? 'Trocar arquivo' : 'Escolher arquivo'}
            </button>
          </>
        )}
      </div>
      <div className="form-grid">
        {!doc && (
          <Field label="Documento de" required error={errors.owner}>
            <Select
              value={v.owner}
              onChange={(o) => setV((s) => ({ ...s, owner: o || 'veiculo', type: DOCUMENT_TYPES.find((t) => t.key === s.type)?.owners.includes(o) ? s.type : '' }))}
              options={DOCUMENT_OWNERS}
              allowEmpty={false}
            />
          </Field>
        )}
        {!doc && v.owner === 'veiculo' && (
          <Field label="Veículo" required error={errors.vehicle_id}>
            <Select value={v.vehicle_id} onChange={set('vehicle_id')} options={allVehicles.map((x) => ({ key: x.id, label: `${x.plate}${x.fleet_number ? ` · Frota ${x.fleet_number}` : ''}` }))} />
          </Field>
        )}
        {!doc && v.owner === 'motorista' && (
          <Field label="Motorista" required error={errors.driver_id}>
            <Select value={v.driver_id} onChange={set('driver_id')} options={(drivers.data?.drivers || []).map((x) => ({ key: x.id, label: x.full_name }))} />
          </Field>
        )}
        {!doc && (
          <Field label="Tipo de documento" required error={errors.type}>
            <Select value={v.type} onChange={set('type')} options={types} />
          </Field>
        )}
        <Field label="Número" error={errors.number}>
          <input value={v.number} onChange={set('number')} maxLength={60} />
        </Field>
        <Field label="Órgão / emissor" error={errors.issuer} hint={v.type === 'aet' ? 'Ex.: DNIT, DER-SP (uma AET por órgão)' : null}>
          <input value={v.issuer} onChange={set('issuer')} maxLength={80} list="issuers" />
          <datalist id="issuers">
            {['DETRAN-SC', 'DNIT', 'DER-SP', 'DER-SC', 'DEINFRA-SC', 'DER-PR', 'ANTT', 'INMETRO'].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        {v.type === 'crlv' && (
          <Field label="Exercício" error={errors.exercise_year} hint="Ano do licenciamento">
            <input value={v.exercise_year} onChange={(e) => set('exercise_year')(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
          </Field>
        )}
        <Field label="Emissão" error={errors.issued_on}>
          <input type="date" value={v.issued_on} onChange={set('issued_on')} />
        </Field>
        {v.type !== 'crlv' && (
          <Field label="Válido a partir de" error={errors.valid_from}>
            <input type="date" value={v.valid_from} onChange={set('valid_from')} />
          </Field>
        )}
        <Field label="Vencimento" error={errors.expires_on} hint="Gera alerta antes de vencer">
          <input type="date" value={v.expires_on} onChange={set('expires_on')} />
        </Field>
        {v.type === 'aet' && (
          <>
            <Field label="Tipo de conjunto" error={errors.combination}>
              <input value={v.combination} onChange={set('combination')} maxLength={80} placeholder="Ex.: BITREM 6 EIXOS CTSS7+" />
            </Field>
            <Field label="PBTC (t)" error={errors.pbtc}>
              <DecimalInput value={v.pbtc} onChange={set('pbtc')} />
            </Field>
          </>
        )}
        <Field label="Valor pago (R$)" error={errors.amount} hint="Entra nos custos do veículo">
          <DecimalInput value={v.amount} onChange={set('amount')} />
        </Field>
        {v.type === 'aet' && (
          <div className="field full">
            <label>Implementos autorizados nesta AET ({v.authorized.length})</label>
            {towed.length ? (
              <div className="chip-grid">
                {towed.map((t) => (
                  <label key={t.id} className={`chip ${v.authorized.includes(t.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={v.authorized.includes(t.id)} onChange={() => toggleAuth(t.id)} />
                    <span className="plate">{t.plate}</span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="muted small">Nenhuma carreta/implemento cadastrado.</span>
            )}
            <span className="hint">Ao engatar um implemento que não está aqui, o sistema avisa.</span>
          </div>
        )}
        <Field label="Observações" className="full" error={errors.notes}>
          <textarea value={v.notes} onChange={set('notes')} rows={2} maxLength={4000} />
        </Field>
      </div>
    </Modal>
  );
}

function docColumns({ showOwner = true } = {}) {
  return [
    {
      key: 'type',
      label: 'Documento',
      mobile: 'title',
      render: (d) => (
        <span>
          <strong>{shortType(d.type)}</strong>
          {d.issuer ? <span className="muted"> · {d.issuer}</span> : null}
          {d.exercise_year ? <span className="muted"> · {d.exercise_year}</span> : null}
        </span>
      ),
    },
    showOwner && {
      key: 'who',
      label: 'Veículo / motorista',
      sort: (d) => d.plate || d.driver_name || '',
      render: (d) => (d.plate ? <span className="plate">{d.plate}</span> : d.driver_name || <span className="muted">Empresa</span>),
    },
    { key: 'number', label: 'Número', render: (d) => d.number || '—' },
    { key: 'expires_on', label: 'Vencimento', render: (d) => (d.expires_on ? fmtDate(d.expires_on) : '—') },
    { key: 'days_left', label: 'Prazo', className: 'nowrap', render: (d) => <span className={d.days_left < 0 ? 'state-vencida' : ''}>{daysText(d) || '—'}</span> },
    { key: 'state', label: 'Situação', render: (d) => <DocState doc={d} /> },
    { key: 'files', label: 'Arquivo', className: 'right', noSort: true, render: (d) => (d.files ? `${d.files} 📎` : <span className="muted">—</span>) },
  ].filter(Boolean);
}

export function DocumentList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(false);
  const f = { state: params.get('situacao') || 'vigentes', owner: params.get('dono') || '', type: params.get('tipo') || '', q: params.get('q') || '' };
  const map = { state: 'situacao', owner: 'dono', type: 'tipo', q: 'q' };
  const setF = (k) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    if (value) next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  const { data, loading, error, reload } = useFetch(`/documents${qs(f)}`);
  const counts = useFetch('/documents?state=atencao');
  const vencidos = (counts.data?.documents || []).filter((d) => d.state === 'vencido').length;
  const vencendo = (counts.data?.documents || []).filter((d) => d.state === 'vencendo').length;
  return (
    <Guard module="documentos">
      <PageHead title="Documentos" code="701" sub="CRLV, AET, seguros, tacógrafo, exames dos motoristas e documentos da empresa, com aviso de vencimento.">
        <div className="btn-row">
          {can('documentos', 'exportar') && (
            <button type="button" className="btn" onClick={() => downloadFile(`/documents/export${qs(f)}`, 'documentos.csv').catch((e) => toast(e.message, 'error'))}>
              <Download size={15} /> Excel
            </button>
          )}
          {can('documentos', 'cadastrar') && (
            <Link to="/documentos/importar" className="btn">
              <Upload size={15} /> Importar CRLV/AET
            </Link>
          )}
          {can('documentos', 'cadastrar') && (
            <button type="button" className="btn primary" onClick={() => setModal(true)}>
              <Plus size={16} /> Novo documento
            </button>
          )}
        </div>
      </PageHead>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <button type="button" className={`kpi ${vencidos ? 'danger' : 'ok'} clickable`} onClick={() => setF('state')('vencidos')}>
          <div className="label">Vencidos</div>
          <div className="value">{vencidos}</div>
        </button>
        <button type="button" className={`kpi ${vencendo ? 'warn' : 'ok'} clickable`} onClick={() => setF('state')('vencendo')}>
          <div className="label">Vencendo ({data?.warn_days ?? 15} dias)</div>
          <div className="value">{vencendo}</div>
        </button>
      </div>
      <div className="filters">
        <Field label="Situação">
          <Select
            value={f.state}
            onChange={setF('state')}
            options={[
              { key: 'vigentes', label: 'Vigentes' },
              { key: 'vencidos', label: 'Vencidos' },
              { key: 'vencendo', label: 'Vencendo' },
              { key: 'substituido', label: 'Substituídos (histórico)' },
              { key: 'cancelado', label: 'Cancelados' },
              { key: 'todos', label: 'Todos' },
            ]}
            allowEmpty={false}
          />
        </Field>
        <Field label="De">
          <Select value={f.owner} onChange={setF('owner')} options={DOCUMENT_OWNERS} placeholder="Todos" />
        </Field>
        <Field label="Tipo">
          <Select value={f.type} onChange={setF('type')} options={DOCUMENT_TYPES} placeholder="Todos" />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Placa, número, órgão, motorista…" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable dense rows={data.documents} onRowClick={(d) => navigate(`/documentos/${d.id}`)} columns={docColumns()} empty="Nenhum documento neste filtro." />
      )}
      {modal && (
        <DocumentModal
          onClose={() => setModal(false)}
          onSaved={(id) => {
            setModal(false);
            navigate(`/documentos/${id}`);
          }}
        />
      )}
    </Guard>
  );
}

export function DocumentDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(`/documents/${id}`);
  useEffect(() => setModal(null), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data.document;
  const cancel = async () => {
    const reason = await dialog.prompt({ title: 'Cancelar documento', message: 'Use para documento lançado por engano. Se ele substituiu outro, o anterior volta a valer.', label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar documento' });
    if (!reason) return;
    try {
      await api(`/documents/${d.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Documento cancelado.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const who = d.plate ? (
    <Link to={`/veiculos/${d.vehicle_id}?aba=documentos`} className="plate">
      {d.plate}
    </Link>
  ) : d.driver_name ? (
    <Link to={`/motoristas/${d.driver_id}?aba=documentos`}>{d.driver_name}</Link>
  ) : (
    'Empresa'
  );
  return (
    <>
      <PageHead title={`${shortType(d.type)}${d.number ? ` nº ${d.number}` : ''}`} back="/documentos" sub={<>{labelOf(DOCUMENT_OWNERS, d.owner)}: {who}</>}>
        <div className="btn-row">
          <DocState doc={d} />
          {d.status !== 'cancelado' && can('documentos', 'editar') && (
            <button type="button" className="btn" onClick={() => setModal('edit')}>
              <Pencil size={15} /> Editar
            </button>
          )}
          {d.status === 'ativo' && can('documentos', 'cadastrar') && (
            <button type="button" className="btn" onClick={() => setModal('renew')}>
              <Plus size={15} /> Renovar
            </button>
          )}
          {d.status !== 'cancelado' && can('documentos', 'cancelar') && (
            <button type="button" className="btn danger" onClick={cancel}>
              <Ban size={15} /> Cancelar
            </button>
          )}
        </div>
      </PageHead>
      {d.state === 'vencido' && <div className="notice danger" style={{ marginBottom: 12 }}>Documento vencido em {fmtDate(d.expires_on)}. Cadastre o novo em “Renovar”.</div>}
      {d.state === 'vencendo' && <div className="notice warn" style={{ marginBottom: 12 }}>Vence em {fmtDate(d.expires_on)} ({daysText(d)}).</div>}
      {d.status === 'cancelado' && (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          Cancelado em {fmtDateTime(d.cancelled_at)} por {d.cancelled_by_name}: {d.cancel_reason}
        </div>
      )}
      <div className="card">
        <div className="card-body">
          <Dl
            items={[
              ['Documento', labelOf(DOCUMENT_TYPES, d.type)],
              [labelOf(DOCUMENT_OWNERS, d.owner), who],
              ['Número', d.number],
              ['Órgão / emissor', d.issuer],
              d.type === 'crlv' && ['Exercício', d.exercise_year],
              ['Emissão', d.issued_on ? fmtDate(d.issued_on) : null],
              d.valid_from && ['Válido a partir de', fmtDate(d.valid_from)],
              ['Vencimento', d.expires_on ? `${fmtDate(d.expires_on)}${daysText(d) ? ` (${daysText(d)})` : ''}` : null],
              d.type === 'aet' && ['Tipo de conjunto', d.combination],
              d.type === 'aet' && ['PBTC', d.pbtc ? `${fmtNum(d.pbtc, 2)} t` : null],
              ['Valor pago', d.amount ? fmtMoney(d.amount) : null],
              ['Cadastrado por', `${d.created_by_name} em ${fmtDateTime(d.created_at)}`],
            ]}
          />
          {d.notes && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">OBSERVAÇÕES</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</div>
            </div>
          )}
        </div>
      </div>
      {d.type === 'aet' && (
        <div className="card">
          <div className="card-head">
            <h3>Implementos autorizados ({d.authorized.length})</h3>
          </div>
          <div className="card-body">
            {d.authorized.length ? (
              <div className="chip-grid">
                {d.authorized.map((a) => (
                  <Link key={a.id} to={`/veiculos/${a.id}`} className="chip on">
                    <span className="plate">{a.plate}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <span className="muted">Nenhum implemento informado.</span>
            )}
          </div>
        </div>
      )}
      <Attachments entity="document" entityId={d.id} canEdit={d.status !== 'cancelado' && (can('documentos', 'editar') || can('documentos', 'cadastrar'))} title="Arquivo do documento" />
      {data.history.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Outros documentos deste tipo (histórico)</h3>
          </div>
          <DataTable
            dense
            footer={false}
            rows={data.history}
            onRowClick={(h) => navigate(`/documentos/${h.id}`)}
            columns={[
              { key: 'number', label: 'Número', mobile: 'title', render: (h) => h.number || '—' },
              { key: 'issuer', label: 'Órgão', render: (h) => h.issuer || '—' },
              { key: 'exercise_year', label: 'Exercício', render: (h) => h.exercise_year || '—' },
              { key: 'expires_on', label: 'Vencimento', render: (h) => (h.expires_on ? fmtDate(h.expires_on) : '—') },
              { key: 'status', label: 'Situação', render: (h) => <span className={`badge ${DOCUMENT_STATUS.find((x) => x.key === h.status)?.tone}`}>{labelOf(DOCUMENT_STATUS, h.status)}</span> },
            ]}
          />
        </div>
      )}
      {modal === 'edit' && (
        <DocumentModal
          doc={d}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            reload();
          }}
        />
      )}
      {modal === 'renew' && (
        <DocumentModal
          preset={{ owner: d.owner, vehicle_id: d.vehicle_id, driver_id: d.driver_id, type: d.type }}
          onClose={() => setModal(null)}
          onSaved={(newId) => {
            setModal(null);
            navigate(`/documentos/${newId}`);
          }}
        />
      )}
    </>
  );
}

/** Documentos dentro da ficha do veículo ou do motorista. */
export function DocumentsPanel({ vehicleId, driverId, canEditFiles, fileEntity }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);
  const [all, setAll] = useState(false);
  const canDocs = can('documentos');
  const { data, loading, error, reload } = useFetch(canDocs || can('veiculos') || can('motoristas') ? `/documents${qs({ vehicle_id: vehicleId, driver_id: driverId, state: all ? 'todos' : 'vigentes' })}` : null);
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Documentos</h2>
          <label className="check small" style={{ marginLeft: 'auto' }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mostrar histórico
          </label>
          {can('documentos', 'cadastrar') && (
            <button type="button" className="btn sm primary" onClick={() => setModal(true)}>
              <Plus size={14} /> Novo documento
            </button>
          )}
        </div>
        {error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : data?.documents.length ? (
          <DataTable dense footer={false} rows={data.documents} onRowClick={canDocs ? (d) => navigate(`/documentos/${d.id}`) : undefined} columns={docColumns({ showOwner: false }).concat(vehicleId ? [{ key: 'own', label: 'Obs.', noSort: true, render: (d) => (d.vehicle_id !== vehicleId ? <span className="muted small">autorizado na AET de {d.plate}</span> : '') }] : [])} />
        ) : (
          <Empty>Nenhum documento cadastrado.</Empty>
        )}
      </div>
      <Attachments entity={fileEntity} entityId={vehicleId || driverId} canEdit={canEditFiles} title="Outros arquivos e fotos" />
      {modal && (
        <DocumentModal
          preset={vehicleId ? { owner: 'veiculo', vehicle_id: vehicleId } : { owner: 'motorista', driver_id: driverId }}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            reload();
          }}
        />
      )}
    </>
  );
}
