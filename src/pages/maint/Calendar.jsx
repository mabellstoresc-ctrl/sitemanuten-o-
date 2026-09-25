import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { qs } from '../../api.js';
import { useFetch, Loading, ErrorBox, Empty } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDate, todayISO } from '../../lib/format.js';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(new Date(`${s}T12:00:00Z`).getTime() + n * 864e5));

const FILTERS = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Esta semana' },
  { key: 'mes', label: 'Este mês' },
  { key: 'atrasadas', label: 'Atrasadas' },
  { key: 'proximas', label: 'Próximas (30 dias)' },
];

function itemLink(i) {
  if (i.kind === 'os') return `/manutencao/os/${i.service_order_id}`;
  if (i.maintenance_id) return `/manutencao/${i.maintenance_id}`;
  return `/veiculos/${i.vehicle_id}?aba=manutencoes`;
}

const STATE_LABEL = { vencida: 'Atrasada', proxima: 'Próxima', ok: 'Programada', realizada: 'Realizada' };
const STATE_TONE = { vencida: 'danger', proxima: 'warn', ok: 'info', realizada: 'ok' };

export default function Calendar() {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [filter, setFilter] = useState('mes');

  // Grade do mês (domingo a sábado)
  const grid = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00Z`);
    const start = addDays(iso(first), -first.getUTCDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);
  const range = { from: grid[0] < addDays(today, -1) ? grid[0] : addDays(today, -1), to: grid[41] > addDays(today, 30) ? grid[41] : addDays(today, 30) };
  const { data, loading, error, reload } = useFetch(`/maintenance/calendar${qs(range)}`);
  const items = data?.items || [];

  const weekEnd = addDays(today, 6 - new Date(`${today}T12:00:00Z`).getUTCDay());
  const list = items.filter((i) => {
    const pending = i.state !== 'realizada';
    switch (filter) {
      case 'hoje':
        return i.date === today || (pending && i.state === 'vencida' && !i.date);
      case 'semana':
        return i.date && i.date >= today && i.date <= weekEnd;
      case 'mes':
        return i.date && i.date.slice(0, 7) === today.slice(0, 7);
      case 'atrasadas':
        return i.state === 'vencida';
      case 'proximas':
        return pending && i.state !== 'vencida' && i.date && i.date >= today && i.date <= addDays(today, 30);
      default:
        return true;
    }
  });

  const shift = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(iso(d).slice(0, 7));
  };

  return (
    <Guard module="manutencoes">
      <PageHead title="Calendário de manutenção" code="405" sub="Manutenções programadas por data e por KM (a data pelo KM é estimada pelo ritmo de rodagem dos últimos 90 dias), OS com previsão e manutenções realizadas." />
      {error && <ErrorBox error={error} onRetry={reload} />}

      <div className="btn-row" style={{ marginBottom: 10 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`btn sm ${filter === f.key ? 'primary' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key === 'atrasadas' && items.filter((i) => i.state === 'vencida').length > 0 && (
              <span className="badge danger" style={{ marginLeft: 4 }}>
                {items.filter((i) => i.state === 'vencida').length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <h2>{FILTERS.find((f) => f.key === filter).label}</h2>
        </div>
        {loading && !data ? (
          <Loading />
        ) : list.length ? (
          <div className="alerts">
            {list.map((i, n) => (
              <Link key={n} to={itemLink(i)} className={`alert-row ${i.state === 'vencida' ? 'urgente' : i.state === 'proxima' ? 'atencao' : 'info'}`}>
                <span className="lvl" />
                <span className="nowrap small muted" style={{ width: 84 }}>
                  {i.date ? fmtDate(i.date) : 'sem data'}
                </span>
                <span className="plate">{i.plate}</span>
                <span style={{ flex: 1 }}>
                  <strong>{i.title}</strong>
                  {i.detail && <span className="muted small"> · {i.detail}</span>}
                  {i.kind === 'plano' && i.by === 'km' && i.date && <span className="muted small"> · data estimada pelo KM</span>}
                </span>
                <span className={`badge ${STATE_TONE[i.state]}`}>{STATE_LABEL[i.state]}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>Nada neste filtro.</Empty>
        )}
      </div>

      <div className="card cal-wrap">
        <div className="card-head">
          <button type="button" className="btn sm ghost" onClick={() => shift(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <h2 style={{ marginRight: 0 }}>
            {MONTHS[Number(month.slice(5)) - 1]} de {month.slice(0, 4)}
          </h2>
          <button type="button" className="btn sm ghost" onClick={() => shift(1)} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setMonth(today.slice(0, 7))}>
            Hoje
          </button>
        </div>
        <div className="cal">
          {DOW.map((d) => (
            <div key={d} className="dow">
              {d}
            </div>
          ))}
          {grid.map((d) => {
            const dayItems = items.filter((i) => i.date === d);
            return (
              <div key={d} className={`day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''}`}>
                <div className="n">{Number(d.slice(8))}</div>
                {dayItems.slice(0, 4).map((i, n) => (
                  <Link key={n} to={itemLink(i)} className={`ev ${i.state}`} title={`${i.plate} — ${i.title}${i.detail ? ` · ${i.detail}` : ''}`}>
                    {i.plate} {i.title}
                  </Link>
                ))}
                {dayItems.length > 4 && <div className="muted">+{dayItems.length - 4}</div>}
              </div>
            );
          })}
        </div>
        <div className="table-foot">
          <span className="badge danger">Atrasada</span>
          <span className="badge warn">Próxima</span>
          <span className="badge info">Programada</span>
          <span className="badge ok">Realizada</span>
        </div>
      </div>
    </Guard>
  );
}
