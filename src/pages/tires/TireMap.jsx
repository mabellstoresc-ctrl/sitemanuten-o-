import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { useFetch, Loading, ErrorBox, Dl, StatusBadge } from '../../components/ui.jsx';
import { fmtKm, fmtDate, fmtNum, fmtDateTime } from '../../lib/format.js';
import { TIRE_STATUS } from '../../../shared/constants.js';
import { MoveModal, InspectModal, InstallPickModal } from './TireModals.jsx';

function TireBox({ p, selected, onClick }) {
  const t = p.tire;
  const cls = ['tbox', t ? 'filled' : 'empty', selected ? 'sel' : '', t?.attention?.length ? 'warn' : ''].join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} title={`${p.label}${t ? ` — ${t.code}` : ' — vazia'}`}>
      {t ? (
        <>
          <span className="tcode">{t.code}</span>
          <span className="tkm">{fmtNum(Math.round(t.total_km / 1000))} mil km</span>
        </>
      ) : (
        <span className="tplus">+</span>
      )}
    </button>
  );
}

/** Mapa visual dos eixos de um veículo, com ações ao clicar em cada posição. */
export default function TireMap({ vehicleId, compact = false }) {
  const { can } = useAuth();
  const { data, loading, error, reload } = useFetch(`/vehicles/${vehicleId}/tires`);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { positions, layout, vehicle, orphans } = data;
  const selected = positions.find((p) => p.code === sel);
  const canEdit = can('pneus', 'editar') && vehicle.status !== 'inativo';
  const done = () => {
    setModal(null);
    reload();
  };

  const axles = layout.axles.map((a, i) => ({ ...a, n: i + 1, pos: positions.filter((p) => p.axle === i + 1) }));
  const spares = positions.filter((p) => p.spare);
  const box = (p) => <TireBox key={p.code} p={p} selected={sel === p.code} onClick={() => setSel(sel === p.code ? null : p.code)} />;

  return (
    <div className={`tire-map-wrap ${compact ? 'compact' : ''}`}>
      <div className="tire-map">
        <div className="tm-head">{layout.label} · frente ↑</div>
        {axles.map((a) => {
          const left = a.pos.filter((p) => p.side.startsWith('E'));
          const right = a.pos.filter((p) => p.side.startsWith('D'));
          return (
            <div key={a.n} className="axle">
              <div className="side left">{left.map(box)}</div>
              <div className="bar">
                <span>{a.name}</span>
              </div>
              <div className="side right">{right.map(box)}</div>
            </div>
          );
        })}
        {spares.length > 0 && (
          <div className="spares">
            <span className="muted small">Estepe</span>
            {spares.map(box)}
          </div>
        )}
        <div className="tm-legend small muted">
          <span className="lg lg-filled" /> instalado <span className="lg lg-warn" /> precisa de atenção <span className="lg lg-empty" /> vazio
        </div>
      </div>

      <div className="tire-panel">
        {!selected ? (
          <div className="muted">Clique em uma posição para ver o pneu{canEdit ? ' ou instalar um' : ''}.</div>
        ) : !selected.tire ? (
          <>
            <h3>{selected.label}</h3>
            <p className="muted">Posição vazia.</p>
            {canEdit && (
              <button type="button" className="btn primary" onClick={() => setModal({ kind: 'install' })}>
                Instalar pneu aqui
              </button>
            )}
          </>
        ) : (
          <>
            <h3>
              <Link to={`/pneus/${selected.tire.id}`}>Pneu {selected.tire.code}</Link>
            </h3>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {selected.label}
            </div>
            <Dl
              items={[
                ['Nº de fogo', selected.tire.fire_number],
                ['Marca / modelo', [selected.tire.brand, selected.tire.model].filter(Boolean).join(' ')],
                ['Medida', selected.tire.size],
                ['KM total', fmtKm(selected.tire.total_km)],
                ['Nesta instalação', fmtKm(selected.tire.current_install_km)],
                ['Instalado em', fmtDateTime(selected.tire.installed_at)],
                ['Vida útil', selected.tire.life_pct !== null ? `${fmtNum(selected.tire.life_pct, 0)}%` : null],
                ['Recapagens', selected.tire.retread_count],
                ['Sulco', selected.tire.tread_depth_mm !== null ? `${fmtNum(selected.tire.tread_depth_mm, 1)} mm` : null],
                ['Última inspeção', selected.tire.last_inspection_on ? fmtDate(selected.tire.last_inspection_on) : 'nunca'],
              ]}
            />
            {selected.tire.attention?.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}>Atenção: {selected.tire.attention.join(', ')}</div>}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <Link to={`/pneus/${selected.tire.id}`} className="btn sm">
                Histórico
              </Link>
              {canEdit && (
                <>
                  <button type="button" className="btn sm primary" onClick={() => setModal({ kind: 'move', tire: selected.tire })}>
                    Mover pneu
                  </button>
                  <button type="button" className="btn sm" onClick={() => setModal({ kind: 'inspect', tire: selected.tire })}>
                    Inspecionar
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {orphans.length > 0 && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            Pneus em posições que não existem na configuração atual de eixos: {orphans.map((t) => `${t.code} (${t.position})`).join(', ')}. Mova-os para uma posição válida.
          </div>
        )}
        <div className="small muted" style={{ marginTop: 12 }}>
          {positions.filter((p) => p.tire).length} de {positions.length} posições ocupadas · <StatusBadge list={TIRE_STATUS} value="em_uso" />
        </div>
      </div>

      {modal?.kind === 'install' && (
        <InstallPickModal vehicle={vehicle} position={selected.code} positionLabel={selected.label} onClose={() => setModal(null)} onDone={done} />
      )}
      {modal?.kind === 'move' && <MoveModal tire={modal.tire} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'inspect' && <InspectModal tire={modal.tire} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
