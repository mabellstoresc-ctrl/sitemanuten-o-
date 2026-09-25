import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Field, useToast, Dl } from '../components/ui.jsx';
import { PageHead } from '../components/common.jsx';
import { PasswordInput } from './Login.jsx';
import { fmtDateTime } from '../lib/format.js';

function ChangePasswordForm({ onDone, submitLabel = 'Alterar senha' }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    setBusy(true);
    try {
      const { user } = await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Senha atual" required>
        <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Nova senha" required hint="Mínimo de 6 caracteres. Evite datas e sequências (123456).">
        <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Confirme a nova senha" required>
        <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && <div className="notice danger">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy || !current || !next || !confirm}>
        {busy ? 'Salvando…' : submitLabel}
      </button>
    </form>
  );
}

/** Tela obrigatória no primeiro acesso / após redefinição de senha. */
export function ForceChangePassword() {
  const { user, setUser, logout } = useAuth();
  return (
    <div className="login-page">
      <div className="login-box">
        <img className="logo" src="/logo-escuro.png" alt="Rododimi" />
        <div className="sub">
          Olá, <strong>{user.full_name.split(' ')[0]}</strong>. Por segurança, crie uma nova senha para continuar.
        </div>
        <ChangePasswordForm submitLabel="Salvar nova senha e entrar" onDone={(u) => setUser({ ...user, ...u, must_change_password: false })} />
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" className="linklike" onClick={logout}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  return (
    <>
      <PageHead title="Minha conta" code="999" />
      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h2>Dados</h2>
          </div>
          <div className="card-body">
            <Dl
              items={[
                ['Nome', user.full_name],
                ['Usuário', user.username],
                ['E-mail', user.email],
                ['Cargo', user.is_master ? 'Administrador Principal' : user.job_title],
                ['Último login', fmtDateTime(user.last_login_at)],
              ]}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Alterar senha</h2>
          </div>
          <div className="card-body">
            <ChangePasswordForm onDone={() => toast('Senha alterada. As outras sessões foram encerradas.')} />
          </div>
        </div>
      </div>
    </>
  );
}
