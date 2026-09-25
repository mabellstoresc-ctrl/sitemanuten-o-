import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import BarChart from '../../components/BarChart.jsx';
import { fmtNum, fmtMoney, fmtDate, todayISO } from '../../lib/format.js';
import { TOWED_TYPES } from '../../../shared/constants.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const periodLabel = (p) => (p.length === 7 ? `${MONTHS[Number(p.slice(5)) - 1]}/${p.slice(2, 4)}` : p);
const kml = (v) => (v === null || v === undefined ? '—' : fmtNum(v, 2));

function shiftDate(iso, { months = 0, years = 0 }) {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Gráfico de média mensal/anual + tabela com os números (a tabela é a versão acessível do gráfico). */
export function ConsumptionChart({ vehicleId, defaultGroup = 'month' }) {
  const [group, setGroup] = useState(defaultGroup);
  const from = group === 'month' ? shiftDate(todayISO(), { months: -11 }).slice(0, 8) + '01' : '';
  const { data, loading, error, reload } = useFetch(`/fuel/series${qs({ vehicle_id: vehicleId, group, from })}`);
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Média de consumo {group === 'month' ? 'mensal (últimos 12 meses)' : 'anual'} — km/L</h3>
        <div className="btn-row">
          <button type="button" className={`btn sm ${group === 'month' ? 'primary' : ''}`} onClick={() => setGroup('month')}>
            Mensal
          </button>
          <button type="button" className={`btn sm ${group === 'year' ? 'primary' : ''}`} onClick={() => setGroup('year')}>
            Anual
          </button>
          <button type="button" className="btn sm ghost" onClick={() => setShowTable((s) => !s)}>
            {showTable ? 'Ocultar tabela' : 'Ver tabela'}
          </button>
        </div>
      </div>
      <div className="card-body">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : (
          <>
            <BarChart
              ariaLabel="Média de consumo em km/L por período"
              data={data.series.map((s) => ({
                label: periodLabel(s.period),
                value: s.km_per_liter,
                extra: `${fmtNum(s.liters, 0)} L · ${fmtMoney(s.total)}`,
              }))}
              format={(v, axis) => (axis ? fmtNum(v, v % 1 ? 1 : 0) : fmtNum(v, 2))}
            />
            {showTable && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th className="right">Média km/L</th>
                      <th className="right">KM</th>
                      <th className="right">Litros</th>
                      <th className="right">Valor</th>
                      <th className="right">Custo/km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((s) => (
                      <tr key={s.period}>
                        <td>{periodLabel(s.period)}</td>
                        <td className="right num">{kml(s.km_per_liter)}</td>
                        <td className="right num">{fmtNum(s.distance)}</td>
                        <td className="right num">{fmtNum(s.liters, 0)}</td>
                        <td className="right num">{fmtMoney(s.total)}</td>
                        <td className="right num">{s.cost_per_km ? fmtMoney(s.cost_per_km) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Média por abastecimento (últimos 20 com média). */
export function PerFuelingChart({ vehicleId }) {
  const { data, loading } = useFetch(`/fuelings${qs({ vehicle_id: vehicleId, limit: 60 })}`);
  if (loading && !data) return <Loading />;
  const rows = (data?.fuelings || []).filter((f) => f.km_per_liter).slice(0, 20).reverse();
  return (
    <div className="card">
      <div className="card-head">
        <h3>Média por abastecimento (últimos {rows.length}) — km/L</h3>
      </div>
      <div className="card-body">
        <BarChart
          ariaLabel="Média por abastecimento"
          data={rows.map((f) => ({ label: fmtDate(f.fueled_at).slice(0, 5), value: f.km_per_liter, extra: `${fmtNum(f.distance)} km · ${fmtNum(f.liters, 0)} L` }))}
          format={(v, axis) => (axis ? fmtNum(v, v % 1 ? 1 : 0) : fmtNum(v, 2))}
          height={190}
        />
      </div>
    </div>
  );
}

function ComparePeriods({ vehicleId }) {
  const today = todayISO();
  const firstOfMonth = today.slice(0, 8) + '01';
  const lastOfPrev = new Date(new Date(`${firstOfMonth}T12:00:00`).getTime() - 864e5).toISOString().slice(0, 10);
  const [a, setA] = useState({ from: shiftDate(firstOfMonth, { months: -1 }), to: lastOfPrev });
  const [b, setB] = useState({ from: firstOfMonth, to: today });
  const ra = useFetch(`/fuel/averages${qs({ vehicle_id: vehicleId, ...a })}`);
  const rb = useFetch(`/fuel/averages${qs({ vehicle_id: vehicleId, ...b })}`);
  const A = ra.data?.fleet;
  const B = rb.data?.fleet;
  const delta = A?.km_per_liter && B?.km_per_liter ? (B.km_per_liter / A.km_per_liter - 1) * 100 : null;
  const box = (label, p, setP, r) => (
    <div className="card">
      <div className="card-body">
        <div className="section-title" style={{ marginTop: 0 }}>
          {label}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="De">
            <input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
          </Field>
          <Field label="Até">
            <input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
          </Field>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }} className="num">
          {kml(r?.km_per_liter)} <span className="small muted">km/L</span>
        </div>
        <div className="small muted">
          {r ? `${fmtNum(r.distance)} km · ${fmtNum(r.liters, 0)} L · ${fmtMoney(r.total)}` : '—'}
        </div>
      </div>
    </div>
  );
  return (
    <div className="card">
      <div className="card-head">
        <h3>Comparar períodos {vehicleId ? '' : '(frota inteira)'}</h3>
      </div>
      <div className="card-body compare">
        {box('Período A', a, setA, A)}
        {box('Período B', b, setB, B)}
        <div style={{ textAlign: 'center', padding: 10 }}>
          <div className="small muted">Variação B × A</div>
          <div className={`num delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`} style={{ fontSize: 26, fontWeight: 800 }}>
            {delta === null ? '—' : `${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}${fmtNum(delta, 1)}%`}
          </div>
          <div className="small muted">{delta > 0 ? 'consumo melhorou' : delta < 0 ? 'consumo piorou' : ''}</div>
        </div>
      </div>
    </div>
  );
}

export default function FuelAverages() {
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const vehicleId = params.get('veiculo') || '';
  const from = params.get('de') || shiftDate(today, { months: -2 }).slice(0, 8) + '01';
  const to = params.get('ate') || today;
  const setP = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const vehicles = useFetch('/vehicles/options?all=1');
  const { data, loading, error, reload } = useFetch(`/fuel/averages${qs({ from, to })}`);

  return (
    <Guard module="abastecimentos">
      <PageHead title="Médias de consumo" code="304" sub="Média = KM rodados entre tanques cheios ÷ litros abastecidos. A data considerada é a do abastecimento que fecha o ciclo." />
      <div className="filters">
        <Field label="De">
          <input type="date" value={from} onChange={(e) => setP('de', e.target.value)} />
        </Field>
        <Field label="Até">
          <input type="date" value={to} onChange={(e) => setP('ate', e.target.value)} />
        </Field>
        <Field label="Veículo (gráficos)">
          <Select
            value={vehicleId}
            onChange={(v) => setP('veiculo', v)}
            options={(vehicles.data?.vehicles || []).filter((v) => !TOWED_TYPES.includes(v.type)).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · ${v.fleet_number}` : ''}` }))}
            placeholder="Frota inteira"
          />
        </Field>
      </div>

      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <div className="kpi info">
              <div className="label">Média da frota no período</div>
              <div className="value">{kml(data.fleet.km_per_liter)} <span className="small muted">km/L</span></div>
            </div>
            <div className="kpi">
              <div className="label">Litros</div>
              <div className="value">{fmtNum(data.fleet.liters, 0)}</div>
            </div>
            <div className="kpi">
              <div className="label">Valor em combustível</div>
              <div className="value" style={{ fontSize: 20 }}>{fmtMoney(data.fleet.total)}</div>
            </div>
            <div className="kpi">
              <div className="label">Custo por km</div>
              <div className="value" style={{ fontSize: 20 }}>{data.fleet.cost_per_km ? fmtMoney(data.fleet.cost_per_km) : '—'}</div>
            </div>
          </div>

          <div className="section-title">Comparativo entre veículos</div>
          <DataTable
            rowKey="vehicle_id"
            rows={data.vehicles}
            columns={[
              { key: 'plate', label: 'Veículo', mobile: 'title', render: (v) => (
                <button type="button" className="linklike plate" onClick={() => setP('veiculo', v.vehicle_id)} title="Ver gráficos deste veículo">
                  {v.plate}
                </button>
              ) },
              { key: 'fleet_number', label: 'Frota', render: (v) => v.fleet_number || '—' },
              { key: 'model', label: 'Modelo', mobile: false, render: (v) => [v.brand, v.model].filter(Boolean).join(' ') || '—' },
              { key: 'km_per_liter', label: 'Média período', className: 'right num', render: (v) => <strong>{kml(v.km_per_liter)}</strong> },
              { key: 'overall_km_per_liter', label: 'Média geral', className: 'right num', render: (v) => kml(v.overall_km_per_liter) },
              {
                key: 'var',
                label: 'Variação',
                className: 'right num',
                sort: (v) => (v.km_per_liter && v.overall_km_per_liter ? v.km_per_liter / v.overall_km_per_liter : null),
                render: (v) => {
                  if (!v.km_per_liter || !v.overall_km_per_liter) return '—';
                  const d = (v.km_per_liter / v.overall_km_per_liter - 1) * 100;
                  return <span className={`delta ${d > 0.5 ? 'up' : d < -0.5 ? 'down' : ''}`}>{`${d > 0 ? '+' : ''}${fmtNum(d, 1)}%`}</span>;
                },
              },
              { key: 'distance', label: 'KM', className: 'right num', render: (v) => fmtNum(v.distance) },
              { key: 'liters', label: 'Litros', className: 'right num', render: (v) => fmtNum(v.liters, 0) },
              { key: 'total', label: 'Valor', className: 'right num nowrap', render: (v) => fmtMoney(v.total) },
              { key: 'cost_per_km', label: 'Custo/km', className: 'right num', render: (v) => (v.cost_per_km ? fmtMoney(v.cost_per_km) : '—') },
              { key: 'link', label: '', noSort: true, mobile: false, render: (v) => <Link to={`/abastecimentos?veiculo=${v.vehicle_id}&de=${from}&ate=${to}`}>abastecimentos</Link> },
            ]}
            empty="Nenhum abastecimento no período."
          />

          <div className="section-title">{vehicleId ? `Gráficos — ${vehicles.data?.vehicles.find((v) => v.id === vehicleId)?.plate || ''}` : 'Gráficos — frota inteira'}</div>
          <ConsumptionChart vehicleId={vehicleId} key={vehicleId} />
          {vehicleId && <PerFuelingChart vehicleId={vehicleId} key={`pf-${vehicleId}`} />}
          <ComparePeriods vehicleId={vehicleId} key={`cp-${vehicleId}`} />
        </>
      )}
    </Guard>
  );
}
