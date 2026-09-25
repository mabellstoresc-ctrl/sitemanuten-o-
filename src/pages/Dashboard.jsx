import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useFetch, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { PageHead } from '../components/common.jsx';
import { fmtDateTime, fmtMoney, fmtNum } from '../lib/format.js';

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

function Kpi({ label, value, tone, to, small }) {
  const content = (
    <>
      <div className="label">{label}</div>
      <div className="value" style={small ? { fontSize: 20 } : undefined}>{value ?? '—'}</div>
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

      {(data.combustivel_mes || data.ordens_pendentes !== undefined) && (
        <>
          <div className="section-title">Combustível no mês</div>
          <div className="kpis">
            {data.combustivel_mes && (
              <>
                <Kpi label="Gasto com combustível" value={fmtMoney(data.combustivel_mes.total)} to="/abastecimentos" small />
                <Kpi label="Média da frota (km/L)" value={data.combustivel_mes.km_per_liter ? fmtNum(data.combustivel_mes.km_per_liter, 2) : '—'} tone="info" to="/abastecimentos/medias" />
                <Kpi label="Litros" value={fmtNum(data.combustivel_mes.liters, 0)} to="/abastecimentos" />
                <Kpi label="Custo por km" value={data.combustivel_mes.cost_per_km ? fmtMoney(data.combustivel_mes.cost_per_km) : '—'} small />
              </>
            )}
            {data.ordens_pendentes !== undefined && (
              <Kpi label="Ordens de abastecimento pendentes" value={data.ordens_pendentes} tone={data.ordens_pendentes ? 'warn' : ''} to="/abastecimentos/ordens" />
            )}
          </div>
        </>
      )}

      {data.manutencao && (
        <>
          <div className="section-title">Manutenção</div>
          <div className="kpis">
            <Kpi label="Manutenções vencidas" value={data.manutencao.vencidas} tone={data.manutencao.vencidas ? 'danger' : 'ok'} to="/manutencao/calendario" />
            <Kpi label="Manutenções próximas" value={data.manutencao.proximas} tone={data.manutencao.proximas ? 'warn' : ''} to="/manutencao/preventivas" />
            <Kpi label="Trocas de óleo vencidas" value={data.manutencao.oleo_vencidas} tone={data.manutencao.oleo_vencidas ? 'danger' : 'ok'} to="/manutencao/oleo" />
            <Kpi label="Trocas de óleo próximas" value={data.manutencao.oleo_proximas} tone={data.manutencao.oleo_proximas ? 'warn' : ''} to="/manutencao/oleo" />
            <Kpi label="OS em aberto" value={data.manutencao.os_abertas} to="/manutencao/os" />
            <Kpi label="OS atrasadas" value={data.manutencao.os_atrasadas} tone={data.manutencao.os_atrasadas ? 'danger' : ''} to="/manutencao/os" />
            <Kpi label="Gasto com manutenção no mês" value={fmtMoney(data.manutencao.gasto_mes)} small to="/manutencao/preventivas" />
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
        Indicadores de pneus, documentos e custos consolidados entram neste painel nas fases 4 e 5.
      </div>
    </>
  );
}
