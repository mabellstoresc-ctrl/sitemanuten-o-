import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api.js';
import { labelOf } from '../../shared/constants.js';

// ---------------- Dados ----------------
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (my === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (my === seq.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ---------------- Toast ----------------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((l) => [...l, { id, msg, type }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Modal ----------------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- Diálogos (confirmar / pedir motivo) ----------------
const DialogCtx = createContext(null);
export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const [text, setText] = useState('');
  const open = (opts) =>
    new Promise((resolve) => {
      setText(opts.defaultValue || '');
      setDlg({ ...opts, resolve });
    });
  const close = (value) => {
    dlg?.resolve(value);
    setDlg(null);
  };
  const api = {
    confirm: (opts) => open({ ...opts, kind: 'confirm' }),
    prompt: (opts) => open({ ...opts, kind: 'prompt' }),
  };
  const min = dlg?.minLength ?? (dlg?.required ? 1 : 0);
  const valid = dlg?.kind !== 'prompt' || text.trim().length >= min;
  return (
    <DialogCtx.Provider value={api}>
      {children}
      {dlg && (
        <Modal
          title={dlg.title || 'Confirmar'}
          onClose={() => close(dlg.kind === 'prompt' ? null : false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(dlg.kind === 'prompt' ? null : false)}>
                Voltar
              </button>
              <button
                type="button"
                className={`btn ${dlg.danger ? 'danger solid' : 'primary'}`}
                disabled={!valid}
                onClick={() => close(dlg.kind === 'prompt' ? text.trim() : true)}
                autoFocus={dlg.kind === 'confirm'}
              >
                {dlg.confirmLabel || 'Confirmar'}
              </button>
            </>
          }
        >
          {dlg.message && <div style={{ marginBottom: dlg.kind === 'prompt' ? 12 : 0, whiteSpace: 'pre-line' }}>{dlg.message}</div>}
          {dlg.kind === 'prompt' && (
            <Field label={dlg.label || 'Motivo'} required={dlg.required} hint={min > 1 ? `Mínimo de ${min} caracteres` : null}>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={dlg.placeholder}
                rows={3}
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && valid) {
                    e.preventDefault();
                    close(text.trim());
                  }
                }}
              />
            </Field>
          )}
        </Modal>
      )}
    </DialogCtx.Provider>
  );
}
export const useDialog = () => useContext(DialogCtx);

// ---------------- Formulários ----------------
export function Field({ label, required, hint, error, children, className = '' }) {
  return (
    <div className={`field ${error ? 'invalid' : ''} ${className}`}>
      {label && (
        <label>
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder = 'Selecione…', allowEmpty = true, ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

/** Inteiro com separador de milhar (ex.: quilometragem). */
export function IntInput({ value, onChange, grouping = true, ...rest }) {
  const empty = value === null || value === undefined || value === '';
  const display = empty ? '' : grouping ? Number(value).toLocaleString('pt-BR') : String(value);
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, '').slice(0, 9);
        onChange(d === '' ? null : Number(d));
      }}
      {...rest}
    />
  );
}

/** Decimal aceitando vírgula (ex.: litros, valores). Guarda como texto; o servidor converte. */
export function DecimalInput({ value, onChange, ...rest }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
      {...rest}
    />
  );
}

/**
 * Enter passa para o próximo campo (como no SSW). No último campo, envia o formulário.
 * Ctrl+Enter envia de qualquer lugar.
 */
export function enterNav(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  const form = e.currentTarget;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    form.requestSubmit();
    return;
  }
  if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.type === 'submit') return;
  if (!['INPUT', 'SELECT'].includes(t.tagName)) return;
  e.preventDefault();
  const focusables = [...form.querySelectorAll('input, select, textarea, button[type=submit]')].filter(
    (el) => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null && el.type !== 'file',
  );
  const i = focusables.indexOf(t);
  const next = focusables[i + 1];
  if (!next || next.type === 'submit') form.requestSubmit();
  else next.focus();
}

/** Estado de formulário com erros vindos da API. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (name) => (v) => {
    const value = v && v.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v;
    setValues((s) => ({ ...s, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: null } : e));
  };
  const submit = (fn) => async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    setErrors({});
    try {
      return await fn(values);
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      throw err;
    } finally {
      setSaving(false);
    }
  };
  return { values, setValues, set, errors, setErrors, saving, submit };
}

// ---------------- Exibição ----------------
export function StatusBadge({ list, value }) {
  const item = list.find((i) => i.key === value);
  return <span className={`badge ${item?.tone || 'muted'}`}>{item?.label || value}</span>;
}

export function Loading() {
  return (
    <div className="loading">
      <span className="spinner" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice danger" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ flex: 1 }}>{error.message}</span>
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Empty({ children = 'Nenhum registro encontrado.' }) {
  return <div className="empty">{children}</div>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
          {t.soon && <span className="soon">fase {t.soon}</span>}
        </button>
      ))}
    </div>
  );
}

export function Dl({ items }) {
  return (
    <div className="dl">
      {items
        .filter(Boolean)
        .map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v === null || v === undefined || v === '' ? '—' : v}</div>
          </div>
        ))}
    </div>
  );
}

/**
 * Tabela que vira lista de cartões no celular.
 * columns: [{ key, label, render?, className?, sort?: (row)=>valor, mobile?: false | 'title' }]
 */
export function DataTable({ columns, rows, onRowClick, rowKey = 'id', empty, footer, initialSort, dense }) {
  const [sort, setSort] = useState(initialSort || null);
  let data = rows || [];
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    const getter = col?.sort || ((r) => r[sort.key]);
    data = [...data].sort((a, b) => {
      const x = getter(a);
      const y = getter(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
  }
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key] ?? '—');
  const titleCol = columns.find((c) => c.mobile === 'title') || columns[0];
  return (
    <div className="table-wrap responsive">
      <table className={`t ${dense ? 'dense' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.className || ''} ${c.noSort ? '' : 'sortable'}`}
                onClick={() => !c.noSort && setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r[rowKey]} className={onRowClick ? 'click' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {cell(c, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cards-mobile">
        {data.map((r) => (
          <div key={r[rowKey]} className={`mcard ${onRowClick ? 'click' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <div className="mtitle">{cell(titleCol, r)}</div>
            {columns
              .filter((c) => c !== titleCol && c.mobile !== false)
              .map((c) => (
                <div className="mrow" key={c.key}>
                  <span className="mk">{c.label}</span>
                  <span className="mv">{cell(c, r)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      {!data.length && <Empty>{empty}</Empty>}
      {footer !== false && data.length > 0 && <div className="table-foot">{footer ?? `${data.length} registro(s)`}</div>}
    </div>
  );
}

export { labelOf };
