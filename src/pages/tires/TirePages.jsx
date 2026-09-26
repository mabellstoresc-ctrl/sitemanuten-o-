import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Download, Pencil, Trash2, ArrowRightLeft, ClipboardCheck, Undo2 } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs, downloadFile } from '../../api.js';
import { useFetch, useForm, Loading, ErrorBox, DataTable, Field, Select, StatusBadge, IntInput, DecimalInput, Dl, useToast, useDialog, enterNav } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import Attachments from '../../components/Attachments.jsx';
import { fmtDate, fmtDateTime, fmtKm, fmtNum, fmtMoney } from '../../lib/format.js';
import { TIRE_STATUS, TIRE_ACTIONS, labelOf } from '../../../shared/constants.js';
import TireMap from './TireMap.jsx';
import { MoveModal, InspectModal, RetreadReturnModal } from './TireModals.jsx';

const toDec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function LifeBar({ pct }) {
  if (pct === null || pct === undefined) return <span className="muted">—</span>;
  const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? '#f59e0b' : 'var(--ok)';
  return (
    <span className="nowrap" title={`${fmtNum(pct, 1)}% da vida útil estimada`}>
      <span className="meter" style={{ display: 'inline-block', width: 60, verticalAlign: 'middle', marginTop: 0, marginRight: 6 }}>
        <div style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </span>
      {fmtNum(pct, 0)}%
    </span>
  );
}

function TiresTable({ rows, showPlace = true }) {
  const navigate = useNavigate();
  return (
    <DataTable
      dense
      rows={rows}
      onRowClick={(t) => navigate(`/pneus/${t.id}`)}
      columns={[
        { key: 'code', label: 'Código', mobile: 'title', render: (t) => <strong className="mono">{t.code}</strong> },
        { key: 'fire_number', label: 'Nº fogo', render: (t) => t.fire_number || '—' },
        { key: 'brand', label: 'Marca / modelo', render: (t) => [t.brand, t.model].filter(Boolean).join(' ') || '—' },
        { key: 'size', label: 'Medida', render: (t) => t.size || '—' },
        showPlace && { key: 'plate', label: 'Veículo', render: (t) => (t.plate ? <span className="plate">{t.plate}</span> : '—') },
        showPlace && { key: 'position_label', label: 'Posição', render: (t) => t.position_label || '—' },
        { key: 'total_km', label: 'KM total', className: 'right num', render: (t) => fmtNum(t.total_km) },
        { key: 'life_pct', label: 'Vida útil', render: (t) => <LifeBar pct={t.life_pct} /> },
        { key: 'retread_count', label: 'Recap.', className: 'right num' },
        { key: 'status', label: 'Situação', render: (t) => <StatusBadge list={TIRE_STATUS} value={t.status} /> },
        { key: 'attention', label: '', noSort: true, render: (t) => (t.attention?.length ? <span className="badge warn" title={t.attention.join(', ')}>atenção</span> : null) },
      ].filter(Boolean)}
      empty="Nenhum pneu encontrado."
    />
  );
}

function useTireFilters(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const f = { q: params.get('q') || '', brand: params.get('marca') || '', size: params.get('medida') || '', vehicle_id: params.get('veiculo') || '', atencao: params.get('atencao') || '', ...defaults };
  const map = { q: 'q', brand: 'marca', size: 'medida', vehicle_id: 'veiculo', atencao: 'atencao' };
  const setF = (k) => (val) => {
    const value = val?.target ? (val.target.type === 'checkbox' ? (val.target.checked ? '1' : '') : val.target.value) : val || '';
    const next = new URLSearchParams(params);
    if (value) next.set(map[k], value);
    else next.delete(map[k]);
    setParams(next, { replace: true });
  };
  return [f, setF];
}

function ExportBtn() {
  const { can } = useAuth();
  const toast = useToast();
  if (!can('pneus', 'exportar')) return null;
  return (
    <button type="button" className="btn" onClick={() => downloadFile('/tires/export', 'pneus.csv').catch((e) => toast(e.message, 'error'))}>
      <Download size={15} /> Exportar
    </button>
  );
}

