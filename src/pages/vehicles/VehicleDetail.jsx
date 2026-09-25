import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Gauge, RefreshCw, UserRound, Link as LinkIcon, Unlink, Trash2, Truck } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { useFetch, Loading, ErrorBox, StatusBadge, Tabs, Dl, DataTable, Empty, useToast, useDialog, Select } from '../../components/ui.jsx';
import { PageHead } from '../../components/common.jsx';
import Attachments, { UploadButton } from '../../components/Attachments.jsx';
import { AlertList } from '../Dashboard.jsx';
import { VehicleFuelSummary, VehicleFuelTab } from '../fuel/VehicleFuel.jsx';
import { VehicleMaintenanceSummary, VehicleMaintenanceTab } from '../maint/VehicleMaintenance.jsx';
import { KmModal, StatusModal, DriverModal, CoupleModal } from './VehicleModals.jsx';
import { fmtKm, fmtDate, fmtDateTime, fmtNum, relative } from '../../lib/format.js';
import { VEHICLE_TYPES, VEHICLE_STATUS, FUEL_TYPES, TOWED_TYPES, TRACTOR_TYPES, labelOf } from '../../../shared/constants.js';

const KM_SOURCES = { manual: 'Manual', cadastro: 'Cadastro', correcao: 'Correção', abastecimento: 'Abastecimento', checklist: 'Checklist', os: 'Ordem de serviço', manutencao: 'Manutenção' };

