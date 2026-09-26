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
    oleo_intervalo_km: 15000,
    pneu_inspecao_dias: 30,
    pneu_sulco_minimo: 3,
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

// ----- Fase 3: manutenção -----
export const MAINTENANCE_TYPES = [
  { key: 'preventiva', label: 'Preventiva', tone: 'info' },
  { key: 'corretiva', label: 'Corretiva', tone: 'warn' },
];

export const MAINTENANCE_CATEGORIES = [
  { key: 'troca_oleo', label: 'Troca de óleo' },
  { key: 'filtro_oleo', label: 'Filtro de óleo' },
  { key: 'filtro_combustivel', label: 'Filtro de combustível' },
  { key: 'filtro_ar', label: 'Filtro de ar' },
  { key: 'freios', label: 'Freios' },
  { key: 'suspensao', label: 'Suspensão' },
  { key: 'motor', label: 'Motor' },
  { key: 'cambio', label: 'Câmbio' },
  { key: 'diferencial', label: 'Diferencial' },
  { key: 'eletrico', label: 'Sistema elétrico' },
  { key: 'ar_condicionado', label: 'Ar-condicionado' },
  { key: 'pneus', label: 'Pneus' },
  { key: 'alinhamento', label: 'Alinhamento' },
  { key: 'balanceamento', label: 'Balanceamento' },
  { key: 'lubrificacao', label: 'Lubrificação' },
  { key: 'revisao', label: 'Revisão' },
  { key: 'outros', label: 'Outros' },
];
export const OIL_CATEGORY = 'troca_oleo';

export const SERVICE_ORDER_STATUS = [
  { key: 'aberta', label: 'Aberta', tone: 'info' },
  { key: 'em_analise', label: 'Em análise', tone: 'info' },
  { key: 'aguardando_peca', label: 'Aguardando peça', tone: 'warn' },
  { key: 'em_manutencao', label: 'Em manutenção', tone: 'warn' },
  { key: 'finalizada', label: 'Finalizada', tone: 'ok' },
  { key: 'cancelada', label: 'Cancelada', tone: 'off' },
];
export const SERVICE_ORDER_OPEN = ['aberta', 'em_analise', 'aguardando_peca', 'em_manutencao'];

export const MAINTENANCE_STATUS = [
  { key: 'ativo', label: 'Válida', tone: 'ok' },
  { key: 'cancelado', label: 'Cancelada', tone: 'off' },
];

// ----- Fase 4: pneus -----
export const TIRE_STATUS = [
  { key: 'novo', label: 'Novo', tone: 'info' },
  { key: 'em_uso', label: 'Em uso', tone: 'ok' },
  { key: 'estoque', label: 'Em estoque', tone: 'muted' },
  { key: 'recapagem', label: 'Recapagem', tone: 'warn' },
  { key: 'retirado', label: 'Retirado', tone: 'off' },
  { key: 'descartado', label: 'Descartado', tone: 'off' },
];
// Pneus que podem ser instalados
export const TIRE_AVAILABLE = ['novo', 'estoque', 'retirado'];

export const TIRE_ACTIONS = [
  { key: 'cadastro', label: 'Cadastro' },
  { key: 'instalar', label: 'Instalado' },
  { key: 'trocar_posicao', label: 'Troca de posição' },
  { key: 'trocar_veiculo', label: 'Troca de veículo' },
  { key: 'estoque', label: 'Enviado para estoque' },
  { key: 'recapagem', label: 'Enviado para recapagem' },
  { key: 'retorno_recapagem', label: 'Retorno da recapagem' },
  { key: 'retirar', label: 'Retirado' },
  { key: 'descartar', label: 'Descartado' },
  { key: 'inspecao', label: 'Inspeção' },
];

/**
 * Configurações de eixos. Cada eixo: nome e se é rodado duplo.
 * Posições geradas: E{n}-E / E{n}-D (simples) ou E{n}-EE, E{n}-EI, E{n}-DI, E{n}-DE (duplo) e ESTEPE-n.
 */