// ---------- 501 Pneus instalados ----------
export function InstalledTires() {
  const [f, setF] = useTireFilters({ status: 'em_uso' });
  const vehicles = useFetch('/vehicles/options');
  const { data, loading, error, reload } = useFetch(`/tires${qs({ status: 'em_uso', q: f.q, atencao: f.atencao })}`);
  return (
    <Guard module="pneus">
      <PageHead title="Pneus instalados" code="501">
        <ExportBtn />
      </PageHead>
      <div className="filters">
        <Field label="Mapa do veículo">
          <Select value={f.vehicle_id} onChange={setF('vehicle_id')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · ${v.fleet_number}` : ''}` }))} placeholder="Escolha para ver o mapa" />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Código, nº de fogo ou placa" />
        </Field>
        <label className="check" style={{ height: 34 }}>
          <input type="checkbox" checked={f.atencao === '1'} onChange={setF('atencao')} /> Só os que precisam de atenção
        </label>
      </div>
      {f.vehicle_id && (
        <div style={{ marginBottom: 12 }}>
          <TireMap vehicleId={f.vehicle_id} key={f.vehicle_id} />
        </div>
      )}
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : <TiresTable rows={data.tires} />}
    </Guard>
  );
}

// ---------- 502 Estoque ----------
export function TireStock() {
  const { can } = useAuth();
  const [f, setF] = useTireFilters();
  const [status, setStatus] = useState('disponiveis');
  const { data, loading, error, reload } = useFetch(`/tires${qs({ status, q: f.q, brand: f.brand, size: f.size })}`);
  const total = data?.tires.length || 0;
  return (
    <Guard module="pneus">
      <PageHead title="Estoque de pneus" code="502" sub="Pneus novos, em estoque e retirados (disponíveis para instalar).">
        <ExportBtn />
        {can('pneus', 'cadastrar') && (
          <Link to="/pneus/novo" className="btn primary">
            <Plus size={16} /> Cadastrar pneu
          </Link>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Situação">
          <Select
            value={status}
            onChange={(v) => setStatus(v || 'disponiveis')}
            options={[{ key: 'disponiveis', label: 'Disponíveis' }, { key: 'novo', label: 'Novos' }, { key: 'estoque', label: 'Em estoque' }, { key: 'retirado', label: 'Retirados' }]}
            allowEmpty={false}
          />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Código ou nº de fogo" />
        </Field>
        <Field label="Marca">
          <input value={f.brand} onChange={setF('brand')} />
        </Field>
        <Field label="Medida">
          <input value={f.size} onChange={setF('size')} placeholder="295/80R22.5" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="muted small" style={{ marginBottom: 6 }}>
            {total} pneu(s). Para instalar, abra o pneu e use “Mover pneu”, ou clique numa posição vazia no mapa do veículo.
          </div>
          <TiresTable rows={data.tires} showPlace={false} />
        </>
      )}
    </Guard>
  );
}

// ---------- 505 Todos os pneus / histórico ----------
export function TireHistoryList() {
  const [f, setF] = useTireFilters();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(`/tires${qs({ status, q: f.q, brand: f.brand, size: f.size })}`);
  return (
    <Guard module="pneus">
      <PageHead title="Histórico de pneus" code="505" sub="Todos os pneus cadastrados. Abra um pneu para ver a linha do tempo completa.">
        <ExportBtn />
      </PageHead>
      <div className="filters">
        <Field label="Situação">
          <Select value={status} onChange={(v) => setStatus(v || '')} options={TIRE_STATUS} placeholder="Todas" />
        </Field>
        <Field label="Buscar" className="grow">
          <input value={f.q} onChange={setF('q')} placeholder="Código, nº de fogo ou placa" autoFocus />
        </Field>
        <Field label="Marca">
          <input value={f.brand} onChange={setF('brand')} />
        </Field>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : <TiresTable rows={data.tires} />}
    </Guard>
  );
}

