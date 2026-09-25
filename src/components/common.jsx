import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { ALL_ITEMS } from '../lib/nav.js';

export function PageHead({ title, code, back, children, sub }) {
  return (
    <>
      {back && (
        <Link to={back} className="back">
          <ArrowLeft size={14} /> Voltar
        </Link>
      )}
      <div className="page-head">
        <div style={{ marginRight: 'auto', minWidth: 0 }}>
          <h1>
            {title} {code && <span className="code-tag">{code}</span>}
          </h1>
          {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
        </div>
        {children}
      </div>
    </>
  );
}

/** Bloqueia a página se o usuário não tiver a permissão (o servidor também bloqueia). */
export function Guard({ module, action = 'ver', anyOf, children }) {
  const { can } = useAuth();
  const ok = anyOf ? anyOf.some((m) => can(m, 'ver')) : can(module, action);
  if (!ok) return <NoAccess />;
  return children;
}

export function NoAccess() {
  return (
    <div className="card soon-box">
      <Lock size={28} />
      <h2>Sem permissão</h2>
      <p>Você não tem acesso a esta tela. Se precisar, peça ao administrador para liberar.</p>
    </div>
  );
}

const PHASES = {
  2: 'Abastecimentos, ordens de abastecimento e médias de consumo',
  3: 'Manutenções, ordens de serviço, trocas de óleo, calendário e alertas de manutenção',
  4: 'Controle completo de pneus: mapa de eixos, movimentações e recapagens',
  5: 'Checklists, documentos, custos, relatórios (PDF/Excel) e backup',
};

export function Soon() {
  const location = useLocation();
  const item = ALL_ITEMS.find((i) => i.path === location.pathname);
  const phase = item?.phase;
  return (
    <>
      <PageHead title={item?.label || 'Em construção'} code={item?.code} />
      <div className="card soon-box">
        <h2>Disponível na fase {phase || 'seguinte'}</h2>
        <p>{PHASES[phase] || 'Este módulo será liberado nas próximas etapas.'}</p>
        <p className="small">A estrutura do sistema (usuários, permissões, veículos e motoristas) já está pronta para receber este módulo.</p>
      </div>
    </>
  );
}
