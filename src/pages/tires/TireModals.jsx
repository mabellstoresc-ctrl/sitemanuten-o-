import { useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { api, qs } from '../../api.js';
import { Modal, Field, Select, DecimalInput, useFetch, useToast, Loading } from '../../components/ui.jsx';
import { fmtKm, todayISO } from '../../lib/format.js';
import { positionsFor } from '../../../shared/constants.js';

const ACTIONS_BY_STATUS = (status) =>
  status === 'em_uso'
    ? [
        { key: 'trocar_posicao', label: 'Trocar de posição (rodízio)' },
        { key: 'trocar_veiculo', label: 'Trocar de veículo' },
        { key: 'estoque', label: 'Enviar para estoque' },
        { key: 'recapagem', label: 'Enviar para recapagem' },
        { key: 'retirar', label: 'Retirar' },
        { key: 'descartar', label: 'Descartar' },
      ]
    : [
        { key: 'instalar', label: 'Instalar em um veículo' },
        ...(status !== 'estoque' ? [{ key: 'estoque', label: 'Enviar para estoque' }] : []),
        { key: 'recapagem', label: 'Enviar para recapagem' },
        ...(status !== 'retirado' ? [{ key: 'retirar', label: 'Retirar' }] : []),
        { key: 'descartar', label: 'Descartar' },
      ];

/** Seletor de posição mostrando quem ocupa cada uma. */
function PositionSelect({ vehicleId, value, onChange, currentTireId, allowOccupied }) {
  const { data, loading } = useFetch(vehicleId ? `/vehicles/${vehicleId}/tires` : null);
  if (!vehicleId) return <select disabled><option>Escolha o veículo</option></select>;
  if (loading || !data) return <Loading />;
  return (
    <Select
      value={value}
      onChange={onChange}
      options={data.positions.map((p) => {
        const occ = p.tire && p.tire.id !== currentTireId ? p.tire.code : null;
        return { key: p.code, label: `${p.label}${occ ? ` — ocupada (${occ})${allowOccupied ? ' · trocam de lugar' : ''}` : p.tire?.id === currentTireId ? ' — atual' : ' — livre'}` };
      })}
    />
  );
}

export function MoveModal({ tire, presetAction, presetVehicle, presetPosition, onClose, onDone }) {
  const { can } = useAuth();
  const toast = useToast();
  const actions = ACTIONS_BY_STATUS(tire.status).filter((a) => a.key !== 'descartar' || can('pneus', 'cancelar'));
  const [action, setAction] = useState(presetAction || actions[0].key);
  const [vehicleId, setVehicleId] = useState(presetVehicle || (action === 'trocar_posicao' ? tire.vehicle_id : ''));
  const [position, setPosition] = useState(presetPosition || '');
  const [reason, setReason] = useState('');
  const [company, setCompany] = useState('');
  const [cost, setCost] = useState('');
  const [retreadType, setRetreadType] = useState('');
  const [busy, setBusy] = useState(false);
  const vehicles = useFetch('/vehicles/options');
  const needsPlace = ['instalar', 'trocar_posicao', 'trocar_veiculo'].includes(action);
  const vid = action === 'trocar_posicao' ? tire.vehicle_id : vehicleId;
  const reasonRequired = ['retirar', 'descartar'].includes(action);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/tires/${tire.id}/move`, {
        method: 'POST',
        body: { action, vehicle_id: needsPlace ? vid : null, position: needsPlace ? position : null, reason, company, cost: cost || null, retread_type: retreadType },
      });
      toast(r.swapped ? `Rodízio feito: ${tire.code} ⇄ ${r.swapped}.` : 'Movimentação registrada.');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Mover pneu ${tire.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${action === 'descartar' ? 'danger solid' : 'primary'}`}
            disabled={busy || (needsPlace && (!vid || !position)) || (reasonRequired && reason.trim().length < 3)}
            onClick={save}
          >
            Confirmar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="O que fazer" className="full">
          <Select value={action} onChange={(v) => { setAction(v); setPosition(''); if (v === 'trocar_posicao') setVehicleId(tire.vehicle_id); else if (v !== 'instalar' && v !== 'trocar_veiculo') setVehicleId(''); }} options={actions} allowEmpty={false} />
        </Field>
        {tire.status === 'em_uso' && (
          <div className="full small muted">
            Atualmente em <strong>{tire.plate}</strong> · {tire.position_label} · {fmtKm(tire.current_install_km)} rodados nesta instalação
          </div>
        )}
        {(action === 'instalar' || action === 'trocar_veiculo') && (
          <Field label="Veículo" className="full">
            <Select
              value={vehicleId}
              onChange={(v) => {
                setVehicleId(v);
                setPosition('');
              }}
              options={(vehicles.data?.vehicles || []).filter((v) => v.id !== (action === 'trocar_veiculo' ? tire.vehicle_id : null)).map((v) => ({ key: v.id, label: `${v.plate}${v.fleet_number ? ` · Frota ${v.fleet_number}` : ''}` }))}
            />
          </Field>
        )}
        {needsPlace && (
          <Field label="Posição" className="full">
            <PositionSelect vehicleId={vid} value={position} onChange={setPosition} currentTireId={tire.id} allowOccupied={action === 'trocar_posicao'} key={vid} />
          </Field>
        )}
        {action === 'recapagem' && (
          <>
            <Field label="Empresa de recapagem" className="span2">
              <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Tipo de recapagem">
              <input value={retreadType} onChange={(e) => setRetreadType(e.target.value)} maxLength={60} placeholder="Ex.: pré-moldada, a quente" list="retread-types" />
              <datalist id="retread-types">
                {['Pré-moldada (a frio)', 'A quente', 'Remoldagem', 'Recauchutagem'].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Valor previsto (R$)">
              <DecimalInput value={cost} onChange={setCost} />
            </Field>
          </>
        )}
        <Field label={reasonRequired ? 'Motivo (obrigatório)' : 'Motivo / observação'} className="full">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
      {action === 'descartar' && <div className="notice danger" style={{ marginTop: 10 }}>Descarte é definitivo. O histórico do pneu continua salvo.</div>}
    </Modal>
  );
}

