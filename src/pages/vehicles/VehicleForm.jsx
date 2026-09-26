import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useFetch, useForm, useToast, Field, Select, IntInput, DecimalInput, Loading, ErrorBox, enterNav } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { VEHICLE_TYPES, FUEL_TYPES, VEHICLE_STATUS, TOWED_TYPES, AXLE_LAYOUTS } from '../../../shared/constants.js';

const EMPTY = {
  plate: '',
  fleet_number: '',
  type: '',
  brand: '',
  model: '',
  year_manufacture: null,
  year_model: null,
  chassis: '',
  renavam: '',
  fuel_type: 'diesel_s10',
  tank_capacity: '',
  current_km: null,
  acquisition_date: '',
  status: 'disponivel',
  axle_config: '',
  notes: '',
};

function Form({ initial, id }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { values: v, set, errors, saving, submit, setValues } = useForm(initial);
  const towed = TOWED_TYPES.includes(v.type);

  useEffect(() => {
    if (towed && !id) setValues((s) => ({ ...s, fuel_type: 'nenhum', current_km: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towed]);

  const onSubmit = submit(async (vals) => {
    const body = { ...vals, tank_capacity: vals.tank_capacity === '' ? null : vals.tank_capacity };
    try {
      if (id) {
        delete body.current_km;
        delete body.status;
        await api(`/vehicles/${id}`, { method: 'PUT', body });
        toast('Veículo atualizado.');
        navigate(`/veiculos/${id}`);
      } else {
        const r = await api('/vehicles', { method: 'POST', body });
        toast('Veículo cadastrado.');
        navigate(`/veiculos/${r.id}`, { replace: true });
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const E = errors;
  return (
    <form onSubmit={onSubmit} onKeyDown={enterNav} className="card">
      <div className="card-body">
        <div className="form-grid">
          <Field label="Placa" required error={E.plate} hint="ABC1234 ou ABC1D23">
            <input value={v.plate} onChange={(e) => set('plate')(e.target.value.toUpperCase())} maxLength={8} autoFocus={!id} className="plate" />
          </Field>
          <Field label="Número da frota" error={E.fleet_number}>
            <input value={v.fleet_number || ''} onChange={set('fleet_number')} maxLength={20} />
          </Field>
          <Field label="Tipo" required error={E.type}>
            <Select value={v.type} onChange={set('type')} options={VEHICLE_TYPES} />
          </Field>
          <Field label="Marca" error={E.brand}>
            <input value={v.brand || ''} onChange={set('brand')} maxLength={60} list="brands" />
            <datalist id="brands">
              {['Scania', 'Volvo', 'Mercedes-Benz', 'Volkswagen', 'DAF', 'Iveco', 'Ford', 'Randon', 'Librelato', 'Facchini', 'Guerra', 'Noma', 'Rossetti'].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Modelo" error={E.model}>
            <input value={v.model || ''} onChange={set('model')} maxLength={80} />
          </Field>
          <Field label="Ano fabricação" error={E.year_manufacture}>
            <IntInput grouping={false} value={v.year_manufacture} onChange={(n) => set('year_manufacture')(n)} maxLength={4} placeholder="2020" />
          </Field>
          <Field label="Ano modelo" error={E.year_model}>
            <IntInput grouping={false} value={v.year_model} onChange={(n) => set('year_model')(n)} maxLength={4} placeholder="2021" />
          </Field>
          <Field label="Chassi" error={E.chassis}>
            <input value={v.chassis || ''} onChange={(e) => set('chassis')(e.target.value.toUpperCase())} maxLength={30} className="mono" />
          </Field>
          <Field label="RENAVAM" error={E.renavam}>
            <input value={v.renavam || ''} onChange={(e) => set('renavam')(e.target.value.replace(/\D/g, ''))} maxLength={11} inputMode="numeric" className="mono" />
          </Field>
          <Field label="Combustível" error={E.fuel_type}>
            <Select value={v.fuel_type} onChange={set('fuel_type')} options={FUEL_TYPES} />
          </Field>
          {!towed && (
            <Field label="Capacidade do tanque (L)" error={E.tank_capacity}>
              <DecimalInput value={v.tank_capacity} onChange={set('tank_capacity')} placeholder="Ex.: 600" />
            </Field>
          )}
          {!id && !towed && (
            <Field label="Quilometragem atual" error={E.current_km} hint="Leitura do hodômetro hoje">
              <IntInput value={v.current_km} onChange={(n) => set('current_km')(n)} />
            </Field>
          )}
          <Field label="Data de aquisição" error={E.acquisition_date}>
            <input type="date" value={v.acquisition_date || ''} onChange={set('acquisition_date')} />
          </Field>
          {!id && (
            <Field label="Status inicial" error={E.status}>
              <Select value={v.status} onChange={set('status')} options={VEHICLE_STATUS.filter((s) => s.key !== 'inativo')} allowEmpty={false} />
            </Field>
          )}
          <Field label="Configuração de eixos" error={E.axle_config} hint="Define o mapa de pneus">
            <Select value={v.axle_config} onChange={set('axle_config')} options={AXLE_LAYOUTS} placeholder="Padrão pelo tipo" />
          </Field>
          <Field label="Observações" className="full" error={E.notes}>
            <textarea value={v.notes || ''} onChange={set('notes')} rows={3} maxLength={4000} />
          </Field>
        </div>
        {id && <div className="notice info" style={{ marginTop: 12 }}>A quilometragem e o status são alterados pelos botões da ficha do veículo, para ficarem registrados no histórico.</div>}
        <div className="form-actions">
          <span className="left muted small">Enter avança para o próximo campo · Ctrl+Enter salva</span>
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function VehicleForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, loading, error, reload } = useFetch(id ? `/vehicles/${id}` : null);
  if (id && loading) return <Loading />;
  if (id && error) return <ErrorBox error={error} onRetry={reload} />;
  const initial = id ? { ...EMPTY, ...Object.fromEntries(Object.entries(data.vehicle).map(([k, val]) => [k, val ?? (typeof EMPTY[k] === 'string' ? '' : val)])) } : { ...EMPTY, type: params.get('tipo') || '' };
  if (initial.tank_capacity !== '' && initial.tank_capacity !== null) initial.tank_capacity = String(initial.tank_capacity).replace('.', ',');
  return (
    <Guard module="veiculos" action={id ? 'editar' : 'cadastrar'}>
      <PageHead title={id ? `Editar veículo ${data.vehicle.plate}` : 'Novo veículo'} code={id ? null : '102'} back={id ? `/veiculos/${id}` : '/veiculos'} />
      <Form initial={initial} id={id} />
    </Guard>
  );
}
