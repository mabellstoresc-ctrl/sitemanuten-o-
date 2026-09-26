// Relatórios (tela 851): cada relatório devolve colunas + linhas; a tela mostra, imprime (PDF) e exporta (Excel).
import { badRequest, notFound } from '../http.js';
import { can, requirePerm } from '../permissions.js';
import { audit } from '../audit.js';
import { csvResponse } from '../csv.js';
import { costEntries, costSummary, kmInPeriod } from '../costs.js';
import { maintenancePlans, alertSettings } from '../maintenance.js';
import { listTires } from './tires.js';
import { DOC_SELECT, docState } from './documents.js';
import {
  VEHICLE_TYPES,
  VEHICLE_STATUS,
  FUELING_TYPES,
  MAINTENANCE_TYPES,
  MAINTENANCE_CATEGORIES,
  SERVICE_ORDER_STATUS,
  TIRE_STATUS,
  DOCUMENT_TYPES,
  DOCUMENT_OWNERS,
  CHECKLIST_RESULTS,
  COST_SOURCES,
  DRIVER_STATUS,
  TOWED_TYPES,
  labelOf,
} from '../../shared/constants.js';
import { AVG_SQL } from '../fuel.js';

const TZ = `'America/Sao_Paulo'`;
const cats = (l) => (l || []).map((c) => labelOf(MAINTENANCE_CATEGORIES, c)).join(', ');
const round2 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

/** Monta condições com parâmetros numerados. */
function builder() {
  const where = [];
  const params = [];
  return {
    where,
    params,
    p(v) {
      params.push(v);
      return `$${params.length}`;
    },
    sql() {
      return where.length ? `where ${where.join(' and ')}` : '';
    },
  };
}

const col = (key, label, type = 'text') => ({ key, label, type });

