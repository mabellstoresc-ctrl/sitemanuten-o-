import { Plus, Trash2 } from 'lucide-react';
import { Field, Select, IntInput, DecimalInput } from '../../components/ui.jsx';
import { fmtMoney, fmtNum, fmtKm } from '../../lib/format.js';
import { MAINTENANCE_TYPES, MAINTENANCE_CATEGORIES, OIL_CATEGORY } from '../../../shared/constants.js';

export const parseDec = (s) => {
  if (s === null || s === undefined || s === '') return null;
  const str = String(s);
  const n = str.includes(',') ? Number(str.replace(/\./g, '').replace(',', '.')) : Number(str);
  return Number.isFinite(n) ? n : null;
};
export const toDec = (n, d = 2) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(d).replace('.', ','));

export const EMPTY_MAINT = {
  type: 'preventiva',
  categories: [],
  performed_on: '',
  km: null,
  workshop: '',
  responsible: '',
  description: '',
  labor_cost: '',
  parts_cost: '',
  invoice_number: '',
  notes: '',
  next_date: '',
  next_km: null,
  oil_brand: '',
  oil_type: '',
  oil_spec: '',
  oil_quantity: '',
  oil_filter: false,
  fuel_filter: false,
  air_filter: false,
  parts: [],
};

/** Converte o estado do formulário no corpo da API. */
export function maintBody(v, { withParts = true } = {}) {
  const body = {
    ...v,
    labor_cost: v.labor_cost === '' ? 0 : v.labor_cost,
    parts_cost: v.parts_cost === '' ? 0 : v.parts_cost,
    oil_quantity: v.oil_quantity === '' ? null : v.oil_quantity,
    next_date: v.next_date || null,
  };
  if (withParts) {
    body.parts = v.parts
      .filter((p) => p.description.trim())
      .map((p) => ({ description: p.description, part_number: p.part_number || null, quantity: p.quantity || 1, unit_price: p.unit_price || 0 }));
  } else delete body.parts;
  return body;
}

