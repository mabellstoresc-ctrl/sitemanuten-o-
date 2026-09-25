import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, qs, uploadFile } from '../../api.js';
import { useFetch, useToast, useDialog, Field, Select, IntInput, DecimalInput, Loading, ErrorBox, enterNav } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtKm, fmtMoney, fmtNum, nowLocalInput, fmtDate } from '../../lib/format.js';
import { FUELING_TYPES, NON_CONSUMPTION_FUELS, TOWED_TYPES, UF } from '../../../shared/constants.js';

const parseDec = (s) => {
  if (s === null || s === undefined || s === '') return null;
  const str = String(s);
  const n = str.includes(',') ? Number(str.replace(/\./g, '').replace(',', '.')) : Number(str);
  return Number.isFinite(n) ? n : null;
};
const toDec = (n, d = 2) => (n === null || n === undefined ? '' : Number(n).toFixed(d).replace('.', ','));

function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const EMPTY = {
  vehicle_id: '',
  driver_id: '',
  fueled_at: nowLocalInput(),
  km: null,
  station: '',
  city: '',
  state: '',
  fuel_type: 'diesel_s10',
  liters: '',
  price_per_liter: '',
  total: '',
  full_tank: true,
  order_id: '',
  order_ref: '',
  notes: '',
};

function Form({ initial, id, presetOrder }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const totalTouched = useRef(Boolean(id));
  const fileRef = useRef(null);

  const vehicles = useFetch('/vehicles/options');
  const drivers = useFetch('/drivers/options');
  const vehicle = useFetch(v.vehicle_id ? `/vehicles/${v.vehicle_id}` : null);
  const summary = useFetch(v.vehicle_id ? `/vehicles/${v.vehicle_id}/fuel-summary` : null);
  const orders = useFetch(v.vehicle_id ? `/fuel-orders${qs({ vehicle_id: v.vehicle_id, status: 'pendente' })}` : null);

  const set = (k) => (val) => {
    const value = val && val.target ? (val.target.type === 'checkbox' ? val.target.checked : val.target.value) : val;
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: null }));
  };

  // Ao escolher o veículo: motorista atual e combustível do cadastro
  const veh = vehicle.data?.vehicle;
  useEffect(() => {
    if (!veh || id) return;
    setV((s) => ({
      ...s,
      driver_id: s.driver_id || veh.driver_id || '',
      fuel_type: veh.fuel_type && FUELING_TYPES.some((f) => f.key === veh.fuel_type) ? veh.fuel_type : s.fuel_type,
    }));
  }, [veh, id]);

  // Ordem escolhida: preenche posto e motorista
  const orderList = useMemo(() => {
    const list = orders.data?.orders || [];
    if (presetOrder && !list.some((o) => o.id === presetOrder.id)) return [presetOrder, ...list];
    return list;
  }, [orders.data, presetOrder]);
  const order = orderList.find((o) => o.id === v.order_id);
  useEffect(() => {
    if (!order || id) return;
    setV((s) => ({
      ...s,
      station: s.station || order.station || '',
      driver_id: order.driver_id || s.driver_id,
      fuel_type: order.fuel_type || s.fuel_type,
    }));
  }, [order, id]);

  // Valor total automático (litros × preço), a menos que o usuário digite o total
  const liters = parseDec(v.liters);
  const price = parseDec(v.price_per_liter);
  const total = parseDec(v.total);
  useEffect(() => {
    if (totalTouched.current) return;
    if (liters && price !== null) setV((s) => ({ ...s, total: toDec(liters * price) }));
  }, [liters, price]);

  const last = summary.data?.last;
  const distance = v.km !== null && last && v.km > last.km ? v.km - last.km : null;
  const estimate = distance && liters && v.full_tank && !NON_CONSUMPTION_FUELS.includes(v.fuel_type) ? distance / liters : null;
  const mismatch = liters && price !== null && total !== null && Math.abs(liters * price - total) > Math.max(1, total * 0.01);

  const submit = async (e, flags = {}) => {
    e?.preventDefault?.();
    setSaving(true);
    setErrors({});
    const body = {
      ...v,
      fueled_at: v.fueled_at ? new Date(v.fueled_at).toISOString() : null,
      driver_id: v.driver_id || null,
      order_id: v.order_id || null,
      liters: v.liters,
      price_per_liter: v.price_per_liter === '' ? null : v.price_per_liter,
      total: v.total === '' ? null : v.total,
      ...flags,
    };
    if (id) delete body.vehicle_id;
    try {
      const r = id ? await api(`/fuelings/${id}`, { method: 'PUT', body }) : await api('/fuelings', { method: 'POST', body });
      const fid = id || r.id;
      for (const file of files) {
        try {
          await uploadFile({ entity: 'fueling', entityId: fid, category: 'comprovante', file });
        } catch (err) {
          toast(`Comprovante "${file.name}": ${err.message}`, 'error');
        }
      }
      const f = r.fueling;
      toast(
        f?.km_per_liter
          ? `Abastecimento salvo. Média: ${fmtNum(f.km_per_liter, 2)} km/L`
          : r.historical
            ? 'Abastecimento salvo (lançamento anterior ao KM atual — o KM do veículo não mudou).'
            : 'Abastecimento salvo.',
      );
      navigate(`/abastecimentos/${fid}`, { replace: true });
    } catch (err) {
      const again = (extra) => submit(null, { ...flags, ...extra });
      if (err.code === 'KM_SALTO' && (await dialog.confirm({ title: 'Confirmar quilometragem', message: err.message, confirmLabel: 'Está correto' }))) return again({ confirm_jump: true });
      if (err.code === 'LITROS_TANQUE' && (await dialog.confirm({ title: 'Litros acima do tanque', message: err.message, confirmLabel: 'Está correto' }))) return again({ confirm_tank: true });
      if (err.code === 'ORDEM_LIMITE' && (await dialog.confirm({ title: 'Limite da ordem', message: err.message, confirmLabel: 'Confirmar' }))) return again({ confirm_limit: true });
      if (err.code === 'MEDIA_IMPROVAVEL' && (await dialog.confirm({ title: 'Média fora do normal', message: err.message, confirmLabel: 'Salvar mesmo assim', danger: true }))) return again({ confirm_avg: true });
      if (err.code === 'DUPLICADO_PROVAVEL' && (await dialog.confirm({ title: 'Possível duplicidade', message: err.message, confirmLabel: 'É um novo abastecimento' }))) return again({ confirm_duplicate: true });
      if (err.code === 'KM_MENOR' && user.is_master) {
        const reason = await dialog.prompt({
          title: 'Correção de quilometragem',
          message: `${err.message}\n\nComo Administrador Principal você pode registrar a correção (fica na auditoria).`,
          label: 'Motivo',
          required: true,
          minLength: 5,
          danger: true,
          confirmLabel: 'Corrigir e salvar',
        });
        if (reason) return again({ confirm_lower: true, km_reason: reason });
      } else {
        if (err.fields) setErrors(err.fields);
        toast(err.message, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const E = errors;
  const vehicleOptions = (vehicles.data?.vehicles || [])
    .filter((x) => !TOWED_TYPES.includes(x.type))
    .map((x) => ({ key: x.id, label: `${x.plate}${x.fleet_number ? ` · Frota ${x.fleet_number}` : ''}${x.model ? ` · ${x.model}` : ''}` }));

  return (
    <form className="card" onSubmit={submit} onKeyDown={enterNav}>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Veículo" required error={E.vehicle_id} className="span2">
            <Select value={v.vehicle_id} onChange={set('vehicle_id')} options={vehicleOptions} disabled={Boolean(id)} autoFocus={!id && !v.vehicle_id} />
          </Field>
          <Field label="Motorista" error={E.driver_id}>
            <Select value={v.driver_id} onChange={set('driver_id')} options={(drivers.data?.drivers || []).map((d) => ({ key: d.id, label: d.full_name }))} placeholder="—" />
          </Field>
          <Field label="Data e hora" required error={E.fueled_at}>
            <input type="datetime-local" value={v.fueled_at} onChange={set('fueled_at')} max={nowLocalInput()} />
          </Field>

          {v.vehicle_id && (
            <div className="full notice info" style={{ padding: '8px 12px' }}>
              {veh ? (
                <>
                  KM atual do veículo: <strong>{fmtKm(veh.current_km)}</strong>
                  {veh.tank_capacity ? <> · Tanque: <strong>{fmtNum(veh.tank_capacity)} L</strong></> : null}
                  {last ? (
                    <>
                      {' '}· Último abastecimento: <strong>{fmtDate(last.fueled_at)}</strong> em {fmtKm(last.km)} ({fmtNum(last.liters, 0)} L)
                    </>
                  ) : (
                    ' · Primeiro abastecimento deste veículo (a média aparece a partir do próximo).'
                  )}
                </>
              ) : (
                'Carregando dados do veículo…'
              )}
            </div>
          )}

          <Field label="Quilometragem (hodômetro)" required error={E.km} hint={distance ? `Rodou ${fmtKm(distance)} desde o último abastecimento` : null}>
            <IntInput value={v.km} onChange={set('km')} />
          </Field>
          <Field label="Combustível" required error={E.fuel_type}>
            <Select value={v.fuel_type} onChange={set('fuel_type')} options={FUELING_TYPES} allowEmpty={false} />
          </Field>
          <Field label="Quantidade (litros)" required error={E.liters}>
            <DecimalInput value={v.liters} onChange={set('liters')} placeholder="0,00" />
          </Field>
          <Field label="Valor por litro (R$)" error={E.price_per_liter}>
            <DecimalInput value={v.price_per_liter} onChange={set('price_per_liter')} placeholder="0,000" />
          </Field>
          <Field label="Valor total (R$)" required error={E.total || (mismatch ? 'Não confere com litros × valor por litro' : null)} hint="Calculado automaticamente; pode digitar o valor da nota">
            <DecimalInput
              value={v.total}
              onChange={(val) => {
                totalTouched.current = val !== '';
                set('total')(val);
              }}
              placeholder="0,00"
            />
          </Field>
          <div className="field">
            <label>Tanque</label>
            <label className="check" style={{ height: 34 }}>
              <input type="checkbox" checked={v.full_tank} onChange={set('full_tank')} /> Completou o tanque
            </label>
            <span className="hint">A média é calculada entre tanques cheios</span>
          </div>

          {(estimate || (liters && total)) && (
            <div className="full" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }}>
              {estimate && (
                <span>
                  Média estimada: <strong>{fmtNum(estimate, 2)} km/L</strong>
                </span>
              )}
              {distance && total ? (
                <span>
                  Custo por km: <strong>{fmtMoney(total / distance)}</strong>
                </span>
              ) : null}
              {liters && total ? (
                <span>
                  Preço médio: <strong>{fmtMoney(total / liters)}/L</strong>
                </span>
              ) : null}
            </div>
          )}

          <Field label="Posto" error={E.station} className="span2">
            <input value={v.station} onChange={set('station')} maxLength={120} />
          </Field>
          <Field label="Cidade" error={E.city}>
            <input value={v.city} onChange={set('city')} maxLength={80} />
          </Field>
          <Field label="UF" error={E.state}>
            <Select value={v.state} onChange={set('state')} options={UF} placeholder="—" />
          </Field>

          <Field label="Ordem de abastecimento" error={E.order_id} hint={orderList.length ? null : v.vehicle_id ? 'Nenhuma ordem pendente para este veículo' : null}>
            <Select
              value={v.order_id}
              onChange={set('order_id')}
              options={orderList.map((o) => ({
                key: o.id,
                label: `Nº ${o.number} · ${fmtDate(o.order_date)}${o.max_liters ? ` · até ${fmtNum(o.max_liters)} L` : ''}${o.max_amount ? ` · até ${fmtMoney(o.max_amount)}` : ''}`,
              }))}
              placeholder="Sem ordem"
            />
          </Field>
          {!v.order_id && (
            <Field label="Nº de ordem externa" error={E.order_ref} hint="Opcional (ordem em papel, cartão frota…)">
              <input value={v.order_ref || ''} onChange={set('order_ref')} maxLength={40} />
            </Field>
          )}
          <Field label="Observações" className="full" error={E.notes}>
            <textarea value={v.notes || ''} onChange={set('notes')} rows={2} maxLength={2000} />
          </Field>
          <div className="field full">
            <label>Comprovante (foto ou PDF)</label>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => setFiles([...files, ...e.target.files])} />
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                <Paperclip size={15} /> Anexar
              </button>
              {files.map((f, i) => (
                <span key={i} className="badge muted">
                  {f.name}{' '}
                  <button type="button" className="linklike" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remover">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="form-actions">
          <span className="left muted small">Enter avança · Ctrl+Enter salva</span>
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving || !v.vehicle_id}>
            {saving ? 'Salvando…' : 'Salvar abastecimento'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function FuelingForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const orderId = params.get('ordem');
  const existing = useFetch(id ? `/fuelings/${id}` : null);
  const order = useFetch(!id && orderId ? `/fuel-orders/${orderId}` : null);
  if ((id && existing.loading) || (orderId && order.loading)) return <Loading />;
  if (id && existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;

  let initial = { ...EMPTY, fueled_at: nowLocalInput(), vehicle_id: params.get('veiculo') || '' };
  let preset = order.data?.order;
  if (id) {
    const f = existing.data.fueling;
    if (f.order_id) preset = { id: f.order_id, number: f.order_number, order_date: null };
    initial = {
      ...EMPTY,
      ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k] ?? EMPTY[k]])),
      fueled_at: toLocalInput(f.fueled_at),
      liters: toDec(f.liters, f.liters % 1 ? 3 : 0),
      price_per_liter: toDec(f.price_per_liter, 3),
      total: toDec(f.total),
    };
  } else if (order.data?.order) {
    const o = order.data.order;
    initial = { ...initial, vehicle_id: o.vehicle_id, order_id: o.id, driver_id: o.driver_id || '', station: o.station || '', fuel_type: o.fuel_type || 'diesel_s10' };
  }

  return (
    <Guard module="abastecimentos" action={id ? 'editar' : 'cadastrar'}>
      <PageHead title={id ? 'Editar abastecimento' : 'Novo abastecimento'} code={id ? null : '301'} back={id ? `/abastecimentos/${id}` : '/abastecimentos'} />
      <Form initial={initial} id={id} presetOrder={preset} />
    </Guard>
  );
}
