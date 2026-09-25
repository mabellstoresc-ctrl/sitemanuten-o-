import { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, uploadFile } from '../../api.js';
import { useFetch, useToast, useDialog, Field, Select, Loading, ErrorBox } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import MaintenanceFields, { EMPTY_MAINT, maintBody, toDec } from './MaintenanceFields.jsx';
import { todayISO } from '../../lib/format.js';
import { TOWED_TYPES, OIL_CATEGORY } from '../../../shared/constants.js';

/** Trata as confirmações de KM vindas da API (salto grande / KM menor). Retorna flags extras ou null. */
export async function kmConfirmations(err, dialog, user) {
  if (err.code === 'KM_SALTO') {
    return (await dialog.confirm({ title: 'Confirmar quilometragem', message: err.message, confirmLabel: 'Está correto' })) ? { confirm_jump: true } : null;
  }
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
    return reason ? { confirm_lower: true, km_reason: reason } : null;
  }
  return null;
}

function Form({ initial, id }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);
  const vehicles = useFetch('/vehicles/options');
  const settings = useFetch('/settings/public');
  const vehicle = useFetch(v.vehicle_id ? `/vehicles/${v.vehicle_id}` : null);
  const set = (k) => (val) => {
    const value = val && val.target ? (val.target.type === 'checkbox' ? val.target.checked : val.target.value) : val;
    setV((s) => ({ ...s, [k]: value }));
    setErrors((e) => ({ ...e, [k]: null }));
  };

  const submit = async (e, flags = {}) => {
    e?.preventDefault?.();
    if (!v.categories.length) {
      setErrors({ categories: 'Obrigatório' });
      toast('Selecione pelo menos uma categoria.', 'error');
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const body = { ...maintBody(v), ...flags };
      if (id) delete body.vehicle_id;
      const r = id ? await api(`/maintenances/${id}`, { method: 'PUT', body }) : await api('/maintenances', { method: 'POST', body });
      const mid = id || r.id;
      for (const file of files) {
        try {
          await uploadFile({ entity: 'maintenance', entityId: mid, category: file.type === 'application/pdf' ? 'nota_fiscal' : 'foto', file });
        } catch (err) {
          toast(`Arquivo "${file.name}": ${err.message}`, 'error');
        }
      }
      toast(id ? 'Manutenção atualizada.' : 'Manutenção registrada.');
      navigate(`/manutencao/${mid}`, { replace: true });
    } catch (err) {
      const extra = await kmConfirmations(err, dialog, user);
      if (extra) return submit(null, { ...flags, ...extra });
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const veh = vehicle.data?.vehicle;
  return (
    <form className="card" onSubmit={submit}>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Veículo" required error={errors.vehicle_id} className="span2">
            <Select
              value={v.vehicle_id}
              onChange={set('vehicle_id')}
              options={(vehicles.data?.vehicles || []).map((x) => ({ key: x.id, label: `${x.plate}${x.fleet_number ? ` · Frota ${x.fleet_number}` : ''}${TOWED_TYPES.includes(x.type) ? ' (implemento)' : ''}` }))}
              disabled={Boolean(id)}
              autoFocus={!id}
            />
          </Field>
          <MaintenanceFields
            v={v}
            set={set}
            setV={setV}
            errors={errors}
            currentKm={veh && !TOWED_TYPES.includes(veh.type) ? veh.current_km : undefined}
            oilInterval={settings.data?.settings.alertas.oleo_intervalo_km || 15000}
          />
          <div className="field full">
            <label>Fotos e nota fiscal</label>
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
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving || !v.vehicle_id}>
            {saving ? 'Salvando…' : 'Salvar manutenção'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function MaintenanceForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const existing = useFetch(id ? `/maintenances/${id}` : null);
  if (id && existing.loading) return <Loading />;
  if (id && existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;
  let initial = {
    ...EMPTY_MAINT,
    vehicle_id: params.get('veiculo') || '',
    performed_on: todayISO(),
    type: params.get('tipo') || (params.get('oleo') ? 'preventiva' : 'preventiva'),
    categories: params.get('oleo') ? [OIL_CATEGORY, 'filtro_oleo'] : [],
    oil_filter: Boolean(params.get('oleo')),
  };
  if (id) {
    const m = existing.data.maintenance;
    initial = {
      ...EMPTY_MAINT,
      ...Object.fromEntries(Object.keys(EMPTY_MAINT).map((k) => [k, m[k] ?? EMPTY_MAINT[k]])),
      vehicle_id: m.vehicle_id,
      labor_cost: toDec(m.labor_cost),
      parts_cost: m.parts.length ? '' : toDec(m.parts_cost),
      oil_quantity: m.oil_quantity === null ? '' : toDec(m.oil_quantity, 1),
      parts: m.parts.map((p) => ({ description: p.description, part_number: p.part_number || '', quantity: toDec(p.quantity, p.quantity % 1 ? 2 : 0), unit_price: toDec(p.unit_price) })),
    };
  }
  const oil = !id && params.get('oleo');
  return (
    <Guard module="manutencoes" action={id ? 'editar' : 'cadastrar'}>
      <PageHead
        title={id ? 'Editar manutenção' : oil ? 'Registrar troca de óleo' : 'Nova manutenção'}
        back={id ? `/manutencao/${id}` : '/manutencao/preventivas'}
        sub={id && existing.data.maintenance.service_order_number ? `Gerada pela OS nº ${existing.data.maintenance.service_order_number}` : 'Para serviços já realizados. Para acompanhar um serviço em andamento, abra uma ordem de serviço.'}
      />
      <Form initial={initial} id={id} />
    </Guard>
  );
}
