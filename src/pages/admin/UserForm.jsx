import { useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { KeyRound, LockOpen, LogOut, Power } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { useFetch, useForm, useToast, useDialog, Field, Loading, ErrorBox, Tabs, Modal, enterNav, DataTable } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { UserStatus } from './Users.jsx';
import { AccessTable, deviceName } from './AccessLog.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { MODULES, ACTIONS, PERMISSION_PRESETS } from '../../../shared/constants.js';

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint32Array(8));
  return [...arr].map((n) => chars[n % chars.length]).join('');
}

/** Matriz módulo × ação. `limit` = permissões do usuário logado (não-admin só concede o que tem). */
export function PermissionMatrix({ value, onChange, disabled, limit }) {
  const has = (m, a) => value?.[m]?.includes(a);
  const allowed = (m, a) => !limit || limit(m, a);
  const toggle = (m, a) => {
    const mod = MODULES.find((x) => x.key === m);
    let acts = new Set(value?.[m] || []);
    if (acts.has(a)) {
      acts.delete(a);
      if (a === 'ver') acts = new Set(); // sem visualizar, nenhuma outra ação faz sentido
    } else {
      acts.add(a);
      acts.add('ver');
    }
    const next = { ...value };
    const ordered = mod.actions.filter((x) => acts.has(x));
    if (ordered.length) next[m] = ordered;
    else delete next[m];
    onChange(next);
  };
  const toggleRow = (m) => {
    const mod = MODULES.find((x) => x.key === m);
    const all = mod.actions.filter((a) => allowed(m, a));
    const full = all.every((a) => has(m, a));
    const next = { ...value };
    if (full) delete next[m];
    else next[m] = mod.actions.filter((a) => all.includes(a) || has(m, a));
    onChange(next);
  };
  return (
    <div className="table-wrap">
      <table className="t perm-table">
        <thead>
          <tr>
            <th>Módulo</th>
            {ACTIONS.map((a) => (
              <th key={a.key}>{a.label}</th>
            ))}
            <th>Tudo</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m.key}>
              <td className="nowrap">
                <strong>{m.label}</strong>
                {m.key === 'usuarios' && <div className="small muted">Cadastrar = pode criar outros usuários</div>}
              </td>
              {ACTIONS.map((a) => (
                <td key={a.key}>
                  {m.actions.includes(a.key) ? (
                    <input
                      type="checkbox"
                      checked={Boolean(has(m.key, a.key))}
                      disabled={disabled || (!has(m.key, a.key) && !allowed(m.key, a.key))}
                      onChange={() => toggle(m.key, a.key)}
                      aria-label={`${m.label}: ${a.label}`}
                    />
                  ) : (
                    <span className="na">—</span>
                  )}
                </td>
              ))}
              <td>
                <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => toggleRow(m.key)}>
                  {m.actions.every((a) => has(m.key, a)) ? 'Limpar' : 'Todos'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PresetBar({ onPick, disabled }) {
  return (
    <div className="btn-row" style={{ marginBottom: 10 }}>
      <span className="muted small">Modelos rápidos:</span>
      {Object.entries(PERMISSION_PRESETS).map(([k, p]) => (
        <button key={k} type="button" className="btn sm" disabled={disabled} onClick={() => onPick(p.build())}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function NewUser() {
  const { user: me, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { values: v, set, errors: E, saving, submit, setValues } = useForm({
    full_name: '',
    username: '',
    email: '',
    job_title: '',
    password: randomPassword(),
    is_active: true,
    must_change_password: true,
    permissions: {},
  });
  const limit = me.is_master ? null : (m, a) => can(m, a);
  const onSubmit = submit(async (vals) => {
    try {
      const r = await api('/users', { method: 'POST', body: vals });
      toast('Usuário criado.');
      navigate(`/admin/usuarios/${r.id}`, { replace: true, state: { newPassword: vals.password } });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return (
    <Guard module="usuarios" action="cadastrar">
      <PageHead title="Novo usuário" code="902" back="/admin/usuarios" />
      <form onSubmit={onSubmit} onKeyDown={enterNav}>
        <div className="card">
          <div className="card-head">
            <h2>Dados de acesso</h2>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Nome completo" required error={E.full_name} className="span2">
                <input value={v.full_name} onChange={set('full_name')} maxLength={120} autoFocus />
              </Field>
              <Field label="Usuário (para login)" required error={E.username} hint="Letras sem acento, números, ponto ou hífen">
                <input
                  value={v.username}
                  onChange={(e) => set('username')(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                  maxLength={40}
                  autoCapitalize="none"
                  className="mono"
                />
              </Field>
              <Field label="E-mail" error={E.email} hint="Opcional">
                <input type="email" value={v.email} onChange={set('email')} maxLength={200} />
              </Field>
              <Field label="Cargo / função" error={E.job_title}>
                <input value={v.job_title} onChange={set('job_title')} maxLength={80} />
              </Field>
              <Field label="Senha provisória" required error={E.password} hint="Anote e entregue ao usuário">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={v.password} onChange={set('password')} className="mono" style={{ flex: 1 }} autoComplete="off" />
                  <button type="button" className="btn" onClick={() => set('password')(randomPassword())} title="Gerar outra">
                    Gerar
                  </button>
                </div>
              </Field>
              <div className="field">
                <label>Opções</label>
                <label className="check">
                  <input type="checkbox" checked={v.must_change_password} onChange={set('must_change_password')} /> Exigir nova senha no 1º acesso
                </label>
                <label className="check">
                  <input type="checkbox" checked={v.is_active} onChange={set('is_active')} /> Ativo
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Permissões</h2>
          </div>
          <div className="card-body">
            <PresetBar onPick={(p) => setValues((s) => ({ ...s, permissions: limitTo(p, limit) }))} />
            <PermissionMatrix value={v.permissions} onChange={(p) => setValues((s) => ({ ...s, permissions: p }))} limit={limit} />
            {!me.is_master && <p className="muted small">Você só pode conceder permissões que você mesmo possui.</p>}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Criar usuário'}
          </button>
        </div>
      </form>
    </Guard>
  );
}

function limitTo(perms, limit) {
  if (!limit) return perms;
  const out = {};
  for (const [m, acts] of Object.entries(perms)) {
    const ok = acts.filter((a) => limit(m, a));
    if (ok.length) out[m] = ok;
  }
  return out;
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const toast = useToast();
  const [pw, setPw] = useState(randomPassword());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/users/${user.id}/reset-password`, { method: 'POST', body: { password: pw } });
      toast('Senha redefinida.');
      onDone(pw);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Redefinir senha — ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" disabled={busy || pw.length < 6} onClick={save}>
            Redefinir
          </button>
        </>
      }
    >
      <Field label="Nova senha provisória" hint="O usuário será obrigado a criar uma nova senha no próximo login. As sessões abertas serão encerradas.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={pw} onChange={(e) => setPw(e.target.value)} className="mono" style={{ flex: 1 }} autoFocus />
          <button type="button" className="btn" onClick={() => setPw(randomPassword())}>
            Gerar
          </button>
        </div>
      </Field>
    </Modal>
  );
}

function EditUser({ id }) {
  const { user: me, can, refresh } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'dados';
  const { data, loading, error, reload } = useFetch(`/users/${id}`);
  const access = useFetch(tab === 'acessos' ? `/access-log?user_id=${id}&limit=300` : null, [tab]);
  const location = useLocation();
  const [modal, setModal] = useState(null);
  const [lastPw, setLastPw] = useState(location.state?.newPassword || null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const u = data.user;
  const self = u.id === me.id;
  const canEdit = can('usuarios', 'editar') && (!u.is_master || me.is_master);
  const limit = me.is_master ? null : (m, a) => can(m, a);

  const action = async (fn, msg) => {
    try {
      await fn();
      toast(msg);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggleActive = async () => {
    if (u.is_active) {
      const reason = await dialog.prompt({
        title: 'Desativar usuário',
        message: `${u.full_name} perderá o acesso imediatamente. O histórico é mantido e ele pode ser reativado depois.`,
        label: 'Motivo',
        required: false,
        danger: true,
        confirmLabel: 'Desativar',
      });
      if (reason === null) return;
      action(() => api(`/users/${u.id}/status`, { method: 'POST', body: { is_active: false, reason } }), 'Usuário desativado.');
    } else {
      action(() => api(`/users/${u.id}/status`, { method: 'POST', body: { is_active: true } }), 'Usuário reativado.');
    }
  };

  const locked = u.locked_until && new Date(u.locked_until) > new Date();

  return (
    <Guard module="usuarios">
      <PageHead title={u.full_name} back="/admin/usuarios" sub={`Usuário: ${u.username}`}>
        <div className="btn-row">
          <UserStatus u={u} />
          {canEdit && !self && !u.is_master && (
            <>
              <button type="button" className="btn" onClick={() => setModal('reset')}>
                <KeyRound size={15} /> Redefinir senha
              </button>
              {locked && (
                <button type="button" className="btn" onClick={() => action(() => api(`/users/${u.id}/unlock`, { method: 'POST' }), 'Usuário desbloqueado.')}>
                  <LockOpen size={15} /> Desbloquear
                </button>
              )}
              <button type="button" className={`btn ${u.is_active ? 'danger' : ''}`} onClick={toggleActive}>
                <Power size={15} /> {u.is_active ? 'Desativar' : 'Reativar'}
              </button>
            </>
          )}
        </div>
      </PageHead>

      {lastPw && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          Nova senha provisória: <strong className="mono">{lastPw}</strong> — entregue ao usuário. Ela não será exibida novamente.
        </div>
      )}
      {u.is_master && (
        <div className="notice info" style={{ marginBottom: 12 }}>
          Administrador Principal: acesso total a todos os módulos. Não pode ser desativado nem ter o acesso alterado por outros usuários.
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'dados', label: 'Dados' },
          !u.is_master && { key: 'permissoes', label: 'Permissões' },
          { key: 'sessoes', label: 'Sessões ativas' },
          { key: 'acessos', label: 'Histórico de acessos' },
        ].filter(Boolean)}
        active={tab}
        onChange={(k) => setParams({ aba: k }, { replace: true })}
      />

      {tab === 'dados' && <UserDataForm u={u} canEdit={canEdit || self} self={self} onSaved={() => (reload(), self && refresh())} />}
      {tab === 'permissoes' && !u.is_master && (
        <PermissionsEditor u={u} canEdit={canEdit && !self} limit={limit} onSaved={reload} self={self} />
      )}
      {tab === 'sessoes' && (
        <div className="card">
          <div className="card-head">
            <h2>Sessões ativas</h2>
            {(canEdit || self) && u.active_sessions.length > 0 && (
              <button type="button" className="btn sm danger" onClick={() => action(() => api(`/users/${u.id}/revoke-sessions`, { method: 'POST' }), 'Sessões encerradas.')}>
                <LogOut size={14} /> Encerrar {self ? 'outras sessões' : 'todas'}
              </button>
            )}
          </div>
          <DataTable
            rows={u.active_sessions}
            columns={[
              { key: 'created_at', label: 'Entrou em', mobile: 'title', render: (s) => fmtDateTime(s.created_at) },
              { key: 'last_seen_at', label: 'Última atividade', render: (s) => fmtDateTime(s.last_seen_at) },
              { key: 'expires_at', label: 'Expira em', render: (s) => fmtDateTime(s.expires_at) },
              { key: 'remember', label: 'Manter conectado', render: (s) => (s.remember ? 'Sim' : 'Não') },
              { key: 'ip', label: 'IP', className: 'mono small' },
              { key: 'user_agent', label: 'Dispositivo', render: (s) => deviceName(s.user_agent) },
            ]}
            empty="Nenhuma sessão ativa."
          />
        </div>
      )}
      {tab === 'acessos' && (access.loading && !access.data ? <Loading /> : access.error ? <ErrorBox error={access.error} /> : access.data && <AccessTable entries={access.data.entries} showUser={false} />)}

      {modal === 'reset' && (
        <ResetPasswordModal
          user={u}
          onClose={() => setModal(null)}
          onDone={(pw) => {
            setModal(null);
            setLastPw(pw);
            reload();
          }}
        />
      )}
    </Guard>
  );
}

function UserDataForm({ u, canEdit, self, onSaved }) {
  const toast = useToast();
  const { values: v, set, errors: E, saving, submit } = useForm({
    full_name: u.full_name,
    username: u.username,
    email: u.email || '',
    job_title: u.job_title || '',
    must_change_password: u.must_change_password,
  });
  const onSubmit = submit(async (vals) => {
    const body = { ...vals };
    if (self) delete body.must_change_password;
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body });
      toast('Dados salvos.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return (
    <form className="card" onSubmit={onSubmit} onKeyDown={enterNav}>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Nome completo" required error={E.full_name} className="span2">
            <input value={v.full_name} onChange={set('full_name')} disabled={!canEdit} maxLength={120} />
          </Field>
          <Field label="Usuário (login)" required error={E.username}>
            <input value={v.username} onChange={(e) => set('username')(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} disabled={!canEdit} className="mono" />
          </Field>
          <Field label="E-mail" error={E.email}>
            <input type="email" value={v.email} onChange={set('email')} disabled={!canEdit} />
          </Field>
          <Field label="Cargo / função" error={E.job_title}>
            <input value={v.job_title} onChange={set('job_title')} disabled={!canEdit || u.is_master} />
          </Field>
          {!self && !u.is_master && (
            <div className="field">
              <label>Senha</label>
              <label className="check">
                <input type="checkbox" checked={v.must_change_password} onChange={set('must_change_password')} disabled={!canEdit} /> Exigir nova senha no próximo acesso
              </label>
            </div>
          )}
        </div>
        <div className="dl" style={{ marginTop: 14 }}>
          <div>
            <div className="k">Último acesso</div>
            <div className="v">{fmtDateTime(u.last_login_at)}</div>
          </div>
          <div>
            <div className="k">Criado em</div>
            <div className="v">{fmtDateTime(u.created_at)}</div>
          </div>
          <div>
            <div className="k">Criado por</div>
            <div className="v">{u.created_by_name || 'sistema'}</div>
          </div>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar dados'}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function PermissionsEditor({ u, canEdit, limit, onSaved, self }) {
  const toast = useToast();
  const [perms, setPerms] = useState(u.permissions || {});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(perms) !== JSON.stringify(u.permissions || {});
  const save = async () => {
    setBusy(true);
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: { permissions: perms } });
      toast('Permissões salvas. Valem a partir da próxima ação do usuário.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Permissões por módulo</h2>
        {canEdit && (
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={save}>
            Salvar permissões
          </button>
        )}
      </div>
      <div className="card-body">
        {self && <div className="notice warn" style={{ marginBottom: 10 }}>Você não pode alterar suas próprias permissões.</div>}
        {canEdit && <PresetBar onPick={(p) => setPerms(limitTo(p, limit))} />}
        <PermissionMatrix value={perms} onChange={setPerms} disabled={!canEdit} limit={limit} />
        {dirty && <div className="notice warn" style={{ marginTop: 10 }}>Há alterações não salvas.</div>}
      </div>
    </div>
  );
}

export default function UserForm() {
  const { id } = useParams();
  return id ? <EditUser id={id} key={id} /> : <NewUser />;
}
