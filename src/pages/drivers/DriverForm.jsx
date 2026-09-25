import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useFetch, useForm, useToast, Field, Select, Loading, ErrorBox, enterNav } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtCpf } from '../../lib/format.js';
import { DRIVER_STATUS, CNH_CATEGORIES } from '../../../shared/constants.js';

const EMPTY = {
  full_name: '',
  cpf: '',
  cnh_number: '',
  cnh_category: '',
  cnh_expiry: '',
  phone: '',
  admission_date: '',
  status: 'ativo',
  notes: '',
};

function maskCpf(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

function Form({ initial, id }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { values: v, set, errors: E, saving, submit } = useForm(initial);
  const onSubmit = submit(async (vals) => {
    try {
      if (id) {
        const body = { ...vals };
        delete body.status;
        await api(`/drivers/${id}`, { method: 'PUT', body });
        toast('Motorista atualizado.');
        navigate(`/motoristas/${id}`);
      } else {
        const r = await api('/drivers', { method: 'POST', body: vals });
        toast('Motorista cadastrado.');
        navigate(`/motoristas/${r.id}`, { replace: true });
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return (
    <form className="card" onSubmit={onSubmit} onKeyDown={enterNav}>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Nome completo" required error={E.full_name} className="span2">
            <input value={v.full_name} onChange={set('full_name')} maxLength={120} autoFocus={!id} />
          </Field>
          <Field label="CPF" required error={E.cpf}>
            <input value={v.cpf} onChange={(e) => set('cpf')(maskCpf(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" />
          </Field>
          <Field label="Telefone" error={E.phone}>
            <input value={v.phone || ''} onChange={(e) => set('phone')(maskPhone(e.target.value))} inputMode="tel" placeholder="(00) 00000-0000" />
          </Field>
          <Field label="Nº da CNH" error={E.cnh_number}>
            <input value={v.cnh_number || ''} onChange={(e) => set('cnh_number')(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={20} />
          </Field>
          <Field label="Categoria" error={E.cnh_category}>
            <Select value={v.cnh_category} onChange={set('cnh_category')} options={CNH_CATEGORIES} />
          </Field>
          <Field label="Validade da CNH" error={E.cnh_expiry}>
            <input type="date" value={v.cnh_expiry || ''} onChange={set('cnh_expiry')} />
          </Field>
          <Field label="Data de admissão" error={E.admission_date}>
            <input type="date" value={v.admission_date || ''} onChange={set('admission_date')} />
          </Field>
          {!id && (
            <Field label="Status" error={E.status}>
              <Select value={v.status} onChange={set('status')} options={DRIVER_STATUS.filter((s) => s.key !== 'inativo')} allowEmpty={false} />
            </Field>
          )}
          <Field label="Observações" className="full" error={E.notes}>
            <textarea value={v.notes || ''} onChange={set('notes')} rows={3} maxLength={4000} />
          </Field>
        </div>
        <div className="form-actions">
          <span className="left muted small">Enter avança · Ctrl+Enter salva</span>
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

export default function DriverForm() {
  const { id } = useParams();
  const { data, loading, error, reload } = useFetch(id ? `/drivers/${id}` : null);
  if (id && loading) return <Loading />;
  if (id && error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data?.driver;
  const initial = d
    ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, d[k] ?? ''])), cpf: fmtCpf(d.cpf), phone: d.phone || '' }
    : EMPTY;
  return (
    <Guard module="motoristas" action={id ? 'editar' : 'cadastrar'}>
      <PageHead title={id ? `Editar motorista` : 'Novo motorista'} code={id ? null : '202'} back={id ? `/motoristas/${id}` : '/motoristas'} sub={d?.full_name} />
      <Form initial={initial} id={id} />
    </Guard>
  );
}