function moveText(m) {
  const from = m.from_plate ? `${m.from_plate} · ${m.from_position_label}` : null;
  const to = m.to_plate ? `${m.to_plate} · ${m.to_position_label}` : null;
  if (m.action === 'inspecao') {
    const d = m.data || {};
    return [d.tread_depth_mm != null && `sulco ${fmtNum(d.tread_depth_mm, 1)} mm`, d.pressure_psi != null && `${fmtNum(d.pressure_psi)} psi`, d.condition].filter(Boolean).join(' · ');
  }
  if (from && to) return `${from} → ${to}`;
  if (to) return to;
  if (from) return `de ${from}`;
  return '';
}

// ---------- 503 Movimentações ----------
export function TireMovements() {
  const [params, setParams] = useSearchParams();
  const f = { vehicle_id: params.get('veiculo') || '', action: params.get('acao') || '', from: params.get('de') || '', to: params.get('ate') || '' };
  const setF = (k, name) => (val) => {
    const value = val?.target ? val.target.value : val || '';
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const vehicles = useFetch('/vehicles/options?all=1');
  const { data, loading, error, reload } = useFetch(`/tire-movements${qs({ ...f, inspecoes: f.action === 'inspecao' ? '1' : '' })}`);
  const navigate = useNavigate();
  return (
    <Guard module="pneus">
      <PageHead title="Movimentações de pneus" code="503" />
      <div className="filters">
        <Field label="Veículo">
          <Select value={f.vehicle_id} onChange={setF('vehicle_id', 'veiculo')} options={(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }))} placeholder="Todos" />
        </Field>
        <Field label="Tipo">
          <Select value={f.action} onChange={setF('action', 'acao')} options={TIRE_ACTIONS} placeholder="Todas (exceto inspeções)" />
        </Field>
        <Field label="De">
          <input type="date" value={f.from} onChange={setF('from', 'de')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={setF('to', 'ate')} />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={data.movements}
          onRowClick={(m) => navigate(`/pneus/${m.tire_id}`)}
          columns={[
            { key: 'moved_at', label: 'Data', mobile: 'title', render: (m) => fmtDateTime(m.moved_at) },
            { key: 'code', label: 'Pneu', render: (m) => <strong className="mono">{m.code}</strong> },
            { key: 'action', label: 'Movimentação', render: (m) => labelOf(TIRE_ACTIONS, m.action) },
            { key: 'where', label: 'De → para', noSort: true, className: 'wrap', render: (m) => moveText(m) || '—' },
            { key: 'km_run', label: 'KM rodado', className: 'right num', render: (m) => (m.km_run != null ? fmtNum(m.km_run) : '—') },
            { key: 'tire_km', label: 'KM do pneu', className: 'right num', render: (m) => (m.tire_km != null ? fmtNum(m.tire_km) : '—') },
            { key: 'reason', label: 'Motivo', className: 'wrap', render: (m) => m.reason || '—' },
            { key: 'username', label: 'Usuário' },
          ]}
          empty="Nenhuma movimentação no período."
        />
      )}
    </Guard>
  );
}