export function Timeline({ events }) {
  if (!events?.length) return <Empty>Nenhum evento registrado.</Empty>;
  return (
    <ul className="timeline">
      {events.map((e) => (
        <li key={e.id} className={`t-${e.type}`}>
          <div className="when">
            {fmtDate(e.event_at)}
            <br />
            {new Date(e.event_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
          </div>
          <div className="rail" />
          <div className="what">
            <div className="title">{e.title}</div>
            {e.description && <div className="desc">{e.description}</div>}
            <div className="small muted">{e.username || 'sistema'}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const EVENT_TYPES = [
  { key: 'km', label: 'Quilometragem' },
  { key: 'correcao_km', label: 'Correção de KM' },
  { key: 'motorista', label: 'Motorista' },
  { key: 'engate', label: 'Engate' },
  { key: 'status', label: 'Status' },
  { key: 'edicao', label: 'Edição' },
  { key: 'ocorrencia', label: 'Ocorrência' },
  { key: 'cadastro', label: 'Cadastro' },
];

function HistoryTab({ id }) {
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useFetch(`/vehicles/${id}/events${type ? `?type=${type}` : ''}`);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Linha do tempo</h2>
        <Select value={type} onChange={(v) => setType(v || '')} options={EVENT_TYPES} placeholder="Todos os eventos" className="input" style={{ width: 190, height: 32 }} />
      </div>
      <div className="card-body">{loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : <Timeline events={data.events} />}</div>
    </div>
  );
}

function KmTab({ id }) {
  const { data, loading, error, reload } = useFetch(`/vehicles/${id}/km`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data.readings}
      initialSort={null}
      columns={[
        { key: 'reading_at', label: 'Data da leitura', mobile: 'title', render: (r) => fmtDateTime(r.reading_at) },
        { key: 'km', label: 'KM', className: 'right num', render: (r) => fmtKm(r.km) },
        { key: 'diff', label: 'Diferença', className: 'right num', noSort: true, render: (r) => (r.previous_km != null ? `${r.km - r.previous_km >= 0 ? '+' : ''}${fmtNum(r.km - r.previous_km)}` : '—') },
        { key: 'source', label: 'Origem', render: (r) => (r.is_correction ? <span className="badge warn">Correção</span> : KM_SOURCES[r.source] || r.source) },
        { key: 'reason', label: 'Motivo', render: (r) => r.reason || '—' },
        { key: 'username', label: 'Usuário' },
      ]}
      empty="Nenhuma leitura registrada."
    />
  );
}

function DriversTab({ id }) {
  const { data, loading, error, reload } = useFetch(`/vehicles/${id}/assignments`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data.assignments}
      columns={[
        { key: 'driver_name', label: 'Motorista', mobile: 'title', render: (a) => <Link to={`/motoristas/${a.driver_id}`}>{a.driver_name}</Link> },
        { key: 'start_at', label: 'Início', render: (a) => fmtDateTime(a.start_at) },
        { key: 'end_at', label: 'Fim', render: (a) => (a.end_at ? fmtDateTime(a.end_at) : <span className="badge ok">Atual</span>) },
        { key: 'start_km', label: 'KM inicial', className: 'right num', render: (a) => fmtKm(a.start_km) },
        { key: 'end_km', label: 'KM final', className: 'right num', render: (a) => fmtKm(a.end_km) },
        { key: 'notes', label: 'Obs.', render: (a) => a.notes || '—' },
      ]}
      empty="Nenhum motorista vinculado até agora."
    />
  );
}

function CouplingsTab({ id }) {
  const { data, loading, error, reload } = useFetch(`/vehicles/${id}/couplings`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <DataTable
      rows={data.couplings}
      columns={[
        { key: 'tractor_plate', label: 'Cavalo', mobile: 'title', render: (c) => <Link to={`/veiculos/${c.tractor_id}`} className="plate">{c.tractor_plate}</Link> },
        { key: 'trailer_plate', label: 'Implemento', render: (c) => <Link to={`/veiculos/${c.trailer_id}`} className="plate">{c.trailer_plate}</Link> },
        { key: 'start_at', label: 'Engate', render: (c) => fmtDateTime(c.start_at) },
        { key: 'end_at', label: 'Desengate', render: (c) => (c.end_at ? fmtDateTime(c.end_at) : <span className="badge ok">Atual</span>) },
        { key: 'km', label: 'KM rodado', className: 'right num', noSort: true, render: (c) => (c.end_km != null ? fmtKm(c.end_km - c.start_km) : 'em uso') },
      ]}
      empty="Nenhum engate registrado."
    />
  );
}

function Overview({ v, alerts, canEdit, openModal, reload }) {
  const { can } = useAuth();
  const toast = useToast();
  const towed = TOWED_TYPES.includes(v.type);
  const uncouple = async (t) => {
    try {
      await api(`/vehicles/${v.id}/uncouple`, { method: 'POST', body: { trailer_id: t.id } });
      toast('Implemento desengatado.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <>
      <div className="grid g3">
        {!towed && (
          <div className="card">
            <div className="card-head">
              <h3>Motorista atual</h3>
              {canEdit && (
                <button type="button" className="btn sm" onClick={() => openModal('driver')}>
                  <UserRound size={14} /> {v.driver_id ? 'Trocar' : 'Vincular'}
                </button>
              )}
            </div>
            <div className="card-body">
              {v.driver_id ? (
                <>
                  <Link to={`/motoristas/${v.driver_id}`} style={{ fontSize: 16, fontWeight: 700 }}>
                    {v.driver_name}
                  </Link>
                  <div className="muted small">desde {fmtDateTime(v.driver_since)}</div>
                </>
              ) : (
                <span className="muted">Sem motorista vinculado</span>
              )}
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h3>{towed ? 'Engatado em' : 'Implementos engatados'}</h3>
            {canEdit && !towed && TRACTOR_TYPES.includes(v.type) && (
              <button type="button" className="btn sm" onClick={() => openModal('couple')}>
                <LinkIcon size={14} /> Engatar
              </button>
            )}
          </div>
          <div className="card-body">
            {towed ? (
              v.tractor ? (
                <>
                  <Link to={`/veiculos/${v.tractor.id}`} className="plate" style={{ fontSize: 16 }}>
                    {v.tractor.plate}
                  </Link>
                  <div className="muted small">desde {fmtDateTime(v.tractor.since)}</div>
                </>
              ) : (
                <span className="muted">Não engatado</span>
              )
            ) : v.trailers?.length ? (
              v.trailers.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Link to={`/veiculos/${t.id}`} className="plate">
                    {t.plate}
                  </Link>
                  <span className="muted small">{labelOf(VEHICLE_TYPES, t.type)}</span>
                  {canEdit && (
                    <button type="button" className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => uncouple(t)} title="Desengatar">
                      <Unlink size={14} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <span className="muted">{TRACTOR_TYPES.includes(v.type) ? 'Nenhum implemento engatado' : 'Não se aplica a este tipo'}</span>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Quilometragem</h3>
            {canEdit && !towed && (
              <button type="button" className="btn sm" onClick={() => openModal('km')}>
                <Gauge size={14} /> Atualizar
              </button>
            )}
          </div>
          <div className="card-body">
            {towed ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700 }} className="num">
                  {fmtKm(v.towed_km)}
                </div>
                <div className="muted small">rodados engatado (calculado pelo KM dos cavalos)</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 700 }} className="num">
                  {fmtKm(v.current_km)}
                </div>
                <div className="muted small">
                  {v.last_km_reading ? `Atualizado ${relative(v.last_km_reading.reading_at)} por ${v.last_km_reading.username || 'sistema'}` : 'Nenhuma leitura registrada'}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <VehicleMaintenanceSummary vehicle={v} />
      {!towed && (can('abastecimentos') || can('veiculos')) && <VehicleFuelSummary vehicle={v} compact />}

      {alerts.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Alertas deste veículo</h3>
          </div>
          <AlertList alerts={alerts} />
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Dados cadastrais</h3>
        </div>
        <div className="card-body">
          <Dl
            items={[
              ['Placa', v.plate],
              ['Nº da frota', v.fleet_number],
              ['Tipo', labelOf(VEHICLE_TYPES, v.type)],
              ['Marca', v.brand],
              ['Modelo', v.model],
              ['Ano fab./modelo', v.year_manufacture ? `${v.year_manufacture}/${v.year_model || ''}` : null],
              ['Chassi', v.chassis],
              ['RENAVAM', v.renavam],
              ['Combustível', labelOf(FUEL_TYPES, v.fuel_type)],
              !towed && ['Tanque', v.tank_capacity ? `${fmtNum(v.tank_capacity)} L` : null],
              ['Eixos', v.axle_config],
              ['Aquisição', fmtDate(v.acquisition_date)],
              ['Cadastrado em', fmtDateTime(v.created_at)],
            ]}
          />
          {v.notes && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">OBSERVAÇÕES</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>
            </div>
          )}
        </div>
      </div>

      {!towed && (
        <div className="notice info" style={{ marginTop: 12 }}>
          Pneus instalados e custos consolidados aparecerão aqui quando os módulos das próximas fases forem liberados.
        </div>
      )}
    </>
  );
}

function SoonTab({ phase, what }) {
  return (
    <div className="card soon-box">
      <h2>Disponível na fase {phase}</h2>
      <p>{what}</p>
    </div>
  );
}

export default function VehicleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'geral';
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(`/vehicles/${id}`);
  const alertsReq = useFetch('/alerts');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const v = data.vehicle;
  const towed = TOWED_TYPES.includes(v.type);
  const canEdit = can('veiculos', 'editar') && v.status !== 'inativo';
  const vehicleAlerts = (alertsReq.data?.alerts || []).filter(
    (a) => a.link === `/veiculos/${v.id}` || (v.driver_id && a.link === `/motoristas/${v.driver_id}`),
  );

  const saved = () => {
    setModal(null);
    reload();
    alertsReq.reload();
  };

  const remove = async () => {
    const reason = await dialog.prompt({
      title: 'Excluir veículo',
      message: `Excluir definitivamente ${v.plate}? Use apenas para cadastro feito por engano. Para veículos vendidos ou baixados, use "Inativar" no status.`,
      label: 'Motivo da exclusão',
      required: true,
      minLength: 5,
      danger: true,
      confirmLabel: 'Excluir',
    });
    if (!reason) return;
    try {
      await api(`/vehicles/${v.id}`, { method: 'DELETE', body: { reason } });
      toast('Veículo excluído.');
      navigate(towed ? '/implementos' : '/veiculos', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const tabs = [
    { key: 'geral', label: 'Visão geral' },
    !towed && { key: 'abastecimentos', label: 'Abastecimentos' },
    { key: 'manutencoes', label: 'Manutenções' },
    { key: 'pneus', label: 'Pneus', soon: 4 },
    !towed && { key: 'motoristas', label: 'Motoristas' },
    { key: 'engates', label: 'Engates' },
    { key: 'documentos', label: 'Documentos' },
    { key: 'custos', label: 'Custos', soon: 5 },
    !towed && { key: 'km', label: 'Quilometragem' },
    { key: 'historico', label: 'Histórico' },
  ].filter(Boolean);

  return (
    <>
      <PageHead title="" back={towed ? '/implementos' : '/veiculos'}>
        <div className="btn-row">
          {canEdit && !towed && (
            <button type="button" className="btn" onClick={() => setModal('km')}>
              <Gauge size={15} /> Atualizar KM
            </button>
          )}
          {can('veiculos', 'editar') && (
            <button type="button" className="btn" onClick={() => setModal('status')}>
              <RefreshCw size={15} /> Status
            </button>
          )}
          {can('veiculos', 'editar') && (
            <Link to={`/veiculos/${v.id}/editar`} className="btn">
              <Pencil size={15} /> Editar
            </Link>
          )}
          {can('veiculos', 'excluir') && (
            <button type="button" className="btn danger icon" onClick={remove} title="Excluir cadastro">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </PageHead>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body vehicle-head">
          <div className="vehicle-photo">{v.photo_id ? <img src={`/api/files/${v.photo_id}`} alt={`Foto ${v.plate}`} /> : <Truck size={48} />}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="big-plate">{v.plate}</span>
              <StatusBadge list={VEHICLE_STATUS} value={v.status} />
              {v.fleet_number && <span className="badge muted">Frota {v.fleet_number}</span>}
            </div>
            <div style={{ fontSize: 15, marginTop: 2 }}>
              {labelOf(VEHICLE_TYPES, v.type)} · {[v.brand, v.model].filter(Boolean).join(' ') || 'Modelo não informado'}
              {v.year_manufacture ? ` · ${v.year_manufacture}/${v.year_model || ''}` : ''}
            </div>
            <div className="stat-line">
              {!towed && (
                <div className="s">
                  <div className="k">KM atual</div>
                  <div className="v">{fmtKm(v.current_km)}</div>
                </div>
              )}
              {!towed && (
                <div className="s">
                  <div className="k">Motorista</div>
                  <div className="v" style={{ fontSize: 15 }}>
                    {v.driver_name || '—'}
                  </div>
                </div>
              )}
              <div className="s">
                <div className="k">{towed ? 'Cavalo' : 'Implementos'}</div>
                <div className="v plate" style={{ fontSize: 15 }}>
                  {towed ? v.tractor?.plate || '—' : v.trailers?.map((t) => t.plate).join(', ') || '—'}
                </div>
              </div>
              <div className="s">
                <div className="k">Alertas</div>
                <div className="v" style={{ color: vehicleAlerts.some((a) => a.level === 'urgente') ? 'var(--danger)' : undefined }}>{vehicleAlerts.length}</div>
              </div>
            </div>
            {canEdit && (
              <div style={{ marginTop: 10 }}>
                <UploadButton
                  entity="vehicle"
                  entityId={v.id}
                  category="foto"
                  accept="image/*"
                  label={v.photo_id ? 'Trocar foto' : 'Adicionar foto'}
                  className="btn sm"
                  onUploaded={reload}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(k) => setParams({ aba: k }, { replace: true })} />

      {tab === 'geral' && <Overview v={v} alerts={vehicleAlerts} canEdit={canEdit} openModal={setModal} reload={reload} />}
      {tab === 'abastecimentos' && <VehicleFuelTab vehicle={v} />}
      {tab === 'manutencoes' && <VehicleMaintenanceTab vehicle={v} />}
      {tab === 'pneus' && <SoonTab phase={4} what="Mapa visual dos eixos com os pneus instalados, movimentações e recapagens." />}
      {tab === 'custos' && <SoonTab phase={5} what="Custos do mês, do ano, por KM e total do veículo, por categoria." />}
      {tab === 'motoristas' && <DriversTab id={v.id} />}
      {tab === 'engates' && <CouplingsTab id={v.id} />}
      {tab === 'documentos' && <Attachments entity="vehicle" entityId={v.id} canEdit={canEdit} />}
      {tab === 'km' && <KmTab id={v.id} key={v.current_km} />}
      {tab === 'historico' && <HistoryTab id={v.id} key={v.updated_at} />}

      {modal === 'km' && <KmModal vehicle={v} onClose={() => setModal(null)} onSaved={saved} />}
      {modal === 'status' && <StatusModal vehicle={v} onClose={() => setModal(null)} onSaved={saved} />}
      {modal === 'driver' && <DriverModal vehicle={v} onClose={() => setModal(null)} onSaved={saved} />}
      {modal === 'couple' && <CoupleModal vehicle={v} onClose={() => setModal(null)} onSaved={saved} />}
      {v.status === 'inativo' && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          Veículo inativo: para voltar a operar, altere o status.
        </div>
      )}
    </>
  );
}
