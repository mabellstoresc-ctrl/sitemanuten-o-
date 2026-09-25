import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Menu, LogOut, Bell, UserRound } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api, qs } from '../api.js';
import { MENU, ALL_ITEMS, itemAllowed, findByCode } from '../lib/nav.js';

function Sidebar({ onNavigate }) {
  const { can } = useAuth();
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/logo-branco.png" alt="Rododimi Transportes e Logística" />
      </div>
      <nav className="nav">
        {MENU.map((g, gi) => {
          const items = g.items.filter((i) => !i.hidden && itemAllowed(i, can));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.group && <div className="nav-group">{g.group}</div>}
              {items.map((i) => {
                const Icon = i.icon;
                return (
                  <NavLink
                    key={i.code}
                    to={i.path}
                    end={i.path === '/' || i.path === '/abastecimentos' || i.path === '/pneus'}
                    className={({ isActive }) => `${isActive ? 'active' : ''} ${i.phase ? 'soon' : ''}`}
                    onClick={onNavigate}
                    title={i.phase ? `Disponível na fase ${i.phase}` : undefined}
                  >
                    {Icon ? <Icon size={16} /> : <span style={{ width: 16 }} />}
                    <span className="label">{i.label}</span>
                    <span className="code">{i.code}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function GlobalSearch() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  // Atalho: F2 ou "/" foca a busca
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.key === 'F2' || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const codeMatches = useMemo(() => {
    const t = q.trim();
    if (!/^\d{1,3}$/.test(t)) return [];
    return ALL_ITEMS.filter((i) => i.code.startsWith(t) && itemAllowed(i, can)).map((i) => ({
      kind: 'código',
      title: `${i.code} · ${i.label}`,
      subtitle: i.phase ? `Fase ${i.phase}` : '',
      link: i.path,
    }));
  }, [q, can]);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || /^\d{1,3}$/.test(t)) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      try {
        const { results } = await api(`/search${qs({ q: t })}`);
        setResults(results);
        setSel(0);
      } catch {
        setResults([]);
      }
    }, 220);
    return () => clearTimeout(h);
  }, [q]);

  const list = codeMatches.length ? codeMatches : results;

  const go = (item) => {
    if (!item) return;
    navigate(item.link);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = /^\d{3}$/.test(q.trim()) ? findByCode(q.trim()) : null;
      if (exact && itemAllowed(exact, can)) go({ link: exact.path });
      else go(list[sel]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search">
      <Search size={16} />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="Código da tela (ex.: 101) ou placa, frota, motorista…  [F2]"
        aria-label="Pesquisa global"
      />
      {open && q.trim().length > 0 && (list.length > 0 || q.trim().length >= 2) && (
        <div className="search-results">
          {list.map((r, i) => (
            <a
              key={`${r.kind}-${r.id || r.link}`}
              href={`#${r.link}`}
              className={i === sel ? 'sel' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r);
              }}
            >
              <span className="kind">{r.kind}</span>
              <span>
                <strong>{r.title}</strong>
                {r.subtitle && <span className="muted small"> · {r.subtitle}</span>}
              </span>
            </a>
          ))}
          {!list.length && <div className="item muted small">Nada encontrado.</div>}
        </div>
      )}
    </div>
  );
}

function AlertBell() {
  const [count, setCount] = useState(0);
  const location = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () =>
      api('/alerts')
        .then(({ alerts }) => alive && setCount(alerts.filter((a) => a.level !== 'info').length))
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60e3);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [location.pathname]);
  return (
    <NavLink to="/alertas" className="btn ghost icon alert-btn" title="Alertas" aria-label={`Alertas (${count})`}>
      <Bell size={18} />
      {count > 0 && <span className="count">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="overlay" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon menu-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="user">
            <AlertBell />
            <NavLink to="/minha-conta" className="btn ghost" title="Minha conta" style={{ gap: 8 }}>
              <UserRound size={18} />
              <span className="who">
                <strong>{user.full_name.split(' ')[0]}</strong>
                <br />
                <span className="muted small">{user.is_master ? 'Administrador Principal' : user.job_title || user.username}</span>
              </span>
            </NavLink>
            <button type="button" className="btn ghost icon" onClick={logout} title="Sair" aria-label="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
