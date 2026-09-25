import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { useFetch, Loading, ErrorBox, DataTable } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { fmtDateTime, fmtDate, relative } from '../../lib/format.js';
import { MODULES, ACTIONS } from '../../../shared/constants.js';

export function UserStatus({ u }) {
  if (u.is_master) return <span className="badge info">Administrador Principal</span>;
  if (!u.is_active) return <span className="badge off">Inativo</span>;
  if (u.locked_until && new Date(u.locked_until) > new Date()) return <span className="badge danger">Bloqueado</span>;
  if (u.must_change_password) return <span className="badge warn">Ativo · troca de senha pendente</span>;
  return <span className="badge ok">Ativo</span>;
}

export default function Users() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/users');
  return (
    <Guard module="usuarios">
      <PageHead title="Usuários" code="901" sub="Somente o administrador cadastra usuários. Não existe cadastro público.">
        {can('usuarios', 'cadastrar') && (
          <Link to="/admin/usuarios/novo" className="btn primary">
            <Plus size={16} /> Novo usuário
          </Link>
        )}
      </PageHead>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.users}
          onRowClick={(u) => navigate(`/admin/usuarios/${u.id}`)}
          columns={[
            { key: 'full_name', label: 'Nome', mobile: 'title', render: (u) => <strong>{u.full_name}</strong> },
            { key: 'username', label: 'Usuário', className: 'mono' },
            { key: 'email', label: 'E-mail', render: (u) => u.email || '—' },
            { key: 'job_title', label: 'Cargo', render: (u) => (u.is_master ? 'Administrador Principal' : u.job_title || '—') },
            { key: 'is_active', label: 'Status', render: (u) => <UserStatus u={u} /> },
            { key: 'last_login_at', label: 'Último acesso', render: (u) => <span title={fmtDateTime(u.last_login_at)}>{relative(u.last_login_at)}</span> },
            { key: 'created_at', label: 'Criado em', render: (u) => fmtDate(u.created_at) },
          ]}
        />
      )}
    </Guard>
  );
}

// Visão geral de permissões de todos os usuários
const SHORT = { ver: 'V', cadastrar: 'C', editar: 'E', cancelar: 'Ca', excluir: 'X', exportar: 'Ex', aprovar: 'A' };

export function PermissionsOverview() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/users');
  const perms = useFetch('/users/permissions-overview');
  if (loading || perms.loading) return <Loading />;
  if (error || perms.error) return <ErrorBox error={error || perms.error} onRetry={() => (reload(), perms.reload())} />;
  const map = perms.data.permissions;
  return (
    <Guard module="usuarios">
      <PageHead title="Permissões" code="903" sub="V = visualizar · C = cadastrar · E = editar · Ca = cancelar · X = excluir · Ex = exportar · A = aprovar. Clique no usuário para alterar." />
      <div className="table-wrap">
        <table className="t perm-table">
          <thead>
            <tr>
              <th>Usuário</th>
              {MODULES.map((m) => (
                <th key={m.key} style={{ whiteSpace: 'normal', minWidth: 70 }}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="click" onClick={() => navigate(`/admin/usuarios/${u.id}?aba=permissoes`)}>
                <td className="nowrap">
                  <strong>{u.full_name}</strong>
                  {!u.is_active && <span className="badge off" style={{ marginLeft: 6 }}>inativo</span>}
                </td>
                {MODULES.map((m) => (
                  <td key={m.key}>
                    {u.is_master ? (
                      <span className="perm-chip">TOTAL</span>
                    ) : (
                      (map[u.id]?.[m.key] || []).map((a) => (
                        <span key={a} className="perm-chip" title={ACTIONS.find((x) => x.key === a)?.label}>
                          {SHORT[a]}
                        </span>
                      ))
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Guard>
  );
}
