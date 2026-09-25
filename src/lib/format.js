const TZ = 'America/Sao_Paulo';

export function fmtDate(v) {
  if (!v) return '—';
  // 'YYYY-MM-DD' (campo de data) não sofre conversão de fuso
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(v).toLocaleDateString('pt-BR', { timeZone: TZ });
}

export function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

export function fmtKm(v) {
  if (v === null || v === undefined || v === '') return '—';
  return `${Number(v).toLocaleString('pt-BR')} km`;
}

export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtCpf(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v || '—';
}

export function fmtPlate(p) {
  if (!p) return '';
  return /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export function fmtBytes(n) {
  if (!n) return '0 KB';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

export function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Data/hora local no formato do <input type="datetime-local"> */
export function nowLocalInput() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(todayISO() + 'T00:00:00');
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 864e5);
}

export function relative(v) {
  if (!v) return 'nunca';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} dia(s)`;
  return fmtDate(v);
}
