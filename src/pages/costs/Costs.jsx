import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Download, Ban, Pencil } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, Modal, DecimalInput, Tabs, Empty, useToast, useDialog } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import BarChart from '../../components/BarChart.jsx';
import { fmtDate, fmtMoney, fmtNum, fmtKm, todayISO } from '../../lib/format.js';
import { COST_CATEGORIES, COST_SOURCES, labelOf } from '../../../shared/constants.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const compact = (v) => (v >= 1000 ? `${fmtNum(v / 1000, v >= 10000 ? 0 : 1)} mil` : fmtNum(v, 0));
const moneyAxis = (v, axis) => (axis ? compact(v) : fmtMoney(v));
const perKm = (v) => (v === null || v === undefined ? '—' : `R$ ${fmtNum(v, 3)}/km`);

function addMonths(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
function lastDay(iso) {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

export function periodFor(key) {
  const today = todayISO();
  const first = `${today.slice(0, 7)}-01`;
  switch (key) {
    case 'mes':
      return { from: first, to: today };
    case 'mes_passado': {
      const f = addMonths(first, -1);
      return { from: f, to: lastDay(f) };
    }
    case 'ano':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case '12m':
      return { from: addMonths(first, -11), to: today };
    default:
      return { from: '', to: '' };
  }
}

const PERIODS = [
  { key: 'mes', label: 'Este mês' },
  { key: 'mes_passado', label: 'Mês passado' },
  { key: 'ano', label: 'Este ano' },
  { key: '12m', label: 'Últimos 12 meses' },
  { key: 'tudo', label: 'Tudo' },
  { key: 'custom', label: 'Personalizado' },
];

export default function Costs() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const period = params.get('periodo') || 'mes';
  const tab = params.get('aba') || 'resumo';
  const custom = { from: params.get('de') || '', to: params.get('ate') || '' };
  const range = period === 'custom' ? custom : periodFor(period);
  const vehicleId = params.get('veiculo') || '';
  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const q = { ...range, vehicle_id: vehicleId };
  const summary = useFetch(`/costs/summary${qs(q)}`);
  const vehicles = useFetch('/vehicles/options?all=1');
  const s = summary.data;
  return (
    <Guard module="custos">
      <PageHead title="Custos" code="801" sub="Tudo que a frota gastou: combustível, manutenção, pneus, recapagem e documentos entram sozinhos; IPVA, seguro, multas e pedágios são lançados aqui.">
        <div className="btn-row">
          {can('custos', 'exportar') && (
            <button type="button" className="btn" onClick={() => downloadFile(`/costs/export${qs(q)}`, 'custos.csv').catch((e) => toast(e.message, 'error'))}>
              <Download size={15} /> Excel
            </button>
          )}
          {can('relatorios') && (
            <Link to="/relatorios?r=custos_veiculo" className="btn">
              Relatório
            </Link>
          )}
        </div>
      </PageHead>
      <div className="filters">
        <Field label="Período">
          <Select value={period} onChange={(v) => set({ periodo: v === 'mes' ? '' : v })} options={PERIODS} allowEmpty={false} />
        </Field>
        {period === 'custom' && (
          <>
            <Field label="De">
              <input type="date" value={custom.from} onChange={(e) => set({ de: e.target.value })} />
            </Field>
            <Field label="Até">
              <input type="date" value={custom.to} onChange={(e) => set({ ate: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Veículo">
          <Select value={vehicleId} onChange={(v) => set({ veiculo: v })} options={[{ key: 'geral', label: 'Geral (sem veículo)' }, ...(vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }))]} placeholder="Toda a frota" />
        </Field>
      </div>
      {summary.error && <ErrorBox error={summary.error} onRetry={summary.reload} />}
      {s && (
        <div className="kpis" style={{ marginBottom: 12 }}>
          <div className="kpi">
            <div className="label">Total no período</div>
            <div className="value" style={{ fontSize: 20 }}>{fmtMoney(s.total)}</div>
          </div>
          <div className="kpi">
            <div className="label">Custo por KM</div>
            <div className="value" style={{ fontSize: 20 }}>{perKm(s.cost_per_km)}</div>
          </div>
          <div className="kpi">
            <div className="label">KM rodado</div>
            <div className="value">{fmtKm(s.km)}</div>
          </div>
          <div className="kpi">
            <div className="label">Lançamentos</div>
            <div className="value">{fmtNum(s.count)}</div>
          </div>
        </div>
      )}
      <Tabs
        tabs={[
          { key: 'resumo', label: 'Resumo' },
          { key: 'lancamentos', label: 'Todos os lançamentos' },
          { key: 'avulsos', label: 'Lançamentos avulsos' },
        ]}
        active={tab}
        onChange={(k) => set({ aba: k === 'resumo' ? '' : k })}
      />
      {tab === 'resumo' && (summary.loading && !s ? <Loading /> : s && <Summary s={s} showVehicles={!vehicleId} />)}
      {tab === 'lancamentos' && <Entries q={q} />}
      {tab === 'avulsos' && <ManualCosts q={q} onChange={summary.reload} />}
    </Guard>
  );
}

function Summary({ s, showVehicles }) {
  if (!s.count) return <Empty>Nenhum custo no período.</Empty>;
  const max = Math.max(...s.by_category.map((c) => c.total), 1);
  const other = (v) => Object.entries(v.by_source).filter(([k]) => !['combustivel', 'arla', 'manutencao'].includes(k)).reduce((t, [, x]) => t + x, 0);
  return (
    <>
      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h3>Por categoria</h3>
          </div>
          <div className="card-body">
            {s.by_category.map((c) => (
              <div key={c.key} className="share-row">
                <span className="share-label">{c.label}</span>
                <span className="share-bar">
                  <span style={{ width: `${(c.total / max) * 100}%` }} />
                </span>
                <span className="share-val num">{fmtMoney(c.total)}</span>
                <span className="share-pct muted small num">{fmtNum((c.total / s.total) * 100, 1)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Por mês</h3>
          </div>
          <div className="card-body">
            <BarChart ariaLabel="Custo total por mês" data={s.by_month.map((m) => ({ label: monthLabel(m.month), value: m.total }))} format={moneyAxis} height={220} />
          </div>
        </div>
      </div>
      {showVehicles && (
        <div className="card">
          <div className="card-head">
            <h3>Por veículo</h3>
          </div>
          <DataTable
            dense
            rows={s.by_vehicle.map((v) => ({ ...v, id: v.vehicle_id || 'geral', other: other(v) }))}
            initialSort={{ key: 'total', dir: 'desc' }}
            columns={[
              { key: 'plate', label: 'Veículo', mobile: 'title', render: (v) => (v.vehicle_id ? <Link to={`/veiculos/${v.vehicle_id}?aba=custos`} className="plate">{v.plate}</Link> : <span className="muted">Geral (sem veículo)</span>) },
              { key: 'fuel', label: 'Combustível', className: 'right num', sort: (v) => (v.by_source.combustivel || 0) + (v.by_source.arla || 0), render: (v) => fmtMoney((v.by_source.combustivel || 0) + (v.by_source.arla || 0)) },
              { key: 'maint', label: 'Manutenção', className: 'right num', sort: (v) => v.by_source.manutencao || 0, render: (v) => fmtMoney(v.by_source.manutencao || 0) },
              { key: 'other', label: 'Outros', className: 'right num', render: (v) => fmtMoney(v.other) },
              { key: 'total', label: 'Total', className: 'right num', render: (v) => <strong>{fmtMoney(v.total)}</strong> },
              { key: 'km', label: 'KM rodado', className: 'right num', render: (v) => (v.km ? fmtKm(v.km) : '—') },
              { key: 'cost_per_km', label: 'R$/km', className: 'right num', render: (v) => (v.cost_per_km !== null ? fmtNum(v.cost_per_km, 3) : '—') },
            ]}
          />
        </div>
      )}
    </>
  );
}

const SOURCE_LINK = {
  abastecimento: (e) => `/abastecimentos/${e.ref_id}`,
  manutencao: (e) => `/manutencao/${e.ref_id}`,
  pneu: (e) => `/pneus/${e.ref_id}`,
  documento: (e) => `/documentos/${e.ref_id}`,
};

function Entries({ q }) {
  const [source, setSource] = useState('');
  const { data, loading, error, reload } = useFetch(`/costs/entries${qs({ ...q, source })}`);
  return (
    <>
      <div className="filters">
        <Field label="Origem">
          <Select value={source} onChange={(v) => setSource(v || '')} options={COST_SOURCES} placeholder="Todas" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          {data.truncated && <div className="notice warn">Mostrando os 1.000 lançamentos mais recentes. Use o Excel para a lista completa.</div>}
          <DataTable
            dense
            rows={data.entries.map((e, i) => ({ ...e, id: `${e.ref_id}-${e.source}-${i}` }))}
            columns={[
              { key: 'date', label: 'Data', mobile: 'title', render: (e) => fmtDate(e.date) },
              { key: 'plate', label: 'Veículo', render: (e) => (e.plate ? <span className="plate">{e.plate}</span> : <span className="muted">Geral</span>) },
              { key: 'source', label: 'Origem', render: (e) => labelOf(COST_SOURCES, e.source) },
              { key: 'category_label', label: 'Categoria' },
              { key: 'description', label: 'Descrição', className: 'wrap', render: (e) => (SOURCE_LINK[e.ref] ? <Link to={SOURCE_LINK[e.ref](e)}>{e.description || '—'}</Link> : e.description || '—') },
              { key: 'amount', label: 'Valor', className: 'right num', render: (e) => fmtMoney(e.amount) },
            ]}
            footer={`${data.entries.length} lançamento(s) · ${fmtMoney(data.entries.reduce((s, e) => s + e.amount, 0))}`}
          />
        </>
      )}
    </>
  );
}

function ManualCosts({ q, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState('ativo');
  const { data, loading, error, reload } = useFetch(`/costs${qs({ ...q, status })}`);
  const cancel = async (c) => {
    const reason = await dialog.prompt({ title: 'Cancelar lançamento', message: `${c.description} — ${fmtMoney(c.amount)}`, label: 'Motivo', required: true, minLength: 5, danger: true, confirmLabel: 'Cancelar lançamento' });
    if (!reason) return;
    try {
      await api(`/costs/${c.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Lançamento cancelado.');
      reload();
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <>
      <div className="filters">
        <Field label="Situação">
          <Select value={status} onChange={(v) => setStatus(v || 'ativo')} options={[{ key: 'ativo', label: 'Válidos' }, { key: 'cancelado', label: 'Cancelados' }, { key: 'todos', label: 'Todos' }]} allowEmpty={false} />
        </Field>
        {can('custos', 'cadastrar') && (
          <div className="field" style={{ justifyContent: 'flex-end', marginLeft: 'auto' }}>
            <button type="button" className="btn primary" onClick={() => setModal({})}>
              <Plus size={16} /> Lançar custo
            </button>
          </div>
        )}
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={data.costs}
          columns={[
            { key: 'cost_date', label: 'Data', mobile: 'title', render: (c) => fmtDate(c.cost_date) },
            { key: 'plate', label: 'Veículo', render: (c) => (c.plate ? <span className="plate">{c.plate}</span> : <span className="muted">Geral</span>) },
            { key: 'category', label: 'Categoria', render: (c) => labelOf(COST_CATEGORIES, c.category) },
            { key: 'description', label: 'Descrição', className: 'wrap' },
            { key: 'supplier', label: 'Fornecedor', render: (c) => c.supplier || '—' },
            { key: 'document_number', label: 'Doc./NF', render: (c) => c.document_number || '—' },
            { key: 'amount', label: 'Valor', className: 'right num', render: (c) => (c.status === 'cancelado' ? <s className="muted">{fmtMoney(c.amount)}</s> : fmtMoney(c.amount)) },
            {
              key: 'act',
              label: '',
              noSort: true,
              mobile: false,
              render: (c) =>
                c.status === 'ativo' ? (
                  <span className="btn-row" style={{ justifyContent: 'flex-end' }}>
                    {can('custos', 'editar') && (
                      <button type="button" className="btn sm ghost" onClick={() => setModal(c)} aria-label="Editar">
                        <Pencil size={14} />
                      </button>
                    )}
                    {can('custos', 'cancelar') && (
                      <button type="button" className="btn sm ghost" onClick={() => cancel(c)} aria-label="Cancelar">
                        <Ban size={14} />
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="badge off" title={c.cancel_reason}>
                    Cancelado
                  </span>
                ),
            },
          ]}
          empty="Nenhum lançamento avulso no período."
        />
      )}
      {modal && (
        <CostModal
          cost={modal.id ? modal : null}
          presetVehicle={q.vehicle_id && q.vehicle_id !== 'geral' ? q.vehicle_id : ''}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            reload();
            onChange();
          }}
        />
      )}
    </>
  );
}

export function CostModal({ cost, presetVehicle = '', onClose, onSaved }) {
  const toast = useToast();
  const vehicles = useFetch('/vehicles/options?all=1');
  const [v, setV] = useState({
    vehicle_id: cost?.vehicle_id || presetVehicle,
    category: cost?.category || '',
    description: cost?.description || '',
    cost_date: cost?.cost_date || todayISO(),
    amount: cost ? String(cost.amount).replace('.', ',') : '',
    supplier: cost?.supplier || '',
    document_number: cost?.document_number || '',
    notes: cost?.notes || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? val.target.value : val ?? '' }));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...v, vehicle_id: v.vehicle_id || null };
      if (cost) await api(`/costs/${cost.id}`, { method: 'PUT', body });
      else await api('/costs', { method: 'POST', body });
      toast(cost ? 'Lançamento atualizado.' : 'Custo lançado.');
      onSaved();
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={cost ? 'Editar lançamento' : 'Lançar custo'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Categoria" required error={errors.category}>
          <Select value={v.category} onChange={set('category')} options={COST_CATEGORIES} autoFocus />
        </Field>
        <Field label="Veículo" error={errors.vehicle_id} hint="Vazio = custo geral da frota">
          <Select value={v.vehicle_id} onChange={set('vehicle_id')} options={(vehicles.data?.vehicles || []).map((x) => ({ key: x.id, label: x.plate }))} placeholder="Geral (sem veículo)" />
        </Field>
        <Field label="Descrição" required className="full" error={errors.description}>
          <input value={v.description} onChange={set('description')} maxLength={200} placeholder="Ex.: IPVA 2026 — cota única" />
        </Field>
        <Field label="Data" required error={errors.cost_date}>
          <input type="date" value={v.cost_date} onChange={set('cost_date')} />
        </Field>
        <Field label="Valor (R$)" required error={errors.amount}>
          <DecimalInput value={v.amount} onChange={set('amount')} />
        </Field>
        <Field label="Fornecedor / órgão" error={errors.supplier}>
          <input value={v.supplier} onChange={set('supplier')} maxLength={120} />
        </Field>
        <Field label="Nº do documento / NF" error={errors.document_number}>
          <input value={v.document_number} onChange={set('document_number')} maxLength={60} />
        </Field>
        <Field label="Observações" className="full" error={errors.notes}>
          <textarea value={v.notes} onChange={set('notes')} rows={2} maxLength={4000} />
        </Field>
      </div>
    </Modal>
  );
}

/** Aba "Custos" da ficha do veículo. */
export function VehicleCostsTab({ vehicle }) {
  const { can } = useAuth();
  const [modal, setModal] = useState(false);
  const { data, loading, error, reload } = useFetch(`/vehicles/${vehicle.id}/costs`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const block = (title, x) => (
    <div className="kpi">
      <div className="label">{title}</div>
      <div className="value" style={{ fontSize: 20 }}>{fmtMoney(x.total)}</div>
      <div className="muted small">{x.cost_per_km !== null && x.cost_per_km !== undefined ? `${perKm(x.cost_per_km)} · ${fmtKm(x.km)}` : x.km ? fmtKm(x.km) : 'sem KM no período'}</div>
    </div>
  );
  const allKm = data.all.km;
  return (
    <>
      <div className="kpis" style={{ marginBottom: 12 }}>
        {block('Este mês', data.month)}
        {block('Este ano', data.year)}
        {block('Total', { ...data.all, cost_per_km: allKm ? Math.round((data.all.total / allKm) * 10000) / 10000 : null })}
      </div>
      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h3>Por categoria (total)</h3>
          </div>
          <div className="card-body">
            {data.all.by_category.length ? (
              data.all.by_category.map((c) => (
                <div key={c.key} className="share-row">
                  <span className="share-label">{c.label}</span>
                  <span className="share-bar">
                    <span style={{ width: `${(c.total / data.all.by_category[0].total) * 100}%` }} />
                  </span>
                  <span className="share-val num">{fmtMoney(c.total)}</span>
                </div>
              ))
            ) : (
              <Empty>Sem custos registrados.</Empty>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Últimos 12 meses</h3>
          </div>
          <div className="card-body">
            <BarChart ariaLabel="Custo do veículo por mês" data={data.by_month.map((m) => ({ label: monthLabel(m.month), value: m.total }))} format={moneyAxis} height={200} />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Últimos lançamentos</h3>
          {can('custos', 'cadastrar') && vehicle.status !== 'inativo' && (
            <button type="button" className="btn sm primary" style={{ marginLeft: 'auto' }} onClick={() => setModal(true)}>
              <Plus size={14} /> Lançar custo
            </button>
          )}
        </div>
        <DataTable
          dense
          footer={false}
          rows={data.recent.map((e, i) => ({ ...e, id: `${e.ref_id}-${e.source}-${i}` }))}
          columns={[
            { key: 'date', label: 'Data', mobile: 'title', render: (e) => fmtDate(e.date) },
            { key: 'category_label', label: 'Categoria' },
            { key: 'description', label: 'Descrição', className: 'wrap', render: (e) => (SOURCE_LINK[e.ref] ? <Link to={SOURCE_LINK[e.ref](e)}>{e.description || '—'}</Link> : e.description || '—') },
            { key: 'amount', label: 'Valor', className: 'right num', render: (e) => fmtMoney(e.amount) },
          ]}
          empty="Nenhum custo registrado."
        />
      </div>
      {modal && (
        <CostModal
          presetVehicle={vehicle.id}
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
