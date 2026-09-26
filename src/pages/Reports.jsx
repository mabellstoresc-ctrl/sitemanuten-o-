import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Printer, Play } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api, qs, downloadFile } from '../api.js';
import { useFetch, Loading, ErrorBox, Field, Select, Empty, useToast } from '../components/ui.jsx';
import { PageHead, Guard } from '../components/common.jsx';
import { periodFor } from './costs/Costs.jsx';
import { fmtDate, fmtDateTime, fmtNum, fmtMoney, fmtKm } from '../lib/format.js';
import { MAINTENANCE_TYPES, SERVICE_ORDER_STATUS, TIRE_STATUS, DOCUMENT_TYPES, VEHICLE_STATUS, COST_SOURCES } from '../../shared/constants.js';

function fmt(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'date':
      return fmtDate(v);
    case 'datetime':
      return fmtDateTime(v);
    case 'money':
      return fmtMoney(v);
    case 'km':
      return fmtKm(v);
    case 'int':
      return fmtNum(v);
    case 'num1':
      return fmtNum(v, 1);
    case 'num2':
      return fmtNum(v, 2);
    case 'num3':
      return fmtNum(v, 3);
    default:
      return String(v);
  }
}
const NUMERIC = ['money', 'km', 'int', 'num1', 'num2', 'num3'];

const PERIODS = [
  { key: 'mes', label: 'Este mês' },
  { key: 'mes_passado', label: 'Mês passado' },
  { key: 'ano', label: 'Este ano' },
  { key: '12m', label: 'Últimos 12 meses' },
  { key: 'tudo', label: 'Tudo' },
  { key: 'custom', label: 'Personalizado' },
];