// ---------- 504 Recapagens ----------
export function TireRetreads() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(`/tire-retreads${qs({ status })}`);
  const navigate = useNavigate();
  return (
    <Guard module="pneus">
      <PageHead title="Recapagens" code="504" sub="Para enviar um pneu, use “Mover pneu › Enviar para recapagem”. O retorno é registrado na ficha do pneu." />
      {data && (
        <div className="kpis" style={{ marginBottom: 10 }}>
          <div className="kpi warn">
            <div className="label">Na recapagem agora</div>
            <div className="value">{data.totals.abertas}</div>
          </div>
          <div className="kpi ok">
            <div className="label">Aprovadas</div>
            <div className="value">{data.totals.aprovadas}</div>
          </div>
          <div className="kpi">
            <div className="label">Reprovadas</div>
            <div className="value">{data.totals.reprovadas}</div>
          </div>
          <div className="kpi">
            <div className="label">Custo total</div>
            <div className="value" style={{ fontSize: 20 }}>{fmtMoney(data.totals.custo_total)}</div>
          </div>
        </div>
      )}
      <div className="filters">
        <Field label="Situação">
          <Select value={status} onChange={(v) => setStatus(v || '')} options={[{ key: 'enviado', label: 'Na recapagem' }, { key: 'retornado', label: 'Aprovadas' }, { key: 'reprovado', label: 'Reprovadas' }]} placeholder="Todas" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.retreads}
          onRowClick={(r) => navigate(`/pneus/${r.tire_id}`)}
          columns={[
            { key: 'code', label: 'Pneu', mobile: 'title', render: (r) => <strong className="mono">{r.code}</strong> },
            { key: 'sent_on', label: 'Envio', render: (r) => fmtDate(r.sent_on) },
            { key: 'company', label: 'Empresa', render: (r) => r.company || '—' },
            { key: 'retread_type', label: 'Tipo', render: (r) => r.retread_type || '—' },
            { key: 'cost', label: 'Valor', className: 'right num', render: (r) => (r.cost != null ? fmtMoney(r.cost) : '—') },
            { key: 'returned_on', label: 'Retorno', render: (r) => (r.returned_on ? fmtDate(r.returned_on) : '—') },
            { key: 'warranty', label: 'Garantia', render: (r) => r.warranty || '—' },
            { key: 'retread_count', label: 'Total de recap.', className: 'right num' },
            {
              key: 'status',
              label: 'Situação',
              render: (r) => <span className={`badge ${r.status === 'enviado' ? 'warn' : r.status === 'retornado' ? 'ok' : 'danger'}`}>{r.status === 'enviado' ? 'Na recapagem' : r.status === 'retornado' ? 'Aprovada' : 'Reprovada'}</span>,
            },
          ]}
          empty="Nenhuma recapagem registrada."
        />
      )}
    </Guard>
  );
}

// ---------- Cadastro ----------
const EMPTY = { code: '', fire_number: '', brand: '', model: '', size: '', purchase_date: '', purchase_value: '', initial_km: null, estimated_life_km: null, notes: '', status: 'novo' };

export function TireForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useFetch(id ? `/tires/${id}` : null);
  if (id && existing.loading) return <Loading />;
  if (id && existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;
  const t = existing.data?.tire;
  const initial = t ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, t[k] ?? EMPTY[k]])), purchase_value: toDec(t.purchase_value) } : EMPTY;
  return (
    <Guard module="pneus" action={id ? 'editar' : 'cadastrar'}>
      <PageHead title={id ? `Editar pneu ${t.code}` : 'Cadastrar pneu'} back={id ? `/pneus/${id}` : '/pneus/estoque'} />
      <TireFormBody initial={initial} id={id} navigate={navigate} toast={toast} />
    </Guard>
  );
}