export function PartsEditor({ parts, onChange }) {
  const set = (i, k, val) => onChange(parts.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const total = parts.reduce((s, p) => s + (parseDec(p.quantity) || 0) * (parseDec(p.unit_price) || 0), 0);
  return (
    <div className="full">
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Peça / material</th>
              <th>Código</th>
              <th style={{ width: 90 }}>Qtd.</th>
              <th style={{ width: 120 }}>Valor unit.</th>
              <th className="right" style={{ width: 110 }}>
                Total
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={i}>
                <td>
                  <input className="input" value={p.description} onChange={(e) => set(i, 'description', e.target.value)} maxLength={200} placeholder="Descrição" />
                </td>
                <td>
                  <input className="input" value={p.part_number || ''} onChange={(e) => set(i, 'part_number', e.target.value)} maxLength={60} />
                </td>
                <td>
                  <DecimalInput className="input" value={p.quantity} onChange={(val) => set(i, 'quantity', val)} />
                </td>
                <td>
                  <DecimalInput className="input" value={p.unit_price} onChange={(val) => set(i, 'unit_price', val)} placeholder="0,00" />
                </td>
                <td className="right num">{fmtMoney((parseDec(p.quantity) || 0) * (parseDec(p.unit_price) || 0))}</td>
                <td>
                  <button type="button" className="btn sm ghost" onClick={() => onChange(parts.filter((_, j) => j !== i))} aria-label="Remover peça">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-foot">
          <button type="button" className="btn sm" onClick={() => onChange([...parts, { description: '', part_number: '', quantity: '1', unit_price: '' }])}>
            <Plus size={14} /> Adicionar peça
          </button>
          <span style={{ marginLeft: 'auto' }}>
            Total em peças: <strong>{fmtMoney(total)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Campos da manutenção. `set(k)(valor)`; `errors`.
 * Opções: showParts (editor de peças), partsTotal (peças já lançadas na OS), dateLabel, oilInterval, currentKm.
 */
export default function MaintenanceFields({ v, set, setV, errors: E = {}, showParts = true, partsTotal = null, dateLabel = 'Data da manutenção', oilInterval = 15000, currentKm }) {
  const isOil = v.categories.includes(OIL_CATEGORY);
  const toggleCat = (key) => {
    const has = v.categories.includes(key);
    setV((s) => ({ ...s, categories: has ? s.categories.filter((c) => c !== key) : [...s.categories, key] }));
  };
  const toggleFilter = (field, cat) => (e) => {
    const on = e.target.checked;
    setV((s) => ({ ...s, [field]: on, categories: on ? [...new Set([...s.categories, cat])] : s.categories }));
  };
  const partsSum = showParts ? v.parts.reduce((s, p) => s + (parseDec(p.quantity) || 0) * (parseDec(p.unit_price) || 0), 0) : partsTotal;
  const partsValue = showParts && v.parts.some((p) => p.description.trim()) ? partsSum : partsTotal ?? parseDec(v.parts_cost) ?? 0;
  const total = (partsValue || 0) + (parseDec(v.labor_cost) || 0);

  return (
    <>
      <Field label="Tipo" required error={E.type}>
        <Select value={v.type} onChange={set('type')} options={MAINTENANCE_TYPES} allowEmpty={false} />
      </Field>
      <Field label={dateLabel} required error={E.performed_on}>
        <input type="date" value={v.performed_on} onChange={set('performed_on')} max={new Date().toLocaleDateString('sv-SE')} />
      </Field>
      <Field label="Quilometragem" error={E.km} hint={currentKm !== undefined ? `KM atual do veículo: ${fmtKm(currentKm)}` : null}>
        <IntInput value={v.km} onChange={set('km')} />
      </Field>
      <Field label="Oficina" error={E.workshop}>
        <input value={v.workshop} onChange={set('workshop')} maxLength={120} />
      </Field>
      <Field label="Responsável" error={E.responsible}>
        <input value={v.responsible} onChange={set('responsible')} maxLength={120} />
      </Field>

      <div className={`field full ${E.categories ? 'invalid' : ''}`}>
        <label>
          Categorias <span className="req">*</span>
        </label>
        <div className="cat-grid">
          {MAINTENANCE_CATEGORIES.map((c) => (
            <label key={c.key} className={`check chip ${v.categories.includes(c.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={v.categories.includes(c.key)} onChange={() => toggleCat(c.key)} /> {c.label}
            </label>
          ))}
        </div>
        {E.categories && <span className="err">Selecione pelo menos uma categoria</span>}
      </div>

      {isOil && (
        <div className="full oil-box">
          <div className="section-title" style={{ marginTop: 0 }}>
            Troca de óleo
          </div>
          <div className="form-grid">
            <Field label="Marca do óleo" error={E.oil_brand}>
              <input value={v.oil_brand} onChange={set('oil_brand')} maxLength={60} />
            </Field>
            <Field label="Tipo (viscosidade)" error={E.oil_type}>
              <input value={v.oil_type} onChange={set('oil_type')} maxLength={60} placeholder="Ex.: 15W40" list="oil-types" />
              <datalist id="oil-types">
                {['15W40', '10W40', '5W30', '10W30', '15W30', 'SAE 40', 'SAE 90', '85W140'].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Especificação" error={E.oil_spec}>
              <input value={v.oil_spec} onChange={set('oil_spec')} maxLength={60} placeholder="Ex.: API CK-4" />
            </Field>
            <Field label="Quantidade (litros)" error={E.oil_quantity}>
              <DecimalInput value={v.oil_quantity} onChange={set('oil_quantity')} />
            </Field>
            <div className="field span2">
              <label>Filtros trocados</label>
              <div className="btn-row">
                <label className="check">
                  <input type="checkbox" checked={v.oil_filter} onChange={toggleFilter('oil_filter', 'filtro_oleo')} /> Óleo
                </label>
                <label className="check">
                  <input type="checkbox" checked={v.fuel_filter} onChange={toggleFilter('fuel_filter', 'filtro_combustivel')} /> Combustível
                </label>
                <label className="check">
                  <input type="checkbox" checked={v.air_filter} onChange={toggleFilter('air_filter', 'filtro_ar')} /> Ar
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      <Field label="Descrição / serviços realizados" className="full" error={E.description}>
        <textarea value={v.description} onChange={set('description')} rows={3} maxLength={4000} />
      </Field>

      {showParts && (
        <div className="field full">
          <label>Peças utilizadas</label>
          <PartsEditor parts={v.parts} onChange={(parts) => setV((s) => ({ ...s, parts }))} />
        </div>
      )}
      {partsTotal !== null && !showParts && (
        <Field label="Valor das peças" hint="Soma das peças lançadas na OS">
          <input value={fmtMoney(partsTotal)} disabled />
        </Field>
      )}
      {showParts && !v.parts.some((p) => p.description.trim()) && (
        <Field label="Valor das peças (R$)" error={E.parts_cost} hint="Ou detalhe as peças acima">
          <DecimalInput value={v.parts_cost} onChange={set('parts_cost')} placeholder="0,00" />
        </Field>
      )}
      <Field label="Valor da mão de obra (R$)" error={E.labor_cost}>
        <DecimalInput value={v.labor_cost} onChange={set('labor_cost')} placeholder="0,00" />
      </Field>
      <Field label="Valor total">
        <input value={fmtMoney(total)} disabled />
      </Field>
      <Field label="Nota fiscal" error={E.invoice_number}>
        <input value={v.invoice_number} onChange={set('invoice_number')} maxLength={60} />
      </Field>

      <div className="full section-title" style={{ marginBottom: 0 }}>
        Próxima manutenção (gera alerta automático)
      </div>
      <Field label="Próxima por KM" error={E.next_km} hint={v.next_km && v.km ? `Daqui a ${fmtNum(v.next_km - v.km)} km` : null}>
        <div style={{ display: 'flex', gap: 6 }}>
          <IntInput value={v.next_km} onChange={set('next_km')} style={{ flex: 1 }} />
          {v.km ? (
            <button type="button" className="btn" title={`KM da manutenção + ${fmtNum(isOil ? oilInterval : 10000)} km`} onClick={() => set('next_km')(v.km + (isOil ? oilInterval : 10000))}>
              +{fmtNum((isOil ? oilInterval : 10000) / 1000)} mil
            </button>
          ) : null}
        </div>
      </Field>
      <Field label="Próxima por data" error={E.next_date}>
        <input type="date" value={v.next_date || ''} onChange={set('next_date')} />
      </Field>
      <Field label="Observações" className="full" error={E.notes}>
        <textarea value={v.notes || ''} onChange={set('notes')} rows={2} maxLength={4000} />
      </Field>
    </>
  );
}