export default function Reports() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const list = useFetch('/reports');
  const vehicles = useFetch('/vehicles/options?all=1');
  const drivers = useFetch('/drivers/options?all=1');
  const key = params.get('r') || '';
  const rep = list.data?.reports.find((r) => r.key === key);
  const [f, setF] = useState({ period: 'mes', from: '', to: '', vehicle_id: '', driver_id: '', status: '', type: '', state: '', source: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [key]);

  const has = (flt) => rep?.filters.includes(flt);
  const query = () => {
    const range = f.period === 'custom' ? { from: f.from, to: f.to } : periodFor(f.period);
    return {
      ...(has('period') ? range : {}),
      vehicle_id: has('vehicle') ? f.vehicle_id : '',
      driver_id: has('driver') ? f.driver_id : '',
      status: has('status') || has('so_status') || has('tire_status') ? f.status : '',
      type: has('maint_type') || has('doc_type') ? f.type : '',
      state: has('doc_state') ? f.state : '',
      source: has('cost_source') ? f.source : '',
    };
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult({ ...(await api(`/reports/${key}${qs(query())}`)), query: query() });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const excel = () => downloadFile(`/reports/${key}${qs({ ...query(), format: 'csv' })}`, `relatorio-${key}.csv`).catch((e) => toast(e.message, 'error'));

  const groups = [];
  for (const r of list.data?.reports || []) {
    let g = groups.find((x) => x.name === r.group);
    if (!g) groups.push((g = { name: r.group, items: [] }));
    g.items.push(r);
  }
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v || '' }));
  const vOpts = (vehicles.data?.vehicles || []).map((v) => ({ key: v.id, label: v.plate }));
  const filterText = result
    ? [
        result.query.from || result.query.to ? `Período: ${result.query.from ? fmtDate(result.query.from) : 'início'} a ${result.query.to ? fmtDate(result.query.to) : 'hoje'}` : null,
        result.query.vehicle_id ? `Veículo: ${vOpts.find((v) => v.key === result.query.vehicle_id)?.label || result.query.vehicle_id}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Guard module="relatorios">
      <PageHead title="Relatórios" code="851" sub="Escolha o relatório, ajuste os filtros e gere. Imprima ou salve em PDF pelo botão Imprimir; exporte para Excel." />
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="grid report-layout">
        <div className="card no-print">
          <div className="card-head">
            <h3>Relatórios</h3>
          </div>
          {list.loading && !list.data ? (
            <Loading />
          ) : (
            <div className="report-list">
              {groups.map((g) => (
                <div key={g.name}>
                  <div className="section-title">{g.name}</div>
                  {g.items.map((r) => (
                    <button key={r.key} type="button" className={`report-item ${r.key === key ? 'active' : ''}`} onClick={() => setParams({ r: r.key }, { replace: true })}>
                      <strong>{r.title}</strong>
                      <span className="muted small">{r.description}</span>
                    </button>
                  ))}
                </div>
              ))}
              {!groups.length && <Empty>Nenhum relatório disponível para as suas permissões.</Empty>}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          {!rep ? (
            <div className="card no-print">
              <Empty>Escolha um relatório na lista.</Empty>
            </div>
          ) : (
            <>
              <div className="card no-print">
                <div className="card-head">
                  <h2>{rep.title}</h2>
                </div>
                <div className="card-body">
                  <div className="filters" style={{ margin: 0 }}>
                    {has('period') && (
                      <Field label="Período">
                        <Select value={f.period} onChange={(v) => set('period')(v || 'mes')} options={PERIODS} allowEmpty={false} />
                      </Field>
                    )}
                    {has('period') && f.period === 'custom' && (
                      <>
                        <Field label="De">
                          <input type="date" value={f.from} onChange={set('from')} />
                        </Field>
                        <Field label="Até">
                          <input type="date" value={f.to} onChange={set('to')} />
                        </Field>
                      </>
                    )}
                    {has('vehicle') && (
                      <Field label="Veículo">
                        <Select value={f.vehicle_id} onChange={set('vehicle_id')} options={vOpts} placeholder="Todos" />
                      </Field>
                    )}
                    {has('driver') && (
                      <Field label="Motorista">
                        <Select value={f.driver_id} onChange={set('driver_id')} options={(drivers.data?.drivers || []).map((d) => ({ key: d.id, label: d.full_name }))} placeholder="Todos" />
                      </Field>
                    )}
                    {has('status') && (
                      <Field label="Status">
                        <Select value={f.status} onChange={set('status')} options={VEHICLE_STATUS} placeholder="Ativos" />
                      </Field>
                    )}
                    {has('so_status') && (
                      <Field label="Situação">
                        <Select value={f.status} onChange={set('status')} options={[{ key: 'abertas', label: 'Em aberto' }, ...SERVICE_ORDER_STATUS]} placeholder="Todas" />
                      </Field>
                    )}
                    {has('tire_status') && (
                      <Field label="Situação">
                        <Select value={f.status} onChange={set('status')} options={TIRE_STATUS} placeholder="Todos (exceto descartados)" />
                      </Field>
                    )}
                    {has('maint_type') && (
                      <Field label="Tipo">
                        <Select value={f.type} onChange={set('type')} options={MAINTENANCE_TYPES} placeholder="Todos" />
                      </Field>
                    )}
                    {has('doc_type') && (
                      <Field label="Documento">
                        <Select value={f.type} onChange={set('type')} options={DOCUMENT_TYPES} placeholder="Todos" />
                      </Field>
                    )}
                    {has('doc_state') && (
                      <Field label="Situação">
                        <Select
                          value={f.state}
                          onChange={set('state')}
                          options={[
                            { key: 'atencao', label: 'Vencidos e vencendo' },
                            { key: 'vencidos', label: 'Vencidos' },
                            { key: 'todos', label: 'Todos (com histórico)' },
                          ]}
                          placeholder="Vigentes"
                        />
                      </Field>
                    )}
                    {has('cost_source') && (
                      <Field label="Origem">
                        <Select value={f.source} onChange={set('source')} options={COST_SOURCES} placeholder="Todas" />
                      </Field>
                    )}
                    <div className="field" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn primary" onClick={run} disabled={busy}>
                        <Play size={15} /> {busy ? 'Gerando…' : 'Gerar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {error && <ErrorBox error={error} />}
              {result && (
                <div className="card report-out">
                  <div className="print-only report-print-head">
                    <img src="/logo-escuro.png" alt="Rododimi" />
                    <div>
                      <div className="title">{result.title}</div>
                      <div className="small">{filterText}</div>
                      <div className="small">
                        Gerado em {fmtDateTime(result.generated_at)} por {user.full_name || user.username}
                      </div>
                    </div>
                  </div>
                  <div className="card-head no-print">
                    <h3>
                      {result.rows.length} linha(s){filterText ? <span className="muted small"> · {filterText}</span> : null}
                    </h3>
                    <div className="btn-row" style={{ marginLeft: 'auto' }}>
                      <button type="button" className="btn sm" onClick={() => window.print()}>
                        <Printer size={14} /> Imprimir / PDF
                      </button>
                      {can('relatorios', 'exportar') && (
                        <button type="button" className="btn sm" onClick={excel}>
                          <FileSpreadsheet size={14} /> Excel
                        </button>
                      )}
                    </div>
                  </div>
                  {result.rows.length ? (
                    <div className="table-wrap">
                      <table className="t dense report-table">
                        <thead>
                          <tr>
                            {result.columns.map((c) => (
                              <th key={c.key} className={NUMERIC.includes(c.type) ? 'right' : ''}>
                                {c.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((r) => (
                            <tr key={r.id}>
                              {result.columns.map((c) => (
                                <td key={c.key} className={NUMERIC.includes(c.type) ? 'right num nowrap' : c.key === 'plate' ? 'plate' : ''}>
                                  {fmt(r[c.key], c.type)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                        {Object.keys(result.totals).length > 0 && (
                          <tfoot>
                            <tr>
                              {result.columns.map((c, i) => (
                                <td key={c.key} className={NUMERIC.includes(c.type) ? 'right num nowrap' : ''}>
                                  {c.key in result.totals ? fmt(result.totals[c.key], c.type) : i === 0 ? 'TOTAL' : ''}
                                </td>
                              ))}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  ) : (
                    <Empty>Nenhum registro com esses filtros.</Empty>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Guard>
  );
}