function TireFormBody({ initial, id, navigate, toast }) {
  const { values: v, set, errors: E, saving, submit } = useForm(initial);
  const onSubmit = submit(async (vals) => {
    try {
      const body = { ...vals, purchase_value: vals.purchase_value || null };
      if (id) {
        delete body.status;
        await api(`/tires/${id}`, { method: 'PUT', body });
        toast('Pneu atualizado.');
        navigate(`/pneus/${id}`);
      } else {
        const r = await api('/tires', { method: 'POST', body });
        toast('Pneu cadastrado.');
        navigate(`/pneus/${r.id}`, { replace: true });
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return (
    <form className="card" onSubmit={onSubmit} onKeyDown={enterNav}>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Código interno" required error={E.code}>
            <input value={v.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} maxLength={40} className="mono" autoFocus={!id} />
          </Field>
          <Field label="Número de fogo" error={E.fire_number}>
            <input value={v.fire_number || ''} onChange={(e) => set('fire_number')(e.target.value.toUpperCase())} maxLength={40} className="mono" />
          </Field>
          <Field label="Marca" error={E.brand}>
            <input value={v.brand || ''} onChange={set('brand')} maxLength={60} list="tire-brands" />
            <datalist id="tire-brands">
              {['Michelin', 'Bridgestone', 'Pirelli', 'Goodyear', 'Continental', 'Firestone', 'Dunlop', 'Xbri', 'Linglong', 'Triangle'].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Modelo" error={E.model}>
            <input value={v.model || ''} onChange={set('model')} maxLength={80} />
          </Field>
          <Field label="Medida" error={E.size}>
            <input value={v.size || ''} onChange={set('size')} maxLength={40} list="tire-sizes" placeholder="295/80R22.5" />
            <datalist id="tire-sizes">
              {['295/80R22.5', '275/80R22.5', '315/80R22.5', '385/65R22.5', '215/75R17.5', '11R22.5', '1000R20'].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Data da compra" error={E.purchase_date}>
            <input type="date" value={v.purchase_date || ''} onChange={set('purchase_date')} />
          </Field>
          <Field label="Valor da compra (R$)" error={E.purchase_value}>
            <DecimalInput value={v.purchase_value} onChange={set('purchase_value')} />
          </Field>
          <Field label="Quilometragem inicial" error={E.initial_km} hint="Se o pneu já chegou rodado">
            <IntInput value={v.initial_km} onChange={set('initial_km')} />
          </Field>
          <Field label="Vida útil estimada (km)" error={E.estimated_life_km}>
            <IntInput value={v.estimated_life_km} onChange={set('estimated_life_km')} placeholder="150.000" />
          </Field>
          {!id && (
            <Field label="Situação inicial">
              <Select value={v.status} onChange={set('status')} options={[{ key: 'novo', label: 'Novo' }, { key: 'estoque', label: 'Em estoque (usado)' }]} allowEmpty={false} />
            </Field>
          )}
          <Field label="Observações" className="full" error={E.notes}>
            <textarea value={v.notes || ''} onChange={set('notes')} rows={2} maxLength={4000} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------- Ficha do pneu ----------
export function TireDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(`/tires/${id}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { tire: t, movements, retreads } = data;
  const canEdit = can('pneus', 'editar') && t.status !== 'descartado';
  const done = () => {
    setModal(null);
    reload();
  };
  const remove = async () => {
    const reason = await dialog.prompt({ title: 'Excluir pneu', message: 'Somente para cadastro feito por engano (pneu sem uso).', label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Excluir' });
    if (!reason) return;
    try {
      await api(`/tires/${t.id}`, { method: 'DELETE', body: { reason } });
      toast('Pneu excluído.');
      navigate('/pneus/estoque', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Guard module="pneus">
      <PageHead title={`Pneu ${t.code}`} back="/pneus/historico" sub={[t.brand, t.model, t.size].filter(Boolean).join(' · ')}>
        <div className="btn-row">
          <StatusBadge list={TIRE_STATUS} value={t.status} />
          {canEdit && t.status !== 'recapagem' && (
            <button type="button" className="btn primary" onClick={() => setModal('move')}>
              <ArrowRightLeft size={15} /> Mover pneu
            </button>
          )}
          {canEdit && t.status === 'recapagem' && (
            <button type="button" className="btn primary" onClick={() => setModal('return')}>
              <Undo2 size={15} /> Retorno da recapagem
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn" onClick={() => setModal('inspect')}>
              <ClipboardCheck size={15} /> Inspecionar
            </button>
          )}
          {can('pneus', 'editar') && (
            <Link to={`/pneus/${t.id}/editar`} className="btn">
              <Pencil size={15} /> Editar
            </Link>
          )}
          {can('pneus', 'excluir') && movements.length <= 1 && (
            <button type="button" className="btn danger icon" onClick={remove} title="Excluir cadastro">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </PageHead>

      {t.attention?.length > 0 && <div className="notice warn" style={{ marginBottom: 12 }}>Precisa de atenção: {t.attention.join(', ')}</div>}

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi info">
          <div className="label">KM total rodado</div>
          <div className="value">{fmtNum(t.total_km)}</div>
        </div>
        <div className="kpi">
          <div className="label">Vida útil</div>
          <div className="value" style={{ fontSize: 18 }}>
            <LifeBar pct={t.life_pct} />
          </div>
        </div>
        <div className="kpi">
          <div className="label">Recapagens</div>
          <div className="value">{t.retread_count}</div>
        </div>
        <div className="kpi">
          <div className="label">Onde está</div>
          <div className="value" style={{ fontSize: 15 }}>
            {t.plate ? (
              <Link to={`/veiculos/${t.vehicle_id}?aba=pneus`}>
                {t.plate} · {t.position_label}
              </Link>
            ) : t.status === 'recapagem' ? (
              `Recapagem${t.retread_company ? ` (${t.retread_company})` : ''}`
            ) : (
              labelOf(TIRE_STATUS, t.status)
            )}
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h3>Dados</h3>
          </div>
          <div className="card-body">
            <Dl
              items={[
                ['Código', t.code],
                ['Nº de fogo', t.fire_number],
                ['Marca', t.brand],
                ['Modelo', t.model],
                ['Medida', t.size],
                ['Compra', t.purchase_date ? fmtDate(t.purchase_date) : null],
                ['Valor', t.purchase_value != null ? fmtMoney(t.purchase_value) : null],
                ['KM inicial', fmtKm(t.initial_km)],
                ['Vida útil estimada', t.estimated_life_km ? fmtKm(t.estimated_life_km) : null],
                ['Sulco', t.tread_depth_mm != null ? `${fmtNum(t.tread_depth_mm, 1)} mm` : null],
                ['Última inspeção', t.last_inspection_on ? fmtDate(t.last_inspection_on) : 'nunca'],
              ]}
            />
            {t.notes && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{t.notes}</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Histórico do pneu</h3>
          </div>
          <div className="card-body">
            <ul className="timeline">
              {movements.map((m) => (
                <li key={m.id} className={`t-${m.action === 'cadastro' ? 'cadastro' : m.action === 'descartar' || m.action === 'recapagem' ? 'status' : 'x'}`}>
                  <div className="when">{fmtDate(m.moved_at)}</div>
                  <div className="rail" />
                  <div className="what">
                    <div className="title">{labelOf(TIRE_ACTIONS, m.action)}</div>
                    <div className="desc">
                      {[moveText(m), m.km_run > 0 && `rodou ${fmtKm(m.km_run)}`, m.tire_km != null && `pneu com ${fmtKm(m.tire_km)}`].filter(Boolean).join(' · ')}
                    </div>
                    {m.action === 'recapagem' && m.data?.company && <div className="desc">Empresa: {m.data.company}</div>}
                    {m.reason && <div className="desc">{m.reason}</div>}
                    <div className="small muted">{m.username}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {retreads.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Recapagens ({t.retread_count} aprovada(s))</h3>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Envio</th>
                  <th>Empresa</th>
                  <th>Tipo</th>
                  <th className="right">Valor</th>
                  <th>Retorno</th>
                  <th>Garantia</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {retreads.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.sent_on)}</td>
                    <td>{r.company || '—'}</td>
                    <td>{r.retread_type || '—'}</td>
                    <td className="right num">{r.cost != null ? fmtMoney(r.cost) : '—'}</td>
                    <td>{r.returned_on ? fmtDate(r.returned_on) : '—'}</td>
                    <td>{r.warranty || '—'}</td>
                    <td>{r.status === 'enviado' ? 'Na recapagem' : r.status === 'retornado' ? 'Aprovada' : 'Reprovada'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Attachments entity="tire" entityId={t.id} canEdit={canEdit} />

      {modal === 'move' && <MoveModal tire={t} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'inspect' && <InspectModal tire={t} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'return' && <RetreadReturnModal tire={t} onClose={() => setModal(null)} onDone={done} />}
    </Guard>
  );
}
