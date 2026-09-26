import {
  LayoutDashboard,
  Truck,
  Container,
  UserRound,
  Fuel,
  Wrench,
  CircleDot,
  ClipboardCheck,
  FileText,
  Wallet,
  ChartColumn,
  Users,
  ShieldCheck,
  History,
  Settings,
  Bell,
  KeyRound,
} from 'lucide-react';

// Menu lateral + códigos de acesso rápido (estilo SSW: digite o código na barra do topo).
// module: permissão "ver" necessária; phase: módulo ainda não liberado (aparece como "breve").
export const MENU = [
  {
    items: [
      { code: '001', label: 'Painel', path: '/', icon: LayoutDashboard, module: 'dashboard' },
      { code: '002', label: 'Alertas', path: '/alertas', icon: Bell },
    ],
  },
  {
    group: 'Frota',
    items: [
      { code: '101', label: 'Veículos', path: '/veiculos', icon: Truck, module: 'veiculos' },
      { code: '102', label: 'Novo veículo', path: '/veiculos/novo', module: 'veiculos', action: 'cadastrar', hidden: true },
      { code: '103', label: 'Implementos', path: '/implementos', icon: Container, module: 'veiculos' },
    ],
  },
  {
    group: 'Motoristas',
    items: [
      { code: '201', label: 'Motoristas', path: '/motoristas', icon: UserRound, module: 'motoristas' },
      { code: '202', label: 'Novo motorista', path: '/motoristas/novo', module: 'motoristas', action: 'cadastrar', hidden: true },
    ],
  },
  {
    group: 'Abastecimentos',
    items: [
      { code: '301', label: 'Novo abastecimento', path: '/abastecimentos/novo', icon: Fuel, module: 'abastecimentos', action: 'cadastrar' },
      { code: '302', label: 'Ordens de abastecimento', path: '/abastecimentos/ordens', module: 'ordens_abastecimento' },
      { code: '303', label: 'Histórico', path: '/abastecimentos', module: 'abastecimentos' },
      { code: '304', label: 'Médias', path: '/abastecimentos/medias', module: 'abastecimentos' },
    ],
  },
  {
    group: 'Manutenção',
    items: [
      { code: '401', label: 'Ordens de serviço', path: '/manutencao/os', icon: Wrench, module: 'manutencoes' },
      { code: '402', label: 'Preventivas', path: '/manutencao/preventivas', module: 'manutencoes' },
      { code: '403', label: 'Corretivas', path: '/manutencao/corretivas', module: 'manutencoes' },
      { code: '404', label: 'Trocas de óleo', path: '/manutencao/oleo', module: 'manutencoes' },
      { code: '405', label: 'Calendário', path: '/manutencao/calendario', module: 'manutencoes' },
    ],
  },
  {
    group: 'Pneus',
    items: [
      { code: '501', label: 'Pneus instalados', path: '/pneus', icon: CircleDot, module: 'pneus' },
      { code: '502', label: 'Estoque', path: '/pneus/estoque', module: 'pneus' },
      { code: '503', label: 'Movimentações', path: '/pneus/movimentacoes', module: 'pneus' },
      { code: '504', label: 'Recapagens', path: '/pneus/recapagens', module: 'pneus' },
      { code: '505', label: 'Histórico', path: '/pneus/historico', module: 'pneus' },
    ],
  },
  {
    group: 'Controle',
    items: [
      { code: '601', label: 'Checklists', path: '/checklists', icon: ClipboardCheck, module: 'checklists', phase: 5 },
      { code: '701', label: 'Documentos', path: '/documentos', icon: FileText, module: 'documentos', phase: 5 },
      { code: '801', label: 'Custos', path: '/custos', icon: Wallet, module: 'custos', phase: 5 },
      { code: '851', label: 'Relatórios', path: '/relatorios', icon: ChartColumn, module: 'relatorios', phase: 5 },
    ],
  },
  {
    group: 'Administração',
    items: [
      { code: '901', label: 'Usuários', path: '/admin/usuarios', icon: Users, module: 'usuarios' },
      { code: '902', label: 'Novo usuário', path: '/admin/usuarios/novo', module: 'usuarios', action: 'cadastrar', hidden: true },
      { code: '903', label: 'Permissões', path: '/admin/permissoes', icon: ShieldCheck, module: 'usuarios' },
      { code: '904', label: 'Auditoria', path: '/admin/auditoria', icon: History, module: 'auditoria' },
      { code: '905', label: 'Histórico de acessos', path: '/admin/acessos', icon: KeyRound, anyOf: ['usuarios', 'auditoria'] },
      { code: '990', label: 'Configurações', path: '/configuracoes', icon: Settings, module: 'configuracoes' },
    ],
  },
];

export const ALL_ITEMS = MENU.flatMap((g) => g.items);

export function itemAllowed(item, can) {
  if (item.anyOf) return item.anyOf.some((m) => can(m, 'ver'));
  if (!item.module) return true;
  return can(item.module, item.action || 'ver');
}

export function findByCode(code) {
  return ALL_ITEMS.find((i) => i.code === code);
}

export function findByPath(path) {
  return ALL_ITEMS.find((i) => i.path === path);
}
