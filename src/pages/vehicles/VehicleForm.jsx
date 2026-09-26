import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { readOfficialDocument } from '../../lib/pdfText.js';
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
  color: '',
  body_type: '',
  pbt: '',
  cmt: '',
  capacity: '',
  notes: '',
};

const DECIMALS = ['tank_capacity', 'pbt', 'cmt', 'capacity'];

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
    const body = { ...vals };
    for (const k of DECIMALS) if (body[k] === '') body[k] = null;
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

  // Preenche o cadastro lendo o CRLV digital (PDF)
  const fileRef = useRef(null);
  const [reading, setReading] = useState(false);
  const fromCrlv = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    try {
      const d = await readOfficialDocument(file);
      if (!d || d.kind !== 'crlv') throw new Error('Não reconheci este arquivo como CRLV digital. Use o PDF baixado do app/site do DETRAN (não escaneado).');
      const dec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
      setValues((s) => ({
        ...s,
        ...(id ? {} : { plate: d.plate || s.plate, type: d.type || s.type }),
        brand: d.brand || s.brand,
        model: d.model || s.model,
        year_manufacture: d.year_manufacture || s.year_manufacture,
        year_model: d.year_model || s.year_model,
        chassis: d.chassis || s.chassis,
        renavam: d.renavam || s.renavam,
        fuel_type: d.fuel_type || s.fuel_type,
        axle_config: d.axle_config || s.axle_config,
        color: d.color || s.color,
        body_type: d.body_type || s.body_type,
        pbt: d.pbt ? dec(d.pbt) : s.pbt,
        cmt: d.cmt ? dec(d.cmt) : s.cmt,
        capacity: d.capacity ? dec(d.capacity) : s.capacity,
      }));
      if (id && d.plate && d.plate !== initial.plate) toast(`Atenção: o CRLV é da placa ${d.plate}, diferente deste veículo.`, 'error');
      else toast('Dados do CRLV preenchidos. Confira antes de salvar.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setReading(false);
    }
  };

  const E = errors;
  return (
    <form onSubmit={onSubmit} onKeyDown={enterNav} className="card">
      <div className="card-body">
        <div className="notice info" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>Tem o CRLV digital em PDF? O sistema lê e preenche placa, RENAVAM, chassi, ano, modelo, eixos, PBT e CMT.</span>
          <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={fromCrlv} />
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={reading}>
            <FileUp size={14} /> {reading ? 'Lendo…' : 'Preencher pelo CRLV (PDF)'}
          </button>
        </div>
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
          <Field label="Cor" error={E.color}>
            <input value={v.color || ''} onChange={(e) => set('color')(e.target.value.toUpperCase())} maxLength={30} />
          </Field>
          <Field label="Carroceria" error={E.body_type}>
            <input value={v.body_type || ''} onChange={(e) => set('body_type')(e.target.value.toUpperCase())} maxLength={60} placeholder="Ex.: FECHADA" />
          </Field>
          <Field label="PBT (t)" error={E.pbt} hint="Peso bruto total">
            <DecimalInput value={v.pbt} onChange={set('pbt')} />
          </Field>
          {!towed && (
            <Field label="CMT (t)" error={E.cmt} hint="Capacidade máxima de tração">
              <DecimalInput value={v.cmt} onChange={set('cmt')} />
            </Field>
          )}
          <Field label="Capacidade de carga (t)" error={E.capacity}>
            <DecimalInput value={v.capacity} onChange={set('capacity')} />
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
  for (const k of DECIMALS) initial[k] = initial[k] === '' || initial[k] === null || initial[k] === undefined ? '' : String(initial[k]).replace('.', ',');
  return (
    <Guard module="veiculos" action={id ? 'editar' : 'cadastrar'}>
      <PageHead title={id ? `Editar veículo ${data.vehicle.plate}` : 'Novo veículo'} code={id ? null : '102'} back={id ? `/veiculos/${id}` : '/veiculos'} />
      <Form initial={initial} id={id} />
    </Guard>
  );
}
