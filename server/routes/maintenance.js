import { validate } from '../validate.js';
import { badRequest, notFound } from '../http.js';
import { requirePerm, requireAny } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { registerKm, invalidateReading, syncCurrentKm } from '../km.js';
import { maintenancePlans, oilStatus } from '../maintenance.js';
import { csvResponse } from '../csv.js';
import {
  MAINTENANCE_TYPES,
  MAINTENANCE_CATEGORIES,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_OPEN,
  OIL_CATEGORY,
  VEHICLE_STATUS,
  labelOf,
} from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);
const CAT_KEYS = keys(MAINTENANCE_CATEGORIES);
const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = (v) => Number(v).toLocaleString('pt-BR');
const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const catLabels = (cats) => cats.map((c) => labelOf(MAINTENANCE_CATEGORIES, c)).join(', ');
const noon = (date) => `${date}T15:00:00.000Z`; // 12:00 em Brasília

const MAINT_FIELDS = {
  vehicle_id: { type: 'uuid', required: true, label: 'Veículo' },
  type: { type: 'enum', values: keys(MAINTENANCE_TYPES), required: true, label: 'Tipo' },
  performed_on: { type: 'date', required: true, label: 'Data' },
  km: { type: 'int', min: 0, max: 9_999_999, label: 'Quilometragem' },
  workshop: { type: 'string', max: 120, label: 'Oficina' },
  responsible: { type: 'string', max: 120, label: 'Responsável' },
  description: { type: 'text', max: 4000, label: 'Descrição' },
  parts_cost: { type: 'number', min: 0, max: 5_000_000, label: 'Valor das peças' },
  labor_cost: { type: 'number', min: 0, max: 5_000_000, label: 'Valor da mão de obra' },
  invoice_number: { type: 'string', max: 60, label: 'Nota fiscal' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
  next_date: { type: 'date', label: 'Próxima manutenção (data)' },
  next_km: { type: 'int', min: 0, max: 9_999_999, label: 'Próxima manutenção (KM)' },
  oil_brand: { type: 'string', max: 60, label: 'Marca do óleo' },
  oil_type: { type: 'string', max: 60, label: 'Tipo do óleo' },
  oil_spec: { type: 'string', max: 60, label: 'Especificação' },
  oil_quantity: { type: 'number', min: 0, max: 1000, label: 'Quantidade de óleo (L)' },
  oil_filter: { type: 'bool', label: 'Filtro de óleo trocado' },
  fuel_filter: { type: 'bool', label: 'Filtro de combustível trocado' },
  air_filter: { type: 'bool', label: 'Filtro de ar trocado' },
};
const MAINT_COLS = [...Object.keys(MAINT_FIELDS), 'categories', 'total'];

const FLAGS = {
  confirm_jump: { type: 'bool' },
  confirm_lower: { type: 'bool' },
  km_reason: { type: 'string', max: 500 },
};

const PART_FIELDS = {
  description: { type: 'string', required: true, max: 200, label: 'Peça' },
  part_number: { type: 'string', max: 60, label: 'Código' },
  quantity: { type: 'number', min: 0.01, max: 100000, label: 'Quantidade' },
  unit_price: { type: 'number', min: 0, max: 1_000_000, label: 'Valor unitário' },
};

function parseCategories(raw) {
  const list = Array.isArray(raw) ? [...new Set(raw.map(String))] : [];
  const bad = list.filter((c) => !CAT_KEYS.includes(c));
  if (bad.length) throw badRequest('Categoria inválida.');
  if (!list.length) throw badRequest('Selecione pelo menos uma categoria.', { fields: { categories: 'Obrigatório' } });
  return list;
}

function parseParts(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw badRequest('Lista de peças inválida.');
  if (raw.length > 200) throw badRequest('Muitas peças numa única manutenção.');
  return raw.map((p) => {
    const d = validate(p, PART_FIELDS);
    d.quantity = d.quantity ?? 1;
    d.unit_price = d.unit_price ?? 0;
    d.total = Math.round(d.quantity * d.unit_price * 100) / 100;
    return d;
  });
}

function checkNext(d) {
  if (d.next_km !== null && d.next_km !== undefined && d.km !== null && d.km !== undefined && d.next_km <= d.km) {
    throw badRequest('O KM da próxima manutenção deve ser maior que o KM atual da manutenção.', { fields: { next_km: 'Deve ser maior' } });
  }
  if (d.next_date && d.performed_on && d.next_date <= d.performed_on) {
    throw badRequest('A data da próxima manutenção deve ser posterior à data da manutenção.', { fields: { next_date: 'Deve ser posterior' } });
  }
}

async function insertParts(c, ctx, parts, { soId = null, mId = null }) {
  for (const p of parts) {
    await c.query(
      `insert into maintenance_parts (service_order_id, maintenance_id, description, part_number, quantity, unit_price, total, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [soId, mId, p.description, p.part_number, p.quantity, p.unit_price, p.total, ctx.user.id],
    );
  }
}

async function lockVehicle(c, id) {
  const { rows } = await c.query('select id, plate, status, type, current_km from vehicles where id = $1 for update', [id]);
  if (!rows[0]) throw notFound('Veículo não encontrado.');
  return rows[0];
}

function maintDescription(m) {
  const parts = [catLabels(m.categories)];
  if (m.km) parts.push(`KM ${fmtN(m.km)}`);
  if (m.workshop) parts.push(m.workshop);
  if (Number(m.total)) parts.push(money(m.total));
  if (m.next_km || m.next_date) parts.push(`Próxima: ${[m.next_km && `${fmtN(m.next_km)} km`, m.next_date && fmtD(m.next_date)].filter(Boolean).join(' ou ')}`);
  return parts.join(' · ');
}

/** Cria o registro de manutenção (usado no lançamento direto e na finalização da OS). */
async function createMaintenance(c, ctx, d, { parts, flags, soId = null }) {
  const v = await lockVehicle(c, d.vehicle_id);
  if (v.status === 'inativo') throw badRequest('Veículo inativo.');
  if (parts && parts.length) d.parts_cost = Math.round(parts.reduce((s, p) => s + p.total, 0) * 100) / 100;
  d.parts_cost = d.parts_cost ?? 0;
  d.labor_cost = d.labor_cost ?? 0;
  d.total = Math.round((d.parts_cost + d.labor_cost) * 100) / 100;
  checkNext(d);
  const vals = MAINT_COLS.map((k) => d[k] ?? (['oil_filter', 'fuel_filter', 'air_filter'].includes(k) ? false : null));
  const { rows } = await c.query(
    `insert into maintenances (${MAINT_COLS.join(', ')}, service_order_id, created_by)
     values (${MAINT_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${MAINT_COLS.length + 1}, $${MAINT_COLS.length + 2}) returning id`,
    [...vals, soId, ctx.user.id],
  );
  const id = rows[0].id;
  if (parts && parts.length) await insertParts(c, ctx, parts, { mId: id });
  if (d.km !== null && d.km !== undefined) {
    await registerKm(c, ctx, v.id, d.km, {
      source: 'manutencao',
      sourceId: id,
      dateOnly: d.performed_on,
      confirmJump: flags.confirm_jump,
      confirmLower: flags.confirm_lower,
      reason: flags.km_reason,
    });
  }
  const isOil = d.categories.includes(OIL_CATEGORY);
  await vehicleEvent(c, ctx, v.id, {
    type: isOil ? 'troca_oleo' : 'manutencao',
    title: isOil ? 'Troca de óleo' : `Manutenção ${labelOf(MAINTENANCE_TYPES, d.type).toLowerCase()}`,
    description: maintDescription(d),
    at: noon(d.performed_on),
    refTable: 'maintenances',
    refId: id,
  });
  await audit(c, ctx, {
    module: 'manutencoes',
    action: 'criar',
    entity: 'manutencao',
    entityId: id,
    label: `${v.plate} · ${fmtD(d.performed_on)} · ${catLabels(d.categories)}`,
    changes: [...snapshot(d, MAINT_COLS), ...(parts?.length ? [{ campo: 'pecas', anterior: null, novo: parts.map((p) => `${p.quantity}× ${p.description}`).join('; ') }] : [])],
  });
  return { id, vehicle: v };
}

const MAINT_SELECT = `
  select m.*, v.plate, v.fleet_number, v.model, v.current_km, so.number as service_order_number,
         u.username as created_by_name, cu.username as cancelled_by_name
    from maintenances m
    join vehicles v on v.id = m.vehicle_id
    left join service_orders so on so.id = m.service_order_id
    left join users u on u.id = m.created_by
    left join users cu on cu.id = m.cancelled_by`;

const SO_SELECT = `
  select so.*, v.plate, v.fleet_number, v.model, v.current_km, v.status as vehicle_status,
         u.username as created_by_name, cu.username as cancelled_by_name,
         (select coalesce(sum(total), 0) from maintenance_parts p where p.service_order_id = so.id)::float as parts_total,
         (so.due_date < current_date and so.status in ('aberta','em_analise','aguardando_peca','em_manutencao')) as late,
         m.total as maintenance_total
    from service_orders so
    join vehicles v on v.id = so.vehicle_id
    left join users u on u.id = so.created_by
    left join users cu on cu.id = so.cancelled_by
    left join maintenances m on m.id = so.maintenance_id`;

async function getSO(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Ordem de serviço não encontrada.');
  const { rows } = await db.query(`${SO_SELECT} where so.id = $1`, [id]);
  if (!rows[0]) throw notFound('Ordem de serviço não encontrada.');
  return rows[0];
}

async function lockOpenSO(c, id) {
  const { rows } = await c.query('select * from service_orders where id = $1 for update', [id]);
  const so = rows[0];
  if (!so) throw notFound('Ordem de serviço não encontrada.');
  if (!SERVICE_ORDER_OPEN.includes(so.status)) throw badRequest(`A OS nº ${so.number} já está ${labelOf(SERVICE_ORDER_STATUS, so.status).toLowerCase()}.`);
  return so;
}

/** Ao encerrar a OS, o veículo volta ao status anterior se ainda estiver "Em manutenção" por causa dela. */
async function restoreVehicleStatus(c, ctx, so, reason) {
  const { rows } = await c.query('select id, plate, status from vehicles where id = $1 for update', [so.vehicle_id]);
  const v = rows[0];
  if (v.status !== 'em_manutencao') return;
  const { rows: others } = await c.query(
    `select 1 from service_orders where vehicle_id = $1 and id <> $2 and status = any($3) and vehicle_status_before is not null`,
    [v.id, so.id, SERVICE_ORDER_OPEN],
  );
  if (others.length) return; // outra OS ainda segura o veículo em manutenção
  const back = so.vehicle_status_before && so.vehicle_status_before !== 'em_manutencao' ? so.vehicle_status_before : 'disponivel';
  await c.query('update vehicles set status = $2, updated_at = now() where id = $1', [v.id, back]);
  await vehicleEvent(c, ctx, v.id, {
    type: 'status',
    title: `Status: ${labelOf(VEHICLE_STATUS, back)}`,
    description: `Em manutenção → ${labelOf(VEHICLE_STATUS, back)} — ${reason}`,
  });
  await audit(c, ctx, {
    module: 'veiculos',
    action: 'alterar_status',
    entity: 'veiculo',
    entityId: v.id,
    label: v.plate,
    changes: [{ campo: 'status', anterior: 'em_manutencao', novo: back }],
    reason,
  });
}

export default function (r) {
  // ======================= PRÓXIMAS / ÓLEO / CALENDÁRIO =======================
  r.get('/maintenance/plans', async (ctx) => {
    requireAny(ctx.user, [
      ['manutencoes', 'ver'],
      ['veiculos', 'ver'],
    ]);
    let plans = await maintenancePlans(ctx.db, { vehicleId: ctx.query.vehicle_id || null });
    if (ctx.query.state) plans = plans.filter((p) => p.state === ctx.query.state);
    return { plans };
  });

  r.get('/maintenance/oil', async (ctx) => {
    requireAny(ctx.user, [
      ['manutencoes', 'ver'],
      ['veiculos', 'ver'],
    ]);
    return { vehicles: await oilStatus(ctx.db, { vehicleId: ctx.query.vehicle_id || null }) };
  });

  r.get('/maintenance/calendar', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'ver');
    const from = ctx.query.from;
    const to = ctx.query.to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw badRequest('Informe o período.');
    const items = [];
    const plans = await maintenancePlans(ctx.db);
    for (const p of plans) {
      const date = p.due_date;
      // atrasadas sempre aparecem (na data de hoje se não houver data)
      if (p.state === 'vencida' || (date && date >= from && date <= to)) {
        items.push({
          kind: 'plano',
          date: date || null,
          by: p.next_date && date === p.next_date ? 'data' : 'km',
          state: p.state,
          vehicle_id: p.vehicle_id,
          plate: p.plate,
          title: catLabels(p.categories),
          detail: [p.next_km && `em ${fmtN(p.next_km)} km (faltam ${fmtN(p.km_left)} km)`, p.next_date && `até ${fmtD(p.next_date)}`].filter(Boolean).join(' · '),
          maintenance_id: p.maintenance_id,
          is_oil: p.is_oil,
        });
      }
    }
    const { rows: sos } = await ctx.db.query(
      `select so.id, so.number, so.due_date, so.opened_on, so.status, so.reported_problem, v.id as vehicle_id, v.plate
         from service_orders so join vehicles v on v.id = so.vehicle_id
        where so.status = any($1) and (so.due_date between $2 and $3 or so.due_date < current_date)`,
      [SERVICE_ORDER_OPEN, from, to],
    );
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    for (const so of sos) {
      items.push({
        kind: 'os',
        date: so.due_date,
        state: so.due_date < today ? 'vencida' : 'proxima',
        vehicle_id: so.vehicle_id,
        plate: so.plate,
        title: `OS nº ${so.number} — ${labelOf(SERVICE_ORDER_STATUS, so.status)}`,
        detail: so.reported_problem,
        service_order_id: so.id,
      });
    }
    const { rows: done } = await ctx.db.query(
      `select m.id, m.performed_on, m.categories, m.type, m.km, v.id as vehicle_id, v.plate from maintenances m join vehicles v on v.id = m.vehicle_id
        where m.status = 'ativo' and m.performed_on between $1 and $2`,
      [from, to],
    );
    for (const m of done) {
      items.push({
        kind: 'realizada',
        date: m.performed_on,
        state: 'realizada',
        vehicle_id: m.vehicle_id,
        plate: m.plate,
        title: catLabels(m.categories),
        detail: `${labelOf(MAINTENANCE_TYPES, m.type)}${m.km ? ` · KM ${fmtN(m.km)}` : ''}`,
        maintenance_id: m.id,
      });
    }
    items.sort((a, b) => String(a.date || '0000').localeCompare(String(b.date || '0000')));
    return { items };
  });

  r.get('/vehicles/:id/maintenance-summary', async (ctx) => {
    requireAny(ctx.user, [
      ['veiculos', 'ver'],
      ['manutencoes', 'ver'],
    ]);
    const id = ctx.params.id;
    const [oil] = await oilStatus(ctx.db, { vehicleId: id });
    const plans = await maintenancePlans(ctx.db, { vehicleId: id });
    const { rows: so } = await ctx.db.query(
      `select id, number, status, reported_problem, opened_on, due_date from service_orders where vehicle_id = $1 and status = any($2) order by opened_on`,
      [id, SERVICE_ORDER_OPEN],
    );
    const { rows: last } = await ctx.db.query(
      `select id, performed_on, categories, type, km, total from maintenances where vehicle_id = $1 and status = 'ativo'
        order by performed_on desc, created_at desc limit 1`,
      [id],
    );
    const { rows: cost } = await ctx.db.query(
      `select coalesce(sum(total) filter (where performed_on >= date_trunc('month', current_date)), 0)::float as month,
              coalesce(sum(total) filter (where performed_on >= date_trunc('year', current_date)), 0)::float as year,
              coalesce(sum(total), 0)::float as all_time
         from maintenances where vehicle_id = $1 and status = 'ativo'`,
      [id],
    );
    return { oil: oil || null, plans, open_orders: so, last: last[0] || null, cost: cost[0] };
  });

  // ======================= MANUTENÇÕES =======================
  function maintFilters(q) {
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.vehicle_id) where.push(`m.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.type) where.push(`m.type = ${p(q.type)}`);
    if (q.category) where.push(`${p(q.category)} = any(m.categories)`);
    if (q.from) where.push(`m.performed_on >= ${p(q.from)}::date`);
    if (q.to) where.push(`m.performed_on <= ${p(q.to)}::date`);
    if (q.workshop) where.push(`m.workshop ilike ${p(`%${q.workshop}%`)}`);
    if (q.status !== 'todos') where.push(`m.status = ${p(q.status || 'ativo')}`);
    return { where: where.length ? `where ${where.join(' and ')}` : '', params };
  }

  r.get('/maintenances', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'ver');
    const { where, params } = maintFilters(ctx.query);
    const limit = Math.min(Number(ctx.query.limit) || 500, 5000);
    const { rows } = await ctx.db.query(`${MAINT_SELECT} ${where} order by m.performed_on desc, m.created_at desc limit ${limit}`, params);
    const { rows: tot } = await ctx.db.query(
      `select count(*)::int as count, coalesce(sum(parts_cost), 0)::float as parts, coalesce(sum(labor_cost), 0)::float as labor,
              coalesce(sum(total), 0)::float as total
         from maintenances m ${where}`,
      params,
    );
    return { maintenances: rows, totals: tot[0], truncated: rows.length === limit };
  });

  r.get('/maintenances/export', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'exportar');
    const { where, params } = maintFilters(ctx.query);
    const { rows } = await ctx.db.query(`${MAINT_SELECT} ${where} order by m.performed_on desc limit 50000`, params);
    await audit(ctx.db, ctx, { module: 'manutencoes', action: 'exportar', entity: 'manutencao', label: `${rows.length} registros` });
    return csvResponse(
      'manutencoes',
      ['Data', 'Placa', 'Frota', 'Tipo', 'Categorias', 'KM', 'Oficina', 'Responsável', 'Descrição', 'Peças R$', 'Mão de obra R$', 'Total R$', 'NF', 'Próx. KM', 'Próx. data', 'OS', 'Situação'],
      rows.map((m) => [
        fmtD(m.performed_on),
        m.plate,
        m.fleet_number,
        labelOf(MAINTENANCE_TYPES, m.type),
        catLabels(m.categories),
        m.km,
        m.workshop,
        m.responsible,
        m.description,
        m.parts_cost,
        m.labor_cost,
        m.total,
        m.invoice_number,
        m.next_km,
        fmtD(m.next_date),
        m.service_order_number,
        m.status,
      ]),
    );
  });

  r.get('/maintenances/:id', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'ver');
    if (!/^[0-9a-f-]{36}$/i.test(ctx.params.id)) throw notFound('Manutenção não encontrada.');
    const { rows } = await ctx.db.query(`${MAINT_SELECT} where m.id = $1`, [ctx.params.id]);
    if (!rows[0]) throw notFound('Manutenção não encontrada.');
    const { rows: parts } = await ctx.db.query('select * from maintenance_parts where maintenance_id = $1 order by created_at', [ctx.params.id]);
    return { maintenance: { ...rows[0], parts } };
  });

  r.post('/maintenances', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cadastrar');
    const d = validate(ctx.body, MAINT_FIELDS);
    d.categories = parseCategories(ctx.body?.categories);
    const parts = parseParts(ctx.body?.parts) || [];
    const flags = validate(ctx.body, FLAGS);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    if (d.performed_on > today) throw badRequest('A data da manutenção não pode ser no futuro. Para agendar, abra uma OS com previsão.');
    const out = await ctx.tx((c) => createMaintenance(c, ctx, d, { parts, flags }));
    return { id: out.id };
  });

  r.put('/maintenances/:id', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const patch = validate(ctx.body, MAINT_FIELDS, { partial: true });
    const flags = validate(ctx.body, FLAGS);
    const cats = ctx.body?.categories !== undefined ? parseCategories(ctx.body.categories) : undefined;
    const parts = parseParts(ctx.body?.parts);
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from maintenances where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Manutenção não encontrada.');
      if (before.status !== 'ativo') throw badRequest('Manutenção cancelada não pode ser editada.');
      if (patch.vehicle_id && patch.vehicle_id !== before.vehicle_id) throw badRequest('Para trocar o veículo, cancele e lance novamente.');
      const d = { ...before, ...patch };
      for (const k of ['parts_cost', 'labor_cost', 'total', 'oil_quantity']) if (d[k] !== null) d[k] = Number(d[k]);
      if (cats) d.categories = cats;
      if (parts) {
        await c.query('delete from maintenance_parts where maintenance_id = $1', [before.id]);
        await insertParts(c, ctx, parts, { mId: before.id });
        d.parts_cost = parts.length ? Math.round(parts.reduce((s, p) => s + p.total, 0) * 100) / 100 : (patch.parts_cost ?? 0);
      }
      d.total = Math.round((Number(d.parts_cost) + Number(d.labor_cost)) * 100) / 100;
      checkNext(d);
      if (d.km !== before.km || d.performed_on !== before.performed_on) {
        await invalidateReading(c, before.vehicle_id, 'manutencao', before.id);
        if (d.km !== null && d.km !== undefined) {
          await registerKm(c, ctx, before.vehicle_id, d.km, {
            source: 'manutencao',
            sourceId: before.id,
            dateOnly: d.performed_on,
            confirmJump: flags.confirm_jump,
            confirmLower: flags.confirm_lower,
            reason: flags.km_reason,
          });
        }
        await syncCurrentKm(c, ctx, before.vehicle_id, { reason: flags.km_reason || 'Edição de manutenção' });
      }
      const cols = MAINT_COLS.filter((k) => k !== 'vehicle_id');
      await c.query(`update maintenances set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [
        before.id,
        ...cols.map((k) => d[k] ?? null),
      ]);
      await c.query(`update vehicle_events set description = $2, event_at = $3 where ref_table = 'maintenances' and ref_id = $1`, [
        before.id,
        maintDescription(d),
        noon(d.performed_on),
      ]);
      const { rows: vp } = await c.query('select plate from vehicles where id = $1', [before.vehicle_id]);
      const changes = diff(
        { ...before, parts_cost: Number(before.parts_cost), labor_cost: Number(before.labor_cost), total: Number(before.total), oil_quantity: before.oil_quantity === null ? null : Number(before.oil_quantity) },
        d,
        cols,
      );
      if (parts) changes.push({ campo: 'pecas', anterior: null, novo: parts.map((p) => `${p.quantity}× ${p.description}`).join('; ') || '(nenhuma)' });
      await audit(c, ctx, { module: 'manutencoes', action: 'editar', entity: 'manutencao', entityId: before.id, label: `${vp[0].plate} · ${fmtD(before.performed_on)}`, changes });
    });
    return { ok: true };
  });

  r.post('/maintenances/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo do cancelamento.');
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select m.*, v.plate from maintenances m join vehicles v on v.id = m.vehicle_id where m.id = $1 for update of m', [ctx.params.id]);
      const m = rows[0];
      if (!m) throw notFound('Manutenção não encontrada.');
      if (m.status !== 'ativo') throw badRequest('Esta manutenção já está cancelada.');
      if (m.service_order_id) throw badRequest('Esta manutenção veio de uma OS finalizada. Edite a manutenção para corrigir os dados.');
      await c.query(`update maintenances set status = 'cancelado', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [
        m.id,
        ctx.user.id,
        reason,
      ]);
      await invalidateReading(c, m.vehicle_id, 'manutencao', m.id);
      await syncCurrentKm(c, ctx, m.vehicle_id, { reason: `Cancelamento de manutenção: ${reason}` });
      await c.query(
        `update vehicle_events set title = title || ' (cancelada)', description = 'CANCELADA — ' || coalesce(description, '') where ref_table = 'maintenances' and ref_id = $1`,
        [m.id],
      );
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'cancelar',
        entity: 'manutencao',
        entityId: m.id,
        label: `${m.plate} · ${fmtD(m.performed_on)}`,
        changes: [{ campo: 'status', anterior: 'ativo', novo: 'cancelado' }],
        reason,
      });
    });
    return { ok: true };
  });

  // ======================= ORDENS DE SERVIÇO =======================
  const SO_FIELDS = {
    vehicle_id: { type: 'uuid', required: true, label: 'Veículo' },
    type: { type: 'enum', values: keys(MAINTENANCE_TYPES), label: 'Tipo' },
    opened_on: { type: 'date', required: true, label: 'Data de abertura' },
    km: { type: 'int', min: 0, max: 9_999_999, label: 'Quilometragem' },
    reported_problem: { type: 'text', required: true, max: 4000, label: 'Problema relatado' },
    responsible: { type: 'string', max: 120, label: 'Responsável' },
    workshop: { type: 'string', max: 120, label: 'Oficina' },
    services_done: { type: 'text', max: 8000, label: 'Serviços realizados' },
    due_date: { type: 'date', label: 'Previsão de conclusão' },
  };

  r.get('/service-orders', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.status === 'abertas' || !q.status) where.push(`so.status = any(${p(SERVICE_ORDER_OPEN)})`);
    else if (q.status !== 'todas') where.push(`so.status = ${p(q.status)}`);
    if (q.vehicle_id) where.push(`so.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.type) where.push(`so.type = ${p(q.type)}`);
    if (q.from) where.push(`so.opened_on >= ${p(q.from)}::date`);
    if (q.to) where.push(`so.opened_on <= ${p(q.to)}::date`);
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      where.push(
        `(v.plate ilike ${p(`%${q.q.toUpperCase().replace(/[-\s]/g, '')}%`)} or so.reported_problem ilike ${p(`%${q.q}%`)} or so.workshop ilike $${params.length}${digits ? ` or so.number::text = ${p(digits.replace(/^0+(?=\d)/, ''))}` : ''})`,
      );
    }
    const { rows } = await ctx.db.query(`${SO_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by so.number desc limit 1000`, params);
    return { orders: rows };
  });

  r.get('/service-orders/:id', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'ver');
    const so = await getSO(ctx.db, ctx.params.id);
    const { rows: parts } = await ctx.db.query(
      `select p.*, u.username as created_by_name from maintenance_parts p left join users u on u.id = p.created_by
        where p.service_order_id = $1 order by p.created_at`,
      [so.id],
    );
    const { rows: log } = await ctx.db.query(
      `select l.*, u.username from service_order_status_log l left join users u on u.id = l.user_id where l.service_order_id = $1 order by l.created_at`,
      [so.id],
    );
    return { order: { ...so, parts, log } };
  });

  r.post('/service-orders', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cadastrar');
    const d = validate(ctx.body, SO_FIELDS);
    d.type = d.type || 'corretiva';
    const flags = validate(ctx.body, { ...FLAGS, set_vehicle_status: { type: 'bool' } });
    if (d.due_date && d.due_date < d.opened_on) throw badRequest('A previsão de conclusão não pode ser antes da abertura.');
    const out = await ctx.tx(async (c) => {
      const v = await lockVehicle(c, d.vehicle_id);
      if (v.status === 'inativo') throw badRequest('Veículo inativo.');
      const cols = Object.keys(SO_FIELDS);
      const statusBefore = flags.set_vehicle_status && v.status !== 'em_manutencao' ? v.status : null;
      const { rows } = await c.query(
        `insert into service_orders (${cols.join(', ')}, vehicle_status_before, created_by)
         values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 2}) returning id, number`,
        [...cols.map((k) => d[k]), statusBefore, ctx.user.id],
      );
      const so = rows[0];
      await c.query(`insert into service_order_status_log (service_order_id, to_status, note, user_id) values ($1, 'aberta', 'OS aberta', $2)`, [so.id, ctx.user.id]);
      if (d.km !== null && d.km !== undefined) {
        await registerKm(c, ctx, v.id, d.km, {
          source: 'os',
          sourceId: so.id,
          dateOnly: d.opened_on,
          confirmJump: flags.confirm_jump,
          confirmLower: flags.confirm_lower,
          reason: flags.km_reason,
        });
      }
      if (statusBefore) {
        await c.query(`update vehicles set status = 'em_manutencao', updated_at = now() where id = $1`, [v.id]);
        await audit(c, ctx, {
          module: 'veiculos',
          action: 'alterar_status',
          entity: 'veiculo',
          entityId: v.id,
          label: v.plate,
          changes: [{ campo: 'status', anterior: v.status, novo: 'em_manutencao' }],
          reason: `Abertura da OS nº ${so.number}`,
        });
      }
      await vehicleEvent(c, ctx, v.id, {
        type: 'os',
        title: `OS nº ${so.number} aberta (${labelOf(MAINTENANCE_TYPES, d.type).toLowerCase()})`,
        description: `${d.reported_problem}${d.workshop ? ` · ${d.workshop}` : ''}${statusBefore ? ' · veículo em manutenção' : ''}`,
        refTable: 'service_orders',
        refId: so.id,
      });
      await audit(c, ctx, { module: 'manutencoes', action: 'criar', entity: 'ordem_servico', entityId: so.id, label: `OS nº ${so.number} · ${v.plate}`, changes: snapshot(d) });
      return so;
    });
    return out;
  });

  r.put('/service-orders/:id', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const d = validate(ctx.body, SO_FIELDS, { partial: true });
    delete d.vehicle_id;
    delete d.km; // o KM da abertura não é editado aqui (fica no histórico de KM)
    await ctx.tx(async (c) => {
      const before = await lockOpenSO(c, ctx.params.id);
      const fields = Object.keys(d);
      if (!fields.length) return;
      if ((d.due_date ?? before.due_date) && (d.due_date ?? before.due_date) < (d.opened_on ?? before.opened_on)) {
        throw badRequest('A previsão de conclusão não pode ser antes da abertura.');
      }
      await c.query(`update service_orders set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [
        before.id,
        ...fields.map((f) => d[f]),
      ]);
      await audit(c, ctx, { module: 'manutencoes', action: 'editar', entity: 'ordem_servico', entityId: before.id, label: `OS nº ${before.number}`, changes: diff(before, d, fields) });
    });
    return { ok: true };
  });

  r.post('/service-orders/:id/status', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const { status, note } = validate(ctx.body, {
      status: { type: 'enum', values: SERVICE_ORDER_OPEN, required: true, label: 'Status' },
      note: { type: 'string', max: 500, label: 'Observação' },
    });
    await ctx.tx(async (c) => {
      const so = await lockOpenSO(c, ctx.params.id);
      if (so.status === status) return;
      await c.query('update service_orders set status = $2, updated_at = now() where id = $1', [so.id, status]);
      await c.query(`insert into service_order_status_log (service_order_id, from_status, to_status, note, user_id) values ($1, $2, $3, $4, $5)`, [
        so.id,
        so.status,
        status,
        note,
        ctx.user.id,
      ]);
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'alterar_status',
        entity: 'ordem_servico',
        entityId: so.id,
        label: `OS nº ${so.number}`,
        changes: [{ campo: 'status', anterior: so.status, novo: status }],
        reason: note,
      });
    });
    return { ok: true };
  });

  r.post('/service-orders/:id/parts', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const [part] = parseParts([ctx.body || {}]);
    await ctx.tx(async (c) => {
      const so = await lockOpenSO(c, ctx.params.id);
      await insertParts(c, ctx, [part], { soId: so.id });
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'incluir_peca',
        entity: 'ordem_servico',
        entityId: so.id,
        label: `OS nº ${so.number}`,
        changes: [{ campo: 'pecas', anterior: null, novo: `${part.quantity}× ${part.description} (${money(part.total)})` }],
      });
    });
    return { ok: true };
  });

  r.del('/service-orders/:id/parts/:partId', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    await ctx.tx(async (c) => {
      const so = await lockOpenSO(c, ctx.params.id);
      const { rows } = await c.query('delete from maintenance_parts where id = $1 and service_order_id = $2 returning description, quantity, total', [
        ctx.params.partId,
        so.id,
      ]);
      if (!rows[0]) throw notFound('Peça não encontrada.');
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'remover_peca',
        entity: 'ordem_servico',
        entityId: so.id,
        label: `OS nº ${so.number}`,
        changes: [{ campo: 'pecas', anterior: `${rows[0].quantity}× ${rows[0].description} (${money(rows[0].total)})`, novo: null }],
      });
    });
    return { ok: true };
  });

  // Finalizar a OS gera o registro de manutenção (com as peças da OS)
  r.post('/service-orders/:id/finalize', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'editar');
    const body = ctx.body || {};
    const d = validate({ ...body, vehicle_id: '00000000-0000-0000-0000-000000000000', performed_on: body.completed_on }, MAINT_FIELDS);
    d.categories = parseCategories(body.categories);
    const flags = validate(body, { ...FLAGS, keep_vehicle_status: { type: 'bool' } });
    const servicesDone = body.services_done ? String(body.services_done).slice(0, 8000) : null;
    const out = await ctx.tx(async (c) => {
      const so = await lockOpenSO(c, ctx.params.id);
      if (d.performed_on < String(so.opened_on).slice(0, 10)) throw badRequest('A conclusão não pode ser antes da abertura da OS.');
      d.vehicle_id = so.vehicle_id;
      d.description = d.description || servicesDone || so.reported_problem;
      d.workshop = d.workshop ?? so.workshop;
      d.responsible = d.responsible ?? so.responsible;
      const { rows: parts } = await c.query('select * from maintenance_parts where service_order_id = $1', [so.id]);
      if (parts.length) d.parts_cost = Math.round(parts.reduce((s, p) => s + Number(p.total), 0) * 100) / 100;
      const { id } = await createMaintenance(c, ctx, d, { parts: [], flags, soId: so.id });
      await c.query('update maintenance_parts set maintenance_id = $2 where service_order_id = $1', [so.id, id]);
      await c.query(
        `update service_orders set status = 'finalizada', completed_on = $2, maintenance_id = $3, services_done = coalesce($4, services_done), updated_at = now() where id = $1`,
        [so.id, d.performed_on, id, servicesDone],
      );
      await c.query(`insert into service_order_status_log (service_order_id, from_status, to_status, note, user_id) values ($1, $2, 'finalizada', $3, $4)`, [
        so.id,
        so.status,
        'Manutenção registrada',
        ctx.user.id,
      ]);
      if (!flags.keep_vehicle_status) await restoreVehicleStatus(c, ctx, so, `OS nº ${so.number} finalizada`);
      await vehicleEvent(c, ctx, so.vehicle_id, {
        type: 'os',
        title: `OS nº ${so.number} finalizada`,
        description: `${catLabels(d.categories)}${d.total ? ` · ${money(d.total)}` : ''}`,
        at: noon(d.performed_on),
        refTable: 'service_orders',
        refId: so.id,
      });
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'finalizar',
        entity: 'ordem_servico',
        entityId: so.id,
        label: `OS nº ${so.number}`,
        changes: [{ campo: 'status', anterior: so.status, novo: 'finalizada' }],
      });
      return { maintenance_id: id };
    });
    return out;
  });

  r.post('/service-orders/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'manutencoes', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo do cancelamento.');
    await ctx.tx(async (c) => {
      const so = await lockOpenSO(c, ctx.params.id);
      await c.query(`update service_orders set status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [
        so.id,
        ctx.user.id,
        reason,
      ]);
      await c.query(`insert into service_order_status_log (service_order_id, from_status, to_status, note, user_id) values ($1, $2, 'cancelada', $3, $4)`, [
        so.id,
        so.status,
        reason,
        ctx.user.id,
      ]);
      await restoreVehicleStatus(c, ctx, so, `OS nº ${so.number} cancelada`);
      await vehicleEvent(c, ctx, so.vehicle_id, { type: 'os', title: `OS nº ${so.number} cancelada`, description: reason, refTable: 'service_orders', refId: so.id });
      await audit(c, ctx, {
        module: 'manutencoes',
        action: 'cancelar',
        entity: 'ordem_servico',
        entityId: so.id,
        label: `OS nº ${so.number}`,
        changes: [{ campo: 'status', anterior: so.status, novo: 'cancelada' }],
        reason,
      });
    });
    return { ok: true };
  });

}