export function InspectModal({ tire, onClose, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({ inspected_on: todayISO(), tread_depth_mm: '', pressure_psi: '', condition: 'bom', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? val.target.value : val }));
  const save = async () => {
    setBusy(true);
    try {
      await api(`/tires/${tire.id}/inspect`, { method: 'POST', body: { ...v, tread_depth_mm: v.tread_depth_mm || null, pressure_psi: v.pressure_psi || null } });
      toast('Inspeção registrada.');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Inspeção do pneu ${tire.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            Registrar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Data">
          <input type="date" value={v.inspected_on} onChange={set('inspected_on')} max={todayISO()} />
        </Field>
        <Field label="Sulco (mm)">
          <DecimalInput value={v.tread_depth_mm} onChange={set('tread_depth_mm')} autoFocus />
        </Field>
        <Field label="Pressão (psi)">
          <DecimalInput value={v.pressure_psi} onChange={set('pressure_psi')} />
        </Field>
        <Field label="Estado geral">
          <Select value={v.condition} onChange={set('condition')} options={[{ key: 'bom', label: 'Bom' }, { key: 'regular', label: 'Regular' }, { key: 'ruim', label: 'Ruim' }]} allowEmpty={false} />
        </Field>
        <Field label="Observações" className="full">
          <textarea value={v.notes} onChange={set('notes')} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

export function RetreadReturnModal({ tire, onClose, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({ returned_on: todayISO(), approved: 'sim', cost: '', retread_type: '', warranty: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? val.target.value : val }));
  const save = async () => {
    setBusy(true);
    try {
      await api(`/tires/${tire.id}/retread-return`, { method: 'POST', body: { ...v, approved: v.approved === 'sim', cost: v.cost || null } });
      toast(v.approved === 'sim' ? 'Retorno registrado. Pneu voltou para o estoque.' : 'Pneu reprovado na recapagem e descartado.');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Retorno da recapagem — pneu ${tire.code}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            Registrar retorno
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Data de retorno">
          <input type="date" value={v.returned_on} onChange={set('returned_on')} max={todayISO()} />
        </Field>
        <Field label="Resultado">
          <Select value={v.approved} onChange={set('approved')} options={[{ key: 'sim', label: 'Aprovado (volta ao estoque)' }, { key: 'nao', label: 'Reprovado (descartar)' }]} allowEmpty={false} />
        </Field>
        <Field label="Valor final (R$)">
          <DecimalInput value={v.cost} onChange={set('cost')} />
        </Field>
        <Field label="Tipo de recapagem">
          <input value={v.retread_type} onChange={set('retread_type')} maxLength={60} />
        </Field>
        <Field label="Garantia" className="span2">
          <input value={v.warranty} onChange={set('warranty')} maxLength={120} placeholder="Ex.: 6 meses ou 40.000 km" />
        </Field>
        <Field label="Observações" className="full">
          <textarea value={v.notes} onChange={set('notes')} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

/** Escolher um pneu disponível para instalar numa posição vazia. */
export function InstallPickModal({ vehicle, position, positionLabel, onClose, onDone }) {
  const toast = useToast();
  const { data, loading } = useFetch(`/tires${qs({ status: 'disponiveis' })}`);
  const [tireId, setTireId] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/tires/${tireId}/move`, { method: 'POST', body: { action: 'instalar', vehicle_id: vehicle.id, position } });
      toast('Pneu instalado.');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Instalar pneu — ${vehicle.plate}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !tireId} onClick={save}>
            Instalar
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Posição: <strong>{positionLabel}</strong>
      </p>
      {loading ? (
        <Loading />
      ) : data.tires.length ? (
        <Field label="Pneu disponível (novo, estoque ou retirado)">
          <Select
            value={tireId}
            onChange={setTireId}
            options={data.tires.map((t) => ({ key: t.id, label: `${t.code}${t.fire_number ? ` · fogo ${t.fire_number}` : ''} · ${[t.brand, t.size].filter(Boolean).join(' ')} · ${fmtKm(t.total_km)}${t.retread_count ? ` · ${t.retread_count} recap.` : ''}` }))}
            autoFocus
          />
        </Field>
      ) : (
        <div className="notice info">Nenhum pneu disponível. Cadastre um pneu em Pneus › Estoque.</div>
      )}
    </Modal>
  );
}

export { positionsFor };
