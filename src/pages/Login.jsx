import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Field } from '../components/ui.jsx';

export function PasswordInput({ value, onChange, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange} {...rest} />
      <button type="button" className="btn ghost icon sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} tabIndex={-1}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, remember);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <img className="logo" src="/logo-escuro.png" alt="Rododimi Transportes e Logística" />
        <div className="sub">Gestão de Frota e Manutenção</div>
        <form onSubmit={submit} autoComplete="on">
          <Field label="Usuário">
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Senha">
            <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Manter conectado
            </label>
            <button type="button" className="linklike" onClick={() => setForgot((f) => !f)}>
              Esqueci minha senha
            </button>
          </div>
          {forgot && (
            <div className="notice info">
              Procure o <strong>administrador do sistema</strong>. Ele vai definir uma senha provisória, e você cria uma nova no próximo acesso.
            </div>
          )}
          {error && <div className="notice danger">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
