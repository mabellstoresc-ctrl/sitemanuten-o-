// Constantes compartilhadas entre o frontend e o backend.
// Alterar aqui reflete nas duas pontas (validação no servidor e opções na tela).

export const ACTIONS = [
  { key: 'ver', label: 'Visualizar' },
  { key: 'cadastrar', label: 'Cadastrar' },
  { key: 'editar', label: 'Editar' },
  { key: 'cancelar', label: 'Cancelar' },
  { key: 'excluir', label: 'Excluir' },
  { key: 'exportar', label: 'Exportar' },
  { key: 'aprovar', label: 'Aprovar' },
];

const CRUD = ['ver', 'cadastrar', 'editar', 'cancelar', 'excluir', 'exportar'];

// actions: quais ações fazem sentido para o módulo (as demais aparecem como "—" na matriz)
export const MODULES = [
  { key: 'dashboard', label: 'Painel', actions: ['ver'] },
  { key: 'veiculos', label: 'Veículos', actions: CRUD },
  { key: 'motoristas', label: 'Motoristas', actions: CRUD },
  { key: 'abastecimentos', label: 'Abastecimentos', actions: CRUD },
  { key: 'ordens_abastecimento', label: 'Ordens de abastecimento', actions: [...CRUD, 'aprovar'] },
  { key: 'manutencoes', label: 'Manutenções', actions: [...CRUD, 'aprovar'] },
  { key: 'pneus', label: 'Pneus', actions: CRUD },
  { key: 'documentos', label: 'Documentos', actions: CRUD },
  { key: 'checklists', label: 'Checklists', actions: CRUD },
  { key: 'custos', label: 'Custos', actions: CRUD },
  { key: 'relatorios', label: 'Relatórios', actions: ['ver', 'exportar'] },
  { key: 'usuarios', label: 'Usuários', actions: ['ver', 'cadastrar', 'editar'] },
  { key: 'configuracoes', label: 'Configurações', actions: ['ver', 'editar'] },
  { key: 'auditoria', label: 'Auditoria', actions: ['ver', 'exportar'] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

export function moduleActions(moduleKey) {
  return MODULES.find((m) => m.key === moduleKey)?.actions || [];
}

// Modelos prontos de permissão para agilizar o cadastro de usuários
export const PERMISSION_PRESETS = {
  nenhuma: { label: 'Nenhuma', build: () => ({}) },
  consulta: {
    label: 'Somente consulta',
    build: () =>
      Object.fromEntries(
        MODULES.filter((m) => !['usuarios', 'configuracoes', 'auditoria'].includes(m.key)).map((m) => [m.key, ['ver']]),
      ),
  },
  operacional: {
    label: 'Operacional (cadastra e edita)',
    build: () =>
      Object.fromEntries(
        MODULES.filter((m) => !['usuarios', 'configuracoes', 'auditoria'].includes(m.key)).map((m) => [
          m.key,
          m.actions.filter((a) => ['ver', 'cadastrar', 'editar', 'exportar'].includes(a)),
        ]),
      ),
  },
  gestor: {
    label: 'Gestor (tudo, exceto administração)',
    build: () =>
      Object.fromEntries(
        MODULES.filter((m) => !['usuarios', 'configuracoes'].includes(m.key)).map((m) => [m.key, [...m.actions]]),
      ),
  },
};

export const VEHICLE_TYPES = [
  { key: 'cavalo', label: 'Cavalo mecânico' },
  { key: 'caminhao', label: 'Caminhão' },
  { key: 'carreta', label: 'Carreta' },
  { key: 'implemento', label: 'Implemento' },
  { key: 'utilitario', label: 'Utilitário' },
  { key: 'outros', label: 'Outros' },
];
// Tipos rebocados (não têm motor/hodômetro próprio) — aparecem em Frota > Implementos
export const TOWED_TYPES = ['carreta', 'implemento'];
// Tipos que podem engatar carretas/implementos
export const TRACTOR_TYPES = ['cavalo', 'caminhao'];

export const FUEL_TYPES = [
  { key: 'diesel_s10', label: 'Diesel S10' },
  { key: 'diesel_s500', label: 'Diesel S500' },
  { key: 'gasolina', label: 'Gasolina' },
  { key: 'etanol', label: 'Etanol' },
  { key: 'flex', label: 'Flex' },
  { key: 'gnv', label: 'GNV' },
  { key: 'eletrico', label: 'Elétrico' },
  { key: 'nenhum', label: 'Não se aplica' },
];

export const VEHICLE_STATUS = [
  { key: 'disponivel', label: 'Disponível', tone: 'ok' },
  { key: 'em_viagem', label: 'Em viagem', tone: 'info' },
  { key: 'em_manutencao', label: 'Em manutenção', tone: 'warn' },
  { key: 'parado', label: 'Parado', tone: 'muted' },
  { key: 'inativo', label: 'Inativo', tone: 'off' },
];

export const DRIVER_STATUS = [
  { key: 'ativo', label: 'Ativo', tone: 'ok' },
  { key: 'ferias', label: 'Férias', tone: 'info' },
  { key: 'afastado', label: 'Afastado', tone: 'warn' },
  { key: 'inativo', label: 'Inativo', tone: 'off' },
];

export const CNH_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];

export const OCCURRENCE_TYPES = [
  { key: 'advertencia', label: 'Advertência' },
  { key: 'multa', label: 'Multa' },
  { key: 'acidente', label: 'Acidente / sinistro' },
  { key: 'avaria', label: 'Avaria' },
  { key: 'elogio', label: 'Elogio' },
  { key: 'outros', label: 'Outros' },
];

export const DEFAULT_SETTINGS = {
  alertas: {
    cnh_dias: 30,
    documento_dias: 15,
    manutencao_dias: 7,
    manutencao_km: 1000,
    oleo_km: 1000,
    km_salto_maximo: 5000,
  },
  empresa: {
    nome: 'Rododimi Transportes e Logística',
    cnpj: '',
  },
};

// Limites de upload (validados no servidor)
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function labelOf(list, key) {
  return list.find((i) => i.key === key)?.label ?? key ?? '';
}

// ----- Fase 2: abastecimentos -----
// Combustíveis aceitos num abastecimento. ARLA 32 entra no custo, mas não na média km/L.
export const FUELING_TYPES = [
  { key: 'diesel_s10', label: 'Diesel S10' },
  { key: 'diesel_s500', label: 'Diesel S500' },
  { key: 'gasolina', label: 'Gasolina' },
  { key: 'etanol', label: 'Etanol' },
  { key: 'gnv', label: 'GNV' },
  { key: 'arla32', label: 'ARLA 32' },
];
export const NON_CONSUMPTION_FUELS = ['arla32'];

export const FUEL_ORDER_STATUS = [
  { key: 'pendente', label: 'Pendente', tone: 'warn' },
  { key: 'utilizada', label: 'Utilizada', tone: 'ok' },
  { key: 'cancelada', label: 'Cancelada', tone: 'off' },
];

export const FUELING_STATUS = [
  { key: 'ativo', label: 'Válido', tone: 'ok' },
  { key: 'cancelado', label: 'Cancelado', tone: 'off' },
];

export const UF = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Consumo com desvio maior que este percentual da média do veículo é sinalizado
export const CONSUMPTION_DEVIATION = 0.2;
