import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { qs, downloadFile } from '../../api.js';
import { useFetch, Loading, ErrorBox, DataTable, Field, Select, useToast } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDateTime, fmtCpf } from '../../lib/format.js';
import { FIELD_LABELS, ACTION_LABELS, ENTITY_LABELS } from '../../../shared/labels.js';
import { MODULES, ACTIONS, VEHICLE_STATUS, DRIVER_STATUS, VEHICLE_TYPES, FUEL_TYPES, FUELING_TYPES, FUEL_ORDER_STATUS, FUELING_STATUS } from '../../../shared/constants.js';

const ENUMS = {
  status: [...VEHICLE_STATUS, ...DRIVER_STATUS, ...FUEL_ORDER_STATUS, ...FUELING_STATUS],
  type: [...VEHICLE_TYPES],
  fuel_type: [...FUEL_TYPES, ...FUELING_TYPES],
};
const MONEY = ['total', 'price_per_liter', 'max_amount'];
const actionShort = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label.toLowerCase()]));

function fmtValue(campo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (campo === 'cpf') return fmtCpf(v);
  if (MONEY.includes(campo)) return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: campo === 'price_per_liter' ? 4 : 2 });
  if (campo === 'km') return `${Number(v).toLocaleString('pt-BR')} km`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (ENUMS[campo]) return ENUMS[campo].find((e) => e.key === v)?.label || String(v);
  if (campo === 'current_km' || campo.endsWith('_km')) return `${Number(v).toLocaleString('pt-BR')}${campo === 'current_km' ? ' km' : ''}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function permDiff(before = {}, after = {}) {
  const lines = [];
  for (const m of MODULES) {
    const a = new Set(before?.[m.key] || []);
    const b = new Set(after?.[m.key] || []);
    const added = [...b].filter((x) => !a.has(x));
    const removed = [...a].filter((x) => !b.has(x));
    if (added.length || removed.length) {
      lines.push(
        <div key={m.key}>
          <strong>{m.label}:</strong> {added.length > 0 && <span style={{ color: 'var(--ok)' }}>+{added.map((x) => actionShort[x]).join(', +')}</span>}{' '}
          {removed.length > 0 && <span style={{ color: 'var(--danger)' }}>−{removed.map((x) => actionShort[x]).join(', −')}</span>}
        </div>,
      );
    }
  }
  return lines.length ? lines : <span className="muted">sem permissões</span>;
}

export function ChangeList({ changes }) {
  if (!changes?.length) return <span className="muted">—</span>;
  return (
    <div className="small" style={{ minWidth: 200 }}>
      {changes.map((c, i) =>
        c.campo === 'permissoes' ? (
          <div key={i}>
            <span className="muted">Permissões:</span> {permDiff(c.anterior, c.novo)}
          </div>
        ) : (
          <div key={i}>
            <span className="muted">{FIELD_LABELS[c.campo] || c.campo}:</span> {c.anterior !== null && c.anterior !== undefined && <>{fmtValue(c.campo, c.anterior)} → </>}
            <strong>{fmtValue(c.campo, c.novo)}</strong>
          </div>
        ),
      )}
    </div>
  );
}

function entityLink(e) {
  if (!e.entity_id) return e.entity_label || '—';
  const map = {
    veiculo: '/veiculos/',
    vehicle: '/veiculos/',
    motorista: '/motoristas/',
    driver: '/motoristas/',
    usuario: '/admin/usuarios/',
    abastecimento: '/abastecimentos/',
    fueling: '/abastecimentos/',
    ordem_abastecimento: '/abastecimentos/ordens/',
    fuel_order: '/abastecimentos/ordens/',
  };
  const base = map[e.entity];
  const label = e.entity_label || e.entity_id.slice(0, 8);
  return base && e.action !== 'excluir' ? <Link to={base + e.entity_id}>{label}</Link> : label;
}

export default function Audit() {
  const { can } = useAuth();
  const toast = useToast();
  const users = useFetch(can('usuarios') ? '/users' : null);
  const [f, setF] = useState({ module: '', user_id: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const set = (k) => (v) => {
    setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v || '' }));
    setPage(1);
  };
  const query = qs({ ...f, page });
  const { data, loading, error, reload } = useFetch(`/audit${query}`);

  return (
    <Guard module="auditoria">
      <PageHead title="Auditoria" code="904" sub="Registro automático de quem alterou o quê, quando, com valor anterior e novo.">
        {can('auditoria', 'exportar') && (
          <button type="button" className="btn" onClick={() => downloadFile(`/audit/export${qs(f)}`, 'auditoria.csv').catch((e) => toast(e.message, 'error'))}>
            <Download size={15} /> Exportar (Excel/CSV)
          </button>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Módulo">
          <Select value={f.module} onChange={set('module')} options={MODULES.map((m) => ({ key: m.key, label: m.label }))} placeholder="Todos" />
        </Field>
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
        <Field label="Texto" className="grow">
          <input value={f.q} onChange={set('q')} placeholder="Placa, nome, motivo…" />
        </Field>
      </div>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.entries}
          footer={
            <>
              <span>Página {data.page}</span>
              <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ Anterior
              </button>
              <button type="button" className="btn sm" disabled={!data.has_more} onClick={() => setPage((p) => p + 1)}>
                Próxima ›
              </button>
            </>
          }
          columns={[
            { key: 'created_at', label: 'Data/hora', mobile: 'title', className: 'nowrap', render: (e) => fmtDateTime(e.created_at) },
            { key: 'username', label: 'Usuário' },
            { key: 'module', label: 'Módulo', render: (e) => MODULES.find((m) => m.key === e.module)?.label || e.module },
            { key: 'action', label: 'Ação', render: (e) => ACTION_LABELS[e.action] || e.action },
            { key: 'entity_label', label: 'Registro', render: (e) => <>{ENTITY_LABELS[e.entity] || e.entity}: {entityLink(e)}</> },
            { key: 'changes', label: 'Alterações', noSort: true, render: (e) => <ChangeList changes={e.changes} /> },
            { key: 'reason', label: 'Motivo', render: (e) => e.reason || '—' },
          ]}
          empty="Nenhum registro no período."
        />
      )}
    </Guard>
  );
}
