import { useState } from 'react';
import { qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { ACCESS_EVENTS } from '../../../shared/labels.js';

const FAIL = ['login_falha', 'login_bloqueado', 'login_suspeito', 'senha_falha'];

export function AccessTable({ entries, showUser = true }) {
  return (
    <DataTable
      rows={entries}
      columns={[
        { key: 'created_at', label: 'Data/hora', mobile: 'title', className: 'nowrap', render: (e) => fmtDateTime(e.created_at) },
        showUser && { key: 'username', label: 'Usuário', render: (e) => e.username || '—' },
        {
          key: 'event',
          label: 'Evento',
          render: (e) => <span className={`badge ${FAIL.includes(e.event) ? 'danger' : e.event === 'login_ok' ? 'ok' : 'muted'}`}>{ACCESS_EVENTS[e.event] || e.event}</span>,
        },
        { key: 'detail', label: 'Detalhe', render: (e) => e.detail || '—' },
        { key: 'ip', label: 'IP', className: 'mono small', render: (e) => e.ip || '—' },
        {
          key: 'user_agent',
          label: 'Dispositivo',
          mobile: false,
          render: (e) => <span className="small muted">{deviceName(e.user_agent)}</span>,
        },
      ].filter(Boolean)}
      empty="Nenhum acesso registrado."
    />
  );
}

export function deviceName(ua = '') {
  if (!ua) return '—';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

export default function AccessLog() {
  const { can } = useAuth();
  const users = useFetch(can('usuarios') ? '/users' : null);
  const [f, setF] = useState({ user_id: '', falhas: '', from: '', to: '' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? (v.target.type === 'checkbox' ? (v.target.checked ? '1' : '') : v.target.value) : v || '' }));
  const { data, loading, error, reload } = useFetch(`/access-log${qs(f)}`);
  return (
    <Guard anyOf={['usuarios', 'auditoria']}>
      <PageHead title="Histórico de acessos" code="905" sub="Logins, saídas, falhas de senha e tentativas suspeitas." />
      <div className="filters">
        {users.data && (
          <Field label="Usuário">
            <Select value={f.user_id} onChange={set('user_id')} options={users.data.users.map((u) => ({ key: u.id, label: u.full_name }))} placeholder="Todos" />
          </Field>
        )}
        <Field label="De">
          <input type="date" value={f.from} onChange={set('from')} />
        </Field>
        <Field label="Até">
          <input type="date" value={f.to} onChange={set('to')} />
        </Field>
        <label className="check" style={{ height: 34 }}>
          <input type="checkbox" checked={f.falhas === '1'} onChange={set('falhas')} /> Somente falhas e tentativas suspeitas
        </label>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : <AccessTable entries={data.entries} />}
    </Guard>
  );
}