// filters: quais filtros a tela mostra. total: colunas somadas no rodapé.
const REPORTS = [
  {
    key: 'frota',
    group: 'Frota',
    title: 'Cadastro da frota',
    description: 'Todos os veículos e implementos com dados do CRLV, KM atual, motorista e engate.',
    module: 'veiculos',
    filters: ['status'],
    async run(db, q) {
      const b = builder();
      if (q.status) b.where.push(`v.status = ${b.p(q.status)}`);
      else b.where.push(`v.status <> 'inativo'`);
      const { rows } = await db.query(
        `select v.*, d.full_name as driver_name,
                (select string_agg(t.plate, ', ') from vehicle_couplings vc join vehicles t on t.id = vc.trailer_id where vc.tractor_id = v.id and vc.end_at is null) as trailers,
                (select t.plate from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id where vc.trailer_id = v.id and vc.end_at is null) as tractor
           from vehicles v
           left join driver_assignments da on da.vehicle_id = v.id and da.end_at is null
           left join drivers d on d.id = da.driver_id
           ${b.sql()} order by (v.type = any(${b.p(TOWED_TYPES)})), v.fleet_number nulls last, v.plate`,
        b.params,
      );
      return {
        columns: [
          col('plate', 'Placa'),
          col('fleet_number', 'Frota'),
          col('type', 'Tipo'),
          col('model', 'Marca/modelo'),
          col('year', 'Ano'),
          col('axle_config', 'Eixos'),
          col('chassis', 'Chassi'),
          col('renavam', 'RENAVAM'),
          col('pbt', 'PBT (t)', 'num2'),
          col('cmt', 'CMT (t)', 'num2'),
          col('current_km', 'KM atual', 'km'),
          col('driver_name', 'Motorista'),
          col('coupling', 'Engate'),
          col('status', 'Status'),
        ],
        rows: rows.map((v) => ({
          ...v,
          type: labelOf(VEHICLE_TYPES, v.type),
          model: [v.brand, v.model].filter(Boolean).join(' '),
          year: v.year_manufacture ? `${v.year_manufacture}/${v.year_model || ''}` : null,
          current_km: TOWED_TYPES.includes(v.type) ? null : v.current_km,
          coupling: v.trailers || v.tractor,
          status: labelOf(VEHICLE_STATUS, v.status),
        })),
      };
    },
  },
  {
    key: 'km_rodado',
    group: 'Frota',
    title: 'Quilometragem rodada',
    description: 'KM inicial, final e rodado por veículo no período (pelas leituras válidas).',
    module: 'veiculos',
    filters: ['period'],
    async run(db, q) {
      const km = await kmInPeriod(db, { from: q.from || null, to: q.to || null });
      const { rows } = await db.query(
        `select v.id, v.plate, v.fleet_number, v.type, v.brand, v.model, v.current_km,
                (select max(km) from km_readings k where k.vehicle_id = v.id and not k.invalidated
                    and ($1::date is null or k.reading_at < ($1::date + 1)::timestamp at time zone ${TZ})) as end_km
           from vehicles v where not (v.type = any($2)) and v.status <> 'inativo' order by v.fleet_number nulls last, v.plate`,
        [q.to || null, TOWED_TYPES],
      );
      return {
        columns: [col('plate', 'Placa'), col('fleet_number', 'Frota'), col('model', 'Modelo'), col('start_km', 'KM inicial', 'km'), col('end_km', 'KM final', 'km'), col('km', 'KM rodado', 'km')],
        rows: rows.map((v) => ({
          ...v,
          model: [v.brand, v.model].filter(Boolean).join(' '),
          km: km[v.id] ?? 0,
          start_km: km[v.id] !== undefined && v.end_km !== null ? v.end_km - km[v.id] : v.end_km,
        })),
        total: ['km'],
      };
    },
  },
  {
    key: 'abastecimentos',
    group: 'Abastecimento',
    title: 'Abastecimentos',
    description: 'Lista de abastecimentos com litros, valores e média.',
    module: 'abastecimentos',
    filters: ['period', 'vehicle', 'driver'],
    async run(db, q) {
      const b = builder();
      b.where.push(`f.status = 'ativo'`);
      if (q.from) b.where.push(`f.fueled_at >= (${b.p(q.from)}::date)::timestamp at time zone ${TZ}`);
      if (q.to) b.where.push(`f.fueled_at < (${b.p(q.to)}::date + 1)::timestamp at time zone ${TZ}`);
      if (q.vehicle_id) b.where.push(`f.vehicle_id = ${b.p(q.vehicle_id)}`);
      if (q.driver_id) b.where.push(`f.driver_id = ${b.p(q.driver_id)}`);
      const { rows } = await db.query(
        `select f.*, v.plate, d.full_name as driver_name from fuelings f join vehicles v on v.id = f.vehicle_id left join drivers d on d.id = f.driver_id
          ${b.sql()} order by f.fueled_at desc limit 20000`,
        b.params,
      );
      return {
        columns: [
          col('fueled_at', 'Data/hora', 'datetime'),
          col('plate', 'Placa'),
          col('driver_name', 'Motorista'),
          col('km', 'KM', 'km'),
          col('fuel', 'Combustível'),
          col('liters', 'Litros', 'num2'),
          col('price_per_liter', 'R$/L', 'num3'),
          col('total', 'Total', 'money'),
          col('km_per_liter', 'km/L', 'num2'),
          col('station', 'Posto'),
          col('city', 'Cidade'),
        ],
        rows: rows.map((f) => ({ ...f, fuel: labelOf(FUELING_TYPES, f.fuel_type), city: [f.city, f.state].filter(Boolean).join('/') })),
        total: ['liters', 'total'],
      };
    },
  },
  {
    key: 'consumo',
    group: 'Abastecimento',
    title: 'Consumo médio por veículo',
    description: 'Litros, gasto, KM rodado, média km/L e custo de combustível por KM.',
    module: 'abastecimentos',
    filters: ['period'],
    async run(db, q) {
      const b = builder();
      b.where.push(`status = 'ativo'`);
      if (q.from) b.where.push(`fueled_at >= (${b.p(q.from)}::date)::timestamp at time zone ${TZ}`);
      if (q.to) b.where.push(`fueled_at < (${b.p(q.to)}::date + 1)::timestamp at time zone ${TZ}`);
      const { rows } = await db.query(
        `select a.*, v.plate, v.fleet_number, v.brand, v.model from (select vehicle_id, ${AVG_SQL} from fuelings ${b.sql()} group by vehicle_id) a
           join vehicles v on v.id = a.vehicle_id order by a.km_per_liter desc nulls last`,
        b.params,
      );
      return {
        columns: [
          col('plate', 'Placa'),
          col('model', 'Modelo'),
          col('fuelings', 'Abastec.', 'int'),
          col('liters', 'Litros', 'num2'),
          col('total', 'Gasto', 'money'),
          col('distance', 'KM (médias)', 'km'),
          col('km_per_liter', 'km/L', 'num2'),
          col('cost_per_km', 'R$/km', 'num3'),
        ],
        rows: rows.map((r) => ({ ...r, model: [r.brand, r.model].filter(Boolean).join(' ') })),
        total: ['fuelings', 'liters', 'total', 'distance'],
      };
    },
  },
  {
    key: 'manutencoes',
    group: 'Manutenção',
    title: 'Manutenções realizadas',
    description: 'Preventivas e corretivas com peças, mão de obra e total.',
    module: 'manutencoes',
    filters: ['period', 'vehicle', 'maint_type'],
    async run(db, q) {
      const b = builder();
      b.where.push(`m.status = 'ativo'`);
      if (q.from) b.where.push(`m.performed_on >= ${b.p(q.from)}::date`);
      if (q.to) b.where.push(`m.performed_on <= ${b.p(q.to)}::date`);
      if (q.vehicle_id) b.where.push(`m.vehicle_id = ${b.p(q.vehicle_id)}`);
      if (q.type) b.where.push(`m.type = ${b.p(q.type)}`);
      const { rows } = await db.query(
        `select m.*, v.plate from maintenances m join vehicles v on v.id = m.vehicle_id ${b.sql()} order by m.performed_on desc limit 20000`,
        b.params,
      );
      return {
        columns: [
          col('performed_on', 'Data', 'date'),
          col('plate', 'Placa'),
          col('type', 'Tipo'),
          col('categories', 'Serviços'),
          col('km', 'KM', 'km'),
          col('workshop', 'Oficina'),
          col('parts_cost', 'Peças', 'money'),
          col('labor_cost', 'Mão de obra', 'money'),
          col('total', 'Total', 'money'),
          col('invoice_number', 'NF'),
        ],
        rows: rows.map((m) => ({ ...m, type: labelOf(MAINTENANCE_TYPES, m.type), categories: cats(m.categories) })),
        total: ['parts_cost', 'labor_cost', 'total'],
      };
    },
  },
  {
    key: 'ordens_servico',
    group: 'Manutenção',
    title: 'Ordens de serviço',
    description: 'OS abertas no período, situação, prazo e custo.',
    module: 'manutencoes',
    filters: ['period', 'vehicle', 'so_status'],
    async run(db, q) {
      const b = builder();
      if (q.from) b.where.push(`so.opened_on >= ${b.p(q.from)}::date`);
      if (q.to) b.where.push(`so.opened_on <= ${b.p(q.to)}::date`);
      if (q.vehicle_id) b.where.push(`so.vehicle_id = ${b.p(q.vehicle_id)}`);
      if (q.status === 'abertas') b.where.push(`so.status in ('aberta','em_analise','aguardando_peca','em_manutencao')`);
      else if (q.status) b.where.push(`so.status = ${b.p(q.status)}`);
      const { rows } = await db.query(
        `select so.*, v.plate, m.total as maintenance_total,
                (select coalesce(sum(total), 0) from maintenance_parts p where p.service_order_id = so.id)::float as parts_total
           from service_orders so join vehicles v on v.id = so.vehicle_id left join maintenances m on m.id = so.maintenance_id
           ${b.sql()} order by so.number desc limit 20000`,
        b.params,
      );
      return {
        columns: [
          col('number', 'OS', 'int'),
          col('opened_on', 'Abertura', 'date'),
          col('plate', 'Placa'),
          col('type', 'Tipo'),
          col('reported_problem', 'Problema'),
          col('workshop', 'Oficina'),
          col('due_date', 'Previsão', 'date'),
          col('completed_on', 'Conclusão', 'date'),
          col('status', 'Situação'),
          col('cost', 'Custo', 'money'),
        ],
        rows: rows.map((o) => ({
          ...o,
          type: labelOf(MAINTENANCE_TYPES, o.type),
          status: labelOf(SERVICE_ORDER_STATUS, o.status),
          cost: o.maintenance_total ?? o.parts_total,
        })),
        total: ['cost'],
      };
    },
  },
  {
    key: 'proximas_manutencoes',
    group: 'Manutenção',
    title: 'Próximas manutenções',
    description: 'Planos de manutenção e troca de óleo por veículo, com KM e data previstos.',
    module: 'manutencoes',
    filters: ['vehicle'],
    async run(db, q) {
      const plans = await maintenancePlans(db, { vehicleId: q.vehicle_id || null });
      const states = { vencida: 'Vencida', proxima: 'Próxima', ok: 'Em dia' };
      return {
        columns: [
          col('plate', 'Placa'),
          col('items', 'Serviços'),
          col('performed_on', 'Última', 'date'),
          col('next_km', 'Próx. KM', 'km'),
          col('km_left', 'Faltam (km)', 'int'),
          col('next_date', 'Próx. data', 'date'),
          col('days_left', 'Faltam (dias)', 'int'),
          col('estimated_date', 'Previsão', 'date'),
          col('state', 'Situação'),
        ],
        rows: plans.map((p) => ({ ...p, id: `${p.maintenance_id}-${p.vehicle_id}`, items: cats(p.categories), state: states[p.state] })),
      };
    },
  },
  {
    key: 'pneus',
    group: 'Pneus',
    title: 'Pneus',
    description: 'Situação, posição, KM rodado, vida útil, sulco e recapagens de cada pneu.',
    module: 'pneus',
    filters: ['tire_status', 'vehicle'],
    async run(db, q) {
      const b = builder();
      if (q.status) b.where.push(`t.status = ${b.p(q.status)}`);
      else b.where.push(`t.status <> 'descartado'`);
      if (q.vehicle_id) b.where.push(`t.vehicle_id = ${b.p(q.vehicle_id)}`);
      const tires = await listTires(db, b.sql(), b.params);
      return {
        columns: [
          col('code', 'Código'),
          col('fire_number', 'Fogo'),
          col('brand', 'Marca/modelo'),
          col('size', 'Medida'),
          col('status', 'Situação'),
          col('plate', 'Veículo'),
          col('position_label', 'Posição'),
          col('total_km', 'KM rodado', 'km'),
          col('life_pct', '% vida', 'num1'),
          col('tread_depth_mm', 'Sulco (mm)', 'num1'),
          col('retread_count', 'Recap.', 'int'),
          col('purchase_value', 'Compra', 'money'),
        ],
        rows: tires.map((t) => ({ ...t, brand: [t.brand, t.model].filter(Boolean).join(' '), status: labelOf(TIRE_STATUS, t.status) })),
        total: ['purchase_value'],
      };
    },
  },
  {
    key: 'recapagens',
    group: 'Pneus',
    title: 'Recapagens',
    description: 'Envios para recapagem, retorno, empresa e custo.',
    module: 'pneus',
    filters: ['period'],
    async run(db, q) {
      const b = builder();
      if (q.from) b.where.push(`r.sent_on >= ${b.p(q.from)}::date`);
      if (q.to) b.where.push(`r.sent_on <= ${b.p(q.to)}::date`);
      const { rows } = await db.query(
        `select r.*, t.code, t.fire_number, t.brand, t.size from tire_retreads r join tires t on t.id = r.tire_id ${b.sql()} order by r.sent_on desc`,
        b.params,
      );
      const st = { enviado: 'Na recapadora', retornado: 'Retornou', reprovado: 'Reprovado' };
      return {
        columns: [
          col('sent_on', 'Envio', 'date'),
          col('code', 'Pneu'),
          col('fire_number', 'Fogo'),
          col('company', 'Empresa'),
          col('retread_type', 'Tipo'),
          col('returned_on', 'Retorno', 'date'),
          col('status', 'Situação'),
          col('cost', 'Custo', 'money'),
        ],
        rows: rows.map((r) => ({ ...r, status: st[r.status] || r.status })),
        total: ['cost'],
      };
    },
  },
  {
    key: 'custos_veiculo',
    group: 'Custos',
    title: 'Custo por veículo',
    description: 'Total por veículo separado por origem (combustível, manutenção, pneus…), KM rodado e custo por KM.',
    module: 'custos',
    filters: ['period'],
    async run(db, q) {
      const s = await costSummary(db, { from: q.from, to: q.to });
      const sources = COST_SOURCES.map((x) => x.key);
      return {
        columns: [
          col('plate', 'Placa'),
          ...COST_SOURCES.map((x) => col(x.key, x.label, 'money')),
          col('total', 'Total', 'money'),
          col('km', 'KM rodado', 'km'),
          col('cost_per_km', 'R$/km', 'num3'),
        ],
        rows: s.by_vehicle.map((v) => ({
          id: v.vehicle_id || 'geral',
          plate: v.plate || 'Geral (sem veículo)',
          ...Object.fromEntries(sources.map((k) => [k, round2(v.by_source[k] || 0)])),
          total: v.total,
          km: v.km,
          cost_per_km: v.cost_per_km,
        })),
        total: [...sources, 'total', 'km'],
      };
    },
  },
  {
    key: 'custos_lancamentos',
    group: 'Custos',
    title: 'Lançamentos de custo',
    description: 'Todas as despesas do período, de todos os módulos, linha a linha.',
    module: 'custos',
    filters: ['period', 'vehicle', 'cost_source'],
    async run(db, q) {
      const entries = await costEntries(db, { from: q.from, to: q.to, vehicle_id: q.vehicle_id, source: q.source }, 50000);
      return {
        columns: [col('date', 'Data', 'date'), col('plate', 'Placa'), col('source', 'Origem'), col('category_label', 'Categoria'), col('description', 'Descrição'), col('amount', 'Valor', 'money')],
        rows: entries.map((e, i) => ({ ...e, id: `${e.ref_id}-${e.source}-${i}`, plate: e.plate || 'Geral', source: labelOf(COST_SOURCES, e.source) })),
        total: ['amount'],
      };
    },
  },
  {
    key: 'documentos',
    group: 'Controle',
    title: 'Documentos e vencimentos',
    description: 'CRLV, AET, seguros, exames e demais documentos com situação da validade.',
    module: 'documentos',
    filters: ['doc_state', 'doc_type'],
    async run(db, q) {
      const a = await alertSettings(db);
      const b = builder();
      const state = q.state || 'vigentes';
      if (state === 'vencidos') b.where.push(`d.status = 'ativo' and d.expires_on < (now() at time zone ${TZ})::date`);
      else if (state === 'atencao') b.where.push(`d.status = 'ativo' and d.expires_on <= (now() at time zone ${TZ})::date + ${b.p(a.documento_dias)}::int`);
      else if (state !== 'todos') b.where.push(`d.status = 'ativo'`);
      if (q.type) b.where.push(`d.type = ${b.p(q.type)}`);
      const { rows } = await db.query(`${DOC_SELECT} ${b.sql()} order by d.expires_on nulls last, v.plate`, b.params);
      const states = { vencido: 'VENCIDO', vencendo: 'Vencendo', vigente: 'Vigente', sem_validade: 'Sem vencimento', substituido: 'Substituído', cancelado: 'Cancelado' };
      return {
        columns: [
          col('type', 'Documento'),
          col('who', 'Veículo / motorista'),
          col('number', 'Número'),
          col('issuer', 'Órgão'),
          col('exercise_year', 'Exercício'),
          col('expires_on', 'Vencimento', 'date'),
          col('days_left', 'Dias', 'int'),
          col('authorized', 'Implementos autorizados'),
          col('state', 'Situação'),
        ],
        rows: rows.map((d) => ({
          ...d,
          type: labelOf(DOCUMENT_TYPES, d.type),
          who: d.plate || d.driver_name || labelOf(DOCUMENT_OWNERS, d.owner),
          authorized: (d.authorized || []).map((x) => x.plate).join(', '),
          state: states[docState(d, a.documento_dias)],
        })),
      };
    },
  },
  {
    key: 'checklists',
    group: 'Controle',
    title: 'Checklists realizados',
    description: 'Checklists do período, resultado e itens com problema.',
    module: 'checklists',
    filters: ['period', 'vehicle'],
    async run(db, q) {
      const b = builder();
      b.where.push(`c.status = 'ativo'`);
      if (q.from) b.where.push(`c.performed_at >= (${b.p(q.from)}::date)::timestamp at time zone ${TZ}`);
      if (q.to) b.where.push(`c.performed_at < (${b.p(q.to)}::date + 1)::timestamp at time zone ${TZ}`);
      if (q.vehicle_id) b.where.push(`c.vehicle_id = ${b.p(q.vehicle_id)}`);
      const { rows } = await db.query(
        `select c.*, v.plate, d.full_name as driver_name, so.number as os_number,
                (select string_agg(a.label, '; ' order by a.position) from checklist_answers a where a.checklist_id = c.id and a.answer = 'nok') as problems
           from checklists c join vehicles v on v.id = c.vehicle_id left join drivers d on d.id = c.driver_id
           left join service_orders so on so.id = c.service_order_id
           ${b.sql()} order by c.performed_at desc limit 20000`,
        b.params,
      );
      return {
        columns: [
          col('number', 'Nº', 'int'),
          col('performed_at', 'Data/hora', 'datetime'),
          col('plate', 'Placa'),
          col('template_name', 'Modelo'),
          col('driver_name', 'Motorista'),
          col('km', 'KM', 'km'),
          col('result', 'Resultado'),
          col('problems', 'Itens com problema'),
          col('os_number', 'OS', 'int'),
        ],
        rows: rows.map((c) => ({ ...c, result: labelOf(CHECKLIST_RESULTS, c.result) })),
      };
    },
  },
  {
    key: 'motoristas',
    group: 'Controle',
    title: 'Motoristas e CNH',
    description: 'Motoristas, categoria e validade da CNH e veículo atual.',
    module: 'motoristas',
    filters: [],
    async run(db) {
      const { rows } = await db.query(
        `select d.*, v.plate, (d.cnh_expiry - (now() at time zone ${TZ})::date) as days_left
           from drivers d left join driver_assignments a on a.driver_id = d.id and a.end_at is null left join vehicles v on v.id = a.vehicle_id
          where d.status <> 'inativo' order by d.full_name`,
      );
      return {
        columns: [
          col('full_name', 'Motorista'),
          col('cpf', 'CPF'),
          col('cnh_number', 'CNH'),
          col('cnh_category', 'Cat.'),
          col('cnh_expiry', 'Validade CNH', 'date'),
          col('days_left', 'Dias', 'int'),
          col('phone', 'Telefone'),
          col('plate', 'Veículo'),
          col('status', 'Situação'),
        ],
        rows: rows.map((d) => ({ ...d, cpf: d.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'), status: labelOf(DRIVER_STATUS, d.status) })),
      };
    },
  },
];

function csvValue(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'date') return String(v).slice(0, 10).split('-').reverse().join('/');
  if (type === 'datetime') return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  if (['int', 'km', 'num1', 'num2', 'num3', 'money'].includes(type)) return Number(v);
  return v;
}

function visible(user) {
  return REPORTS.filter((r) => can(user, r.module, 'ver'));
}

export default function (r) {
  r.get('/reports', async (ctx) => {
    requirePerm(ctx.user, 'relatorios', 'ver');
    return { reports: visible(ctx.user).map(({ key, group, title, description, filters }) => ({ key, group, title, description, filters })) };
  });

  r.get('/reports/:key', async (ctx) => {
    requirePerm(ctx.user, 'relatorios', 'ver');
    const rep = REPORTS.find((x) => x.key === ctx.params.key);
    if (!rep) throw notFound('Relatório não encontrado.');
    requirePerm(ctx.user, rep.module, 'ver');
    const q = {};
    for (const k of ['from', 'to']) {
      if (ctx.query[k]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.query[k]) || Number.isNaN(Date.parse(ctx.query[k]))) throw badRequest('Data inválida.');
        q[k] = ctx.query[k];
      }
    }
    for (const k of ['vehicle_id', 'driver_id']) {
      if (ctx.query[k]) {
        if (!/^[0-9a-f-]{36}$/i.test(ctx.query[k]) && !(k === 'vehicle_id' && ctx.query[k] === 'geral')) throw badRequest('Filtro inválido.');
        q[k] = ctx.query[k];
      }
    }
    for (const k of ['status', 'type', 'state', 'source']) if (ctx.query[k]) q[k] = String(ctx.query[k]).slice(0, 40);
    if (q.from && q.to && q.from > q.to) throw badRequest('A data inicial é depois da final.');

    const out = await rep.run(ctx.db, q);
    const totals = {};
    for (const k of out.total || []) totals[k] = round2(out.rows.reduce((s, row) => s + (Number(row[k]) || 0), 0));

    if (ctx.query.format === 'csv') {
      requirePerm(ctx.user, 'relatorios', 'exportar');
      await audit(ctx.db, ctx, { module: 'relatorios', action: 'exportar', entity: 'relatorio', entityId: rep.key, label: `${rep.title} (${out.rows.length} linhas)`, reason: [q.from, q.to].filter(Boolean).join(' a ') || null });
      const rows = out.rows.map((row) => out.columns.map((c) => csvValue(row[c.key], c.type)));
      if (out.total?.length) rows.push(out.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in totals ? totals[c.key] : '')));
      return csvResponse(`relatorio-${rep.key}`, out.columns.map((c) => c.label), rows);
    }
    const rows = out.rows.map((row, i) => {
      const o = { id: row.id ?? i };
      for (const c of out.columns) o[c.key] = row[c.key] ?? null;
      return o;
    });
    return { key: rep.key, title: rep.title, columns: out.columns, rows, totals, generated_at: new Date().toISOString() };
  });
}
