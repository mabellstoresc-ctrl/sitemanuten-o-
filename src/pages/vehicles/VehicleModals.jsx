import { useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { api, qs } from '../../api.js';
import { Modal, Field, IntInput, Select, useToast, useDialog, useFetch, Loading } from '../../components/ui.jsx';
import { fmtKm, nowLocalInput, fmtPlate } from '../../lib/format.js';
import { VEHICLE_STATUS, TOWED_TYPES, labelOf, DRIVER_STATUS } from '../../../shared/constants.js';

export function KmModal({ vehicle, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [km, setKm] = useState(null);
  const [when, setWhen] = useState(nowLocalInput());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async (extra = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/vehicles/${vehicle.id}/km`, { method: 'POST', body: { km, reading_at: when ? new Date(when).toISOString() : null, ...extra } });
      toast('Quilometragem registrada.');
      onSaved();
    } catch (err) {
      if (err.code === 'KM_SALTO') {
        const ok = await dialog.confirm({ title: 'Confirmar quilometragem', message: `${err.message}\n\nKM informado: ${fmtKm(km)}`, confirmLabel: 'Está correto' });
        if (ok) return send({ ...extra, confirm_jump: true });
      } else if (err.code === 'KM_MENOR' && user.is_master) {
        const reason = await dialog.prompt({
          title: 'Correção de quilometragem',
          message: `${err.message}\n\nComo Administrador Principal você pode registrar a correção. Ela ficará na auditoria.`,
          label: 'Motivo da correção',
          required: true,
          minLength: 5,
          confirmLabel: 'Registrar correção',
          danger: true,
        });
        if (reason) return send({ ...extra, confirm_lower: true, reason });
      } else if (err.code === 'KM_MENOR') {
        setError(`${err.message} Somente o Administrador Principal pode corrigir para um valor menor.`);
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Atualizar KM — ${fmtPlate(vehicle.plate)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || km === null} onClick={() => send()}>
            {busy ? 'Salvando…' : 'Registrar'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (km !== null) send();
        }}
        className="form-grid"
      >
        <Field label="KM atual registrado">
          <input value={fmtKm(vehicle.current_km)} disabled />
        </Field>
        <Field label="Nova leitura do hodômetro" required>
          <IntInput value={km} onChange={setKm} autoFocus />
        </Field>
        <Field label="Data e hora da leitura">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} max={nowLocalInput()} />
        </Field>
        {km !== null && km > vehicle.current_km && (
          <div className="full muted small">Rodou {fmtKm(km - vehicle.current_km)} desde o último registro.</div>
        )}
        {error && <div className="full notice danger">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function StatusModal({ vehicle, onClose, onSaved }) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(vehicle.status);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const needsCancel = status === 'inativo' || vehicle.status === 'inativo';
  const allowed = !needsCancel || can('veiculos', 'cancelar');
  const save = async () => {
    setBusy(true);
    try {
      await api(`/vehicles/${vehicle.id}/status`, { method: 'POST', body: { status, reason } });
      toast('Status alterado.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Status — ${fmtPlate(vehicle.plate)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || status === vehicle.status || !allowed || (status === 'inativo' && !reason.trim())} onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Novo status">
          <Select value={status} onChange={setStatus} options={VEHICLE_STATUS} allowEmpty={false} autoFocus />
        </Field>
        <Field label={status === 'inativo' ? 'Motivo (obrigatório)' : 'Observação'} className="full">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
      {status === 'inativo' && vehicle.status !== 'inativo' && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          Ao inativar, o motorista e os implementos engatados serão desvinculados. O histórico é mantido.
        </div>
      )}
      {!allowed && <div className="notice danger" style={{ marginTop: 10 }}>Inativar ou reativar exige a permissão “Cancelar” em Veículos.</div>}
    </Modal>
  );
}

export function DriverModal({ vehicle, onClose, onSaved }) {
  const toast = useToast();
  const { data, loading } = useFetch('/drivers/options');
  const [driverId, setDriverId] = useState(vehicle.driver_id || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = data?.drivers.find((d) => d.id === driverId);
  const save = async (unlink = false) => {
    setBusy(true);
    try {
      await api(`/vehicles/${vehicle.id}/driver`, { method: 'POST', body: { driver_id: unlink ? null : driverId || null, notes } });
      toast(unlink ? 'Motorista desvinculado.' : 'Motorista vinculado.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Motorista — ${fmtPlate(vehicle.plate)}`}
      onClose={onClose}
      footer={
        <>
          {vehicle.driver_id && (
            <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => save(true)}>
              Desvincular
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !driverId || driverId === vehicle.driver_id} onClick={() => save(false)}>
            Vincular
          </button>
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <div className="form-grid">
          <Field label="Motorista" className="full">
            <Select
              value={driverId}
              onChange={setDriverId}
              options={data.drivers.map((d) => ({
                key: d.id,
                label: `${d.full_name}${d.status !== 'ativo' ? ` (${labelOf(DRIVER_STATUS, d.status)})` : ''}${d.vehicle_id && d.vehicle_id !== vehicle.id ? ' · em outro veículo' : ''}`,
              }))}
              autoFocus
            />
          </Field>
          <Field label="Observação" className="full">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Opcional" />
          </Field>
          {selected?.vehicle_id && selected.vehicle_id !== vehicle.id && (
            <div className="full notice warn">Este motorista está em outro veículo. Ao confirmar, ele será transferido para {fmtPlate(vehicle.plate)}.</div>
          )}
          {vehicle.driver_name && driverId && driverId !== vehicle.driver_id && (
            <div className="full notice info">{vehicle.driver_name} será desvinculado deste veículo.</div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CoupleModal({ vehicle, onClose, onSaved }) {
  const toast = useToast();
  const { data, loading } = useFetch(`/vehicles${qs({ group: 'implementos' })}`);
  const [trailerId, setTrailerId] = useState('');
  const [busy, setBusy] = useState(false);
  const options = (data?.vehicles || []).filter((t) => TOWED_TYPES.includes(t.type) && t.status !== 'inativo' && t.tractor?.id !== vehicle.id);
  const sel = options.find((t) => t.id === trailerId);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/vehicles/${vehicle.id}/couple`, { method: 'POST', body: { trailer_id: trailerId } });
      toast('Implemento engatado.');
      if (r.aet_warning) toast(`Atenção: ${r.aet_warning}`, 'error');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Engatar implemento — ${fmtPlate(vehicle.plate)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || !trailerId} onClick={save}>
            Engatar
          </button>
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <>
          <Field label="Carreta / implemento">
            <Select
              value={trailerId}
              onChange={setTrailerId}
              options={options.map((t) => ({ key: t.id, label: `${t.plate}${t.fleet_number ? ` · Frota ${t.fleet_number}` : ''}${t.tractor ? ` (engatado em ${t.tractor.plate})` : ''}` }))}
              autoFocus
            />
          </Field>
          {!options.length && <div className="notice info" style={{ marginTop: 10 }}>Nenhum implemento disponível. Cadastre em Frota › Implementos.</div>}
          {sel?.tractor && <div className="notice warn" style={{ marginTop: 10 }}>Será desengatado de {sel.tractor.plate} e engatado neste veículo.</div>}
          <p className="muted small">O KM do cavalo no momento do engate é registrado para calcular a quilometragem rodada pelo implemento.</p>
        </>
      )}
    </Modal>
  );
}
