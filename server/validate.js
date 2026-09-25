import { badRequest } from './http.js';

// Validação simples baseada em esquema. Cada campo:
// { type, required, max, min, values, label }
// Retorna somente os campos do esquema, já normalizados.

export function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

export function normalizePlate(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(p) {
  // Padrão antigo (ABC1234) e Mercosul (ABC1D23)
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
}

export function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidRenavam(value) {
  let r = onlyDigits(value);
  if (!r || r.length > 11) return false;
  r = r.padStart(11, '0');
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(r[i]) * weights[i];
  let dv = (sum * 10) % 11;
  if (dv === 10) dv = 0;
  return dv === Number(r[10]);
}

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function coerce(name, def, raw) {
  const label = def.label || name;
  switch (def.type) {
    case 'string':
    case 'text': {
      const s = String(raw).trim();
      const max = def.max ?? (def.type === 'text' ? 5000 : 200);
      if (s.length > max) throw `${label}: máximo de ${max} caracteres`;
      if (def.min && s.length < def.min) throw `${label}: mínimo de ${def.min} caracteres`;
      return def.upper ? s.toUpperCase() : s;
    }
    case 'int': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\./g, '').replace(',', '.'));
      if (!Number.isInteger(n)) throw `${label}: número inteiro inválido`;
      if (def.min !== undefined && n < def.min) throw `${label}: mínimo ${def.min}`;
      if (def.max !== undefined && n > def.max) throw `${label}: máximo ${def.max}`;
      return n;
    }
    case 'number': {
      let n = raw;
      if (typeof raw === 'string') {
        const s = raw.trim();
        // aceita "1.234,56" e "1234.56"
        n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
      }
      if (typeof n !== 'number' || !Number.isFinite(n)) throw `${label}: número inválido`;
      if (def.min !== undefined && n < def.min) throw `${label}: mínimo ${def.min}`;
      if (def.max !== undefined && n > def.max) throw `${label}: máximo ${def.max}`;
      return n;
    }
    case 'bool':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'date': {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw `${label}: data inválida`;
      return s;
    }
    case 'datetime': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw `${label}: data/hora inválida`;
      return d.toISOString();
    }
    case 'enum': {
      const s = String(raw);
      if (!def.values.includes(s)) throw `${label}: valor inválido`;
      return s;
    }
    case 'uuid': {
      const s = String(raw);
      if (!/^[0-9a-f-]{36}$/i.test(s)) throw `${label}: identificador inválido`;
      return s;
    }
    case 'plate': {
      const p = normalizePlate(raw);
      if (!isValidPlate(p)) throw `${label}: placa inválida (use ABC1234 ou ABC1D23)`;
      return p;
    }
    case 'cpf': {
      if (!isValidCpf(raw)) throw `${label}: CPF inválido`;
      return onlyDigits(raw);
    }
    case 'renavam': {
      if (!isValidRenavam(raw)) throw `${label}: RENAVAM inválido`;
      return onlyDigits(raw).padStart(11, '0');
    }
    case 'digits': {
      const d = onlyDigits(raw);
      if (def.max && d.length > def.max) throw `${label}: máximo de ${def.max} dígitos`;
      return d;
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 200) throw `${label}: e-mail inválido`;
      return s;
    }
    default:
      throw new Error(`tipo de validação desconhecido: ${def.type}`);
  }
}

/**
 * @param {object} body dados recebidos
 * @param {object} schema esquema
 * @param {{partial?: boolean}} opts partial=true valida só os campos presentes (edição)
 */
export function validate(body, schema, { partial = false } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  const out = {};
  const errors = {};
  for (const [name, def] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(src, name);
    if (partial && !present) continue;
    const raw = src[name];
    if (isEmpty(raw)) {
      if (def.required) errors[name] = `${def.label || name}: obrigatório`;
      else out[name] = def.type === 'bool' ? false : null;
      continue;
    }
    try {
      out[name] = coerce(name, def, raw);
    } catch (e) {
      if (typeof e === 'string') errors[name] = e;
      else throw e;
    }
  }
  if (Object.keys(errors).length) {
    throw badRequest(Object.values(errors)[0], { fields: errors });
  }
  return out;
}