export const AXLE_LAYOUTS = [
  { key: '4x2', label: '4x2 (toco)', axles: [{ name: 'Dianteiro', dual: false }, { name: 'Traseiro (tração)', dual: true }], spares: 1 },
  { key: '6x2', label: '6x2 (truck / cavalo 3 eixos)', axles: [{ name: 'Dianteiro', dual: false }, { name: 'Traseiro 1 (tração)', dual: true }, { name: 'Traseiro 2', dual: true }], spares: 1 },
  { key: '6x4', label: '6x4 (traçado)', axles: [{ name: 'Dianteiro', dual: false }, { name: 'Traseiro 1 (tração)', dual: true }, { name: 'Traseiro 2 (tração)', dual: true }], spares: 1 },
  { key: '8x2', label: '8x2 (bitruck)', axles: [{ name: 'Dianteiro 1', dual: false }, { name: 'Dianteiro 2', dual: false }, { name: 'Traseiro 1 (tração)', dual: true }, { name: 'Traseiro 2', dual: true }], spares: 1 },
  { key: '8x4', label: '8x4', axles: [{ name: 'Dianteiro 1', dual: false }, { name: 'Dianteiro 2', dual: false }, { name: 'Traseiro 1 (tração)', dual: true }, { name: 'Traseiro 2 (tração)', dual: true }], spares: 1 },
  { key: '2 eixos', label: 'Carreta 2 eixos', axles: [{ name: 'Eixo 1', dual: true }, { name: 'Eixo 2', dual: true }], spares: 1 },
  { key: '3 eixos', label: 'Carreta 3 eixos', axles: [{ name: 'Eixo 1', dual: true }, { name: 'Eixo 2', dual: true }, { name: 'Eixo 3', dual: true }], spares: 2 },
  { key: '4 eixos', label: 'Carreta 4 eixos', axles: [{ name: 'Eixo 1', dual: true }, { name: 'Eixo 2', dual: true }, { name: 'Eixo 3', dual: true }, { name: 'Eixo 4', dual: true }], spares: 2 },
  { key: 'simples', label: 'Utilitário (4 rodas)', axles: [{ name: 'Dianteiro', dual: false }, { name: 'Traseiro', dual: false }], spares: 1 },
];

const DEFAULT_LAYOUT_BY_TYPE = { cavalo: '6x2', caminhao: '6x2', carreta: '3 eixos', implemento: '2 eixos', utilitario: 'simples', outros: '4x2' };

export function layoutFor(vehicle) {
  const cfg = String(vehicle?.axle_config || '').trim().toLowerCase();
  return AXLE_LAYOUTS.find((l) => l.key === cfg) || AXLE_LAYOUTS.find((l) => l.key === DEFAULT_LAYOUT_BY_TYPE[vehicle?.type]) || AXLE_LAYOUTS[1];
}

/** Lista de posições [{ code, label, axle, side, spare }] da configuração do veículo. */
export function positionsFor(vehicle) {
  const layout = layoutFor(vehicle);
  const out = [];
  layout.axles.forEach((a, i) => {
    const n = i + 1;
    const sides = a.dual
      ? [
          ['EE', 'externo esquerdo'],
          ['EI', 'interno esquerdo'],
          ['DI', 'interno direito'],
          ['DE', 'externo direito'],
        ]
      : [
          ['E', 'esquerdo'],
          ['D', 'direito'],
        ];
    for (const [s, l] of sides) out.push({ code: `E${n}-${s}`, label: `${a.name} — ${l}`, axle: n, side: s, spare: false });
  });
  for (let i = 1; i <= layout.spares; i++) out.push({ code: `ESTEPE-${i}`, label: `Estepe ${i}`, axle: null, side: null, spare: true });
  return out;
}

export function positionLabel(vehicle, code) {
  return positionsFor(vehicle).find((p) => p.code === code)?.label || code || '';
}

