import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useFetch, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { PageHead } from '../components/common.jsx';
import { fmtDateTime } from '../lib/format.js';

export function AlertList({ alerts, limit }) {
  if (!alerts?.length) return <Empty>Nenhum alerta no momento.</Empty>;
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <div className="alerts">
      {shown.map((a, i) => (
        <Link key={i} to={a.link || '#'} className={`alert-row ${a.level}`}>
          <span className="lvl" />
          <span style={{ flex: 1 }}>{a.title}</span>
          <span className={`badge ${a.level === 'urgente' ? 'danger' : a.level === 'atencao' ? 'warn' : 'info'}`}>
            {a.level === 'urgente' ? 'Urgente' : a.level === 'atencao' ? 'Atenção' : 'Info'}
          </span>
        </Link>
      ))}
      {limit && alerts.length > limit && (
        <Link to="/alertas" className="alert-row">
          <span className="lvl" />
          Ver todos os {alerts.length} alertas →
        </Link>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, to }) {
  const content = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
    </>
  );
  return to ? (
    <Link to={to} className={`kpi ${tone || ''}`}>
      {content}
    </Link>
  ) : (
    <div className={`kpi ${tone || ''}`}>{content}</div>
  );
}

export default function Dashboard() {
  const { can, user } = useAuth();
  const { data, loading, error, reload } = useFetch('/dashboard');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const f = data.frota;
  const imp = data.implementos;

  return (
    <>
      <PageHead title="Painel" code="001" sub={`Olá, ${user.full_name.split(' ')[0]}. Resumo da frota em tempo real.`}>
        <button type="button" className="btn" onClick={reload}>
          Atualizar
        </button>
      </PageHead>

      {can('veiculos') && (
        <>
          <div className="section-title">Frota (veículos com motor)</div>
          <div className="kpis">
            <Kpi label="Total de veículos" value={f.total} to="/veiculos" />
            <Kpi label="Disponíveis" value={f.disponivel} tone="ok" to="/veiculos?status=disponivel" />
            <Kpi label="Em viagem" value={f.em_viagem} tone="info" to="/veiculos?status=em_viagem" />
            <Kpi label="Em manutenção" value={f.em_manutencao} tone="warn" to="/veiculos?status=em_manutencao" />
            <Kpi label="Parados" value={f.parado} to="/veiculos?status=parado" />
            <Kpi label="Implementos / carretas" value={imp.total} to="/implementos" />
          </div>
        </>
      )}

      <div className="section-title">Motoristas e alertas</div>
      <div className="kpis">
        {can('motoristas') && (
          <>
            <Kpi label="Motoristas ativos" value={data.motoristas.ativos} to="/motoristas" />
            <Kpi label="Sem veículo" value={data.motoristas.sem_veiculo} />
            <Kpi label="Férias / afastados" value={data.motoristas.ausentes} />
            <Kpi label="CNHs vencendo/vencidas" value={data.cnh_alertas} tone={data.cnh_alertas ? 'danger' : 'ok'} to="/alertas" />
          </>
        )}
        {data.login_falhas_24h !== undefined && (
          <Kpi label="Falhas de login (24h)" value={data.login_falhas_24h} tone={data.login_falhas_24h > 5 ? 'danger' : ''} to="/admin/acessos" />
        )}
      </div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-head">
            <h2>Alertas</h2>
            <Link to="/alertas" className="small">
              Ver todos
            </Link>
          </div>
          <AlertList alerts={data.alerts} limit={10} />
        </div>
        {data.recent && (
          <div className="card">
            <div className="card-head">
              <h2>Últimas movimentações</h2>
            </div>
            {data.recent.length ? (
              <div className="table-wrap">
                <table className="t">
                  <tbody>
                    {data.recent.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap small muted">{fmtDateTime(e.event_at)}</td>
                        <td>
                          <Link to={`/veiculos/${e.vehicle_id}`} className="plate">
                            {e.plate}
                          </Link>
                        </td>
                        <td>
                          <strong>{e.title}</strong>
                          {e.description && <div className="small muted">{e.description}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nenhuma movimentação ainda.</Empty>
            )}
          </div>
        )}
      </div>

      <div className="notice info" style={{ marginTop: 12 }}>
        Indicadores de combustível, manutenção, troca de óleo, pneus, documentos e custos entram neste painel conforme cada módulo for liberado
        (fases 2 a 5).
      </div>
    </>
  );
}