// ----- Fase 5: documentos, checklists, custos, relatórios -----
export const DOCUMENT_OWNERS = [
  { key: 'veiculo', label: 'Veículo' },
  { key: 'motorista', label: 'Motorista' },
  { key: 'empresa', label: 'Empresa' },
];

// owners: a quem o tipo de documento se aplica
export const DOCUMENT_TYPES = [
  { key: 'crlv', label: 'CRLV (licenciamento)', owners: ['veiculo'] },
  { key: 'aet', label: 'AET (autorização especial de trânsito)', owners: ['veiculo'] },
  { key: 'tacografo', label: 'Aferição do tacógrafo', owners: ['veiculo'] },
  { key: 'seguro', label: 'Apólice de seguro', owners: ['veiculo', 'empresa'] },
  { key: 'civ_cipp', label: 'CIV / CIPP', owners: ['veiculo'] },
  { key: 'antt', label: 'RNTRC / ANTT', owners: ['empresa', 'veiculo'] },
  { key: 'licenca', label: 'Licença (ambiental, sanitária…)', owners: ['empresa', 'veiculo'] },
  { key: 'alvara', label: 'Alvará', owners: ['empresa'] },
  { key: 'contrato', label: 'Contrato', owners: ['empresa', 'veiculo'] },
  { key: 'aso', label: 'ASO (exame médico)', owners: ['motorista'] },
  { key: 'toxicologico', label: 'Exame toxicológico', owners: ['motorista'] },
  { key: 'curso', label: 'Curso / certificado (MOPP…)', owners: ['motorista'] },
  { key: 'outros', label: 'Outros', owners: ['veiculo', 'motorista', 'empresa'] },
];

export const DOCUMENT_STATUS = [
  { key: 'ativo', label: 'Vigente', tone: 'ok' },
  { key: 'substituido', label: 'Substituído', tone: 'muted' },
  { key: 'cancelado', label: 'Cancelado', tone: 'off' },
];

export const CHECKLIST_KINDS = [
  { key: 'saida', label: 'Saída' },
  { key: 'retorno', label: 'Retorno' },
  { key: 'periodico', label: 'Periódico / inspeção' },
  { key: 'outros', label: 'Outros' },
];

export const CHECKLIST_ANSWERS = [
  { key: 'ok', label: 'OK', tone: 'ok' },
  { key: 'nok', label: 'Com problema', tone: 'danger' },
  { key: 'na', label: 'N/A', tone: 'muted' },
];

export const CHECKLIST_RESULTS = [
  { key: 'ok', label: 'Aprovado', tone: 'ok' },
  { key: 'problemas', label: 'Com problemas', tone: 'warn' },
  { key: 'reprovado', label: 'Reprovado', tone: 'danger' },
];

// Lançamentos manuais de custo (os demais vêm dos módulos automaticamente)
export const COST_CATEGORIES = [
  { key: 'ipva', label: 'IPVA' },
  { key: 'licenciamento', label: 'Licenciamento / taxas' },
  { key: 'seguro', label: 'Seguro' },
  { key: 'multa', label: 'Multa' },
  { key: 'pedagio', label: 'Pedágio' },
  { key: 'aet', label: 'AET' },
  { key: 'rastreamento', label: 'Rastreamento' },
  { key: 'lavagem', label: 'Lavagem' },
  { key: 'financiamento', label: 'Financiamento / parcela' },
  { key: 'outros', label: 'Outros' },
];

// Origem de cada linha no consolidado de custos
export const COST_SOURCES = [
  { key: 'combustivel', label: 'Combustível' },
  { key: 'arla', label: 'ARLA 32' },
  { key: 'manutencao', label: 'Manutenção' },
  { key: 'pneus', label: 'Pneus (compra)' },
  { key: 'recapagem', label: 'Recapagem' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'avulso', label: 'Lançamentos avulsos' },
];
