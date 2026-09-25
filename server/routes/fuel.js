import { validate } from '../validate.js';
import { badRequest, notFound, conflict } from '../http.js';
import { requirePerm, requireAny } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { registerKm, invalidateReading, syncCurrentKm } from '../km.js';
import { recalcVehicleFuel, fuelingDescription, AVG_SQL } from '../fuel.js';
import { FUELING_TYPES, NON_CONSUMPTION_FUELS, UF, TOWED_TYPES, CONSUMPTION_DEVIATION, labelOf } from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);
const fmtN = (v) => Number(v).toLocaleString('pt-BR');
const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvResponse(name, header, rows) {
  const body = '﻿' + [header.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
const fmtDT = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// ========================= ORDENS DE ABASTECIMENTO =========================

const ORDER_FIELDS = {
  vehicle_id: { type: 'uuid', required: true, label: 'Veículo' },
  driver_id: { type: 'uuid', label: 'Motorista' },
  order_date: { type: 'date', required: true, label: 'Data' },
  station: { type: 'string', max: 120, label: 'Posto autorizado' },
  fuel_type: { type: 'enum', values: keys(FUELING_TYPES), label: 'Combustível' },
  max_liters: { type: 'number', min: 0.01, max: 5000, label: 'Limite de litros' },
  max_amount: { type: 'number', min: 0.01, max: 100000, label: 'Limite de valor' },
  notes: { type: 'text', max: 2000, label: 'Observações' },
};

const ORDER_SELECT = `
  select o.*, v.plate, v.fleet_number, v.model, v.tank_capacity, d.full_name as driver_name,
         u.username as created_by_name, cu.username as cancelled_by_name,
         f.id as fueling_id, f.liters as used_liters, f.total as used_total, f.fueled_at as used_at
    from fuel_orders o
    join vehicles v on v.id = o.vehicle_id
    left join drivers d on d.id = o.driver_id
    left join users u on u.id = o.created_by
    left join users cu on cu.id = o.cancelled_by
    left join fuelings f on f.order_id = o.id and f.status = 'ativo'`;

async function getOrder(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Ordem não encontrada.');
  const { rows } = await db.query(`${ORDER_SELECT} where o.id = $1`, [id]);
  if (!rows[0]) throw notFound('Ordem não encontrada.');
  return rows[0];
}

async function checkVehicle(c, id, { forFueling = false } = {}) {
  const { rows } = await c.query('select id, plate, type, status, tank_capacity, current_km, fuel_type from vehicles where id = $1', [id]);
  const v = rows[0];
  if (!v) throw notFound('Veículo não encontrado.');
  if (v.status === 'inativo') throw badRequest('Veículo inativo.');
  if (forFueling && TOWED_TYPES.includes(v.type)) throw badRequest('Carretas e implementos não recebem abastecimento: lance no cavalo.');
  return v;
}

async function checkDriver(c, id) {
  if (!id) return null;
  const { rows } = await c.query('select id, full_name, status from drivers where id = $1', [id]);
  if (!rows[0]) throw notFound('Motorista não encontrado.');
  return rows[0];
}

// ========================= ABASTECIMENTOS =========================

const FUELING_FIELDS = {
  vehicle_id: { type: 'uuid', required: true, label: 'Veículo' },
  driver_id: { type: 'uuid', label: 'Motorista' },
  fueled_at: { type: 'datetime', required: true, label: 'Data e hora' },
  km: { type: 'int', required: true, min: 0, max: 9_999_999, label: 'Quilometragem' },
  station: { type: 'string', max: 120, label: 'Posto' },
  city: { type: 'string', max: 80, label: 'Cidade' },
  state: { type: 'enum', values: UF, label: 'Estado' },
  fuel_type: { type: 'enum', values: keys(FUELING_TYPES), required: true, label: 'Combustível' },
  liters: { type: 'number', required: true, min: 0.001, max: 5000, label: 'Litros' },
  price_per_liter: { type: 'number', min: 0, max: 100, label: 'Valor por litro' },
  total: { type: 'number', min: 0, max: 200000, label: 'Valor total' },
  full_tank: { type: 'bool', label: 'Tanque cheio' },
  order_id: { type: 'uuid', label: 'Ordem de abastecimento' },
  order_ref: { type: 'string', max: 40, label: 'Nº da ordem (externa)' },
  notes: { type: 'text', max: 2000, label: 'Observações' },
};
const FUELING_COLS = Object.keys(FUELING_FIELDS);

const FLAGS = {
  confirm_jump: { type: 'bool' },
  confirm_lower: { type: 'bool' },
  confirm_tank: { type: 'bool' },
  confirm_limit: { type: 'bool' },
  confirm_duplicate: { type: 'bool' },
  confirm_avg: { type: 'bool' },
  km_reason: { type: 'string', max: 500, label: 'Motivo' },
};

/** Completa valor total / preço por litro e confere se batem. */
function resolveValues(d) {
  const hasPrice = d.price_per_liter !== null && d.price_per_liter !== undefined;
  const hasTotal = d.total !== null && d.total !== undefined;
  if (!hasPrice && !hasTotal) throw badRequest('Informe o valor por litro ou o valor total.', { fields: { total: 'Obrigatório' } });
  if (!hasTotal) d.total = Math.round(d.liters * d.price_per_liter * 100) / 100;
  if (!hasPrice) d.price_per_liter = Math.round((d.total / d.liters) * 10000) / 10000;
  const expected = d.liters * d.price_per_liter;
  if (Math.abs(expected - d.total) > Math.max(1, d.total * 0.01)) {
    throw badRequest(`O valor total (${money(d.total)}) não confere com litros × valor por litro (${money(expected)}).`, {
      fields: { total: 'Não confere' },
    });
  }
}

const FUELING_SELECT = `
  select f.*, v.plate, v.fleet_number, v.model, v.tank_capacity, d.full_name as driver_name,
         o.number as order_number, u.username as created_by_name, cu.username as cancelled_by_name,
         va.km_per_liter as vehicle_avg
    from fuelings f
    join vehicles v on v.id = f.vehicle_id
    left join drivers d on d.id = f.driver_id
    left join fuel_orders o on o.id = f.order_id
    left join users u on u.id = f.created_by
    left join users cu on cu.id = f.cancelled_by
    left join lateral (
      select case when sum(calc_liters) > 0 then (sum(calc_distance) / sum(calc_liters))::float end as km_per_liter
        from fuelings x where x.vehicle_id = f.vehicle_id and x.status = 'ativo'
    ) va on true`;

function withFlags(f) {
  if (f.km_per_liter && f.vehicle_avg) {
    const dev = f.km_per_liter / f.vehicle_avg - 1;
    f.deviation = Math.round(dev * 1000) / 10; // %
    f.out_of_pattern = Math.abs(dev) > CONSUMPTION_DEVIATION;
  }
  return f;
}

async function getFueling(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Abastecimento não encontrado.');
  const { rows } = await db.query(`${FUELING_SELECT} where f.id = $1`, [id]);
  if (!rows[0]) throw notFound('Abastecimento não encontrado.');
  return withFlags(rows[0]);
}

/** Validações de negócio comuns à inclusão e edição (dentro da transação). */
async function businessChecks(c, ctx, d, flags, { currentId = null, currentOrderId = null } = {}) {
  const v = await checkVehicle(c, d.vehicle_id, { forFueling: true });
  await checkDriver(c, d.driver_id);
  if (new Date(d.fueled_at) > new Date(Date.now() + 10 * 60e3)) throw badRequest('A data do abastecimento não pode ser no futuro.');

  // Litros acima da capacidade do tanque
  if (!NON_CONSUMPTION_FUELS.includes(d.fuel_type) && v.tank_capacity && d.liters > v.tank_capacity * 1.05 && !flags.confirm_tank) {
    throw conflict(
      `${fmtN(d.liters)} L é mais do que a capacidade do tanque de ${v.plate} (${fmtN(v.tank_capacity)} L). Confirme se está correto.`,
      { code: 'LITROS_TANQUE' },
    );
  }

  // Provável lançamento duplicado
  if (!flags.confirm_duplicate) {
    const { rows } = await c.query(
      `select fueled_at from fuelings where vehicle_id = $1 and status = 'ativo' and km = $2 and abs(liters - $3) < 0.5
          and ($4::uuid is null or id <> $4)`,
      [d.vehicle_id, d.km, d.liters, currentId],
    );
    if (rows[0]) {
      throw conflict(`Já existe um abastecimento deste veículo com o mesmo KM e litros (${fmtDT(rows[0].fueled_at)}). É um novo abastecimento?`, {
        code: 'DUPLICADO_PROVAVEL',
      });
    }
  }

  // Ordem de abastecimento
  let order = null;
  if (d.order_id) {
    const { rows } = await c.query('select * from fuel_orders where id = $1 for update', [d.order_id]);
    order = rows[0];
    if (!order) throw notFound('Ordem de abastecimento não encontrada.');
    if (order.vehicle_id !== d.vehicle_id) throw badRequest(`A ordem nº ${order.number} é de outro veículo.`);
    if (order.status === 'cancelada') throw badRequest(`A ordem nº ${order.number} está cancelada.`);
    if (order.status === 'utilizada' && order.id !== currentOrderId) throw badRequest(`A ordem nº ${order.number} já foi utilizada.`);
    if (!flags.confirm_limit) {
      const over = [];
      if (order.max_liters && d.liters > Number(order.max_liters)) over.push(`litros (${fmtN(d.liters)} de ${fmtN(order.max_liters)} L)`);
      if (order.max_amount && d.total > Number(order.max_amount)) over.push(`valor (${money(d.total)} de ${money(order.max_amount)})`);
      if (over.length) {
        throw conflict(`O abastecimento ultrapassa o limite da ordem nº ${order.number}: ${over.join(' e ')}. Confirmar mesmo assim?`, {
          code: 'ORDEM_LIMITE',
        });
      }
    }
  }
  return { vehicle: v, order };
}

/**
 * Depois de recalcular: se a média deste abastecimento ficou muito fora do normal, pede confirmação
 * (normalmente é KM ou litros digitados errado). Lança erro → a transação é desfeita.
 */
async function checkPlausibleAverage(c, fuelingId, vehicleId, confirmed) {
  if (confirmed) return;
  const { rows } = await c.query('select km_per_liter from fuelings where id = $1', [fuelingId]);
  const kml = rows[0]?.km_per_liter;
  if (!kml) return;
  const { rows: h } = await c.query(
    `select count(*)::int as n, sum(calc_distance) / nullif(sum(calc_liters), 0) as avg from fuelings
      where vehicle_id = $1 and status = 'ativo' and km_per_liter is not null and id <> $2`,
    [vehicleId, fuelingId],
  );
  const avg = h[0].n >= 3 ? Number(h[0].avg) : null;
  const absurd = kml > 30 || kml < 0.5;
  const farFromAvg = avg && (kml > avg * 2 || kml < avg * 0.5);
  if (absurd || farFromAvg) {
    const n = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    throw conflict(
      `A média deste abastecimento ficaria em ${n(kml)} km/L${avg ? `, muito diferente da média do veículo (${n(avg)} km/L)` : ''}. Confira o KM e os litros. Salvar mesmo assim?`,
      { code: 'MEDIA_IMPROVAVEL' },
    );
  }
}

export default function (r) {
  // ---------------- Ordens ----------------
  r.get('/fuel-orders', async (ctx) => {
    requireAny(ctx.user, [
      ['ordens_abastecimento', 'ver'],
      ['abastecimentos', 'cadastrar'],
      ['abastecimentos', 'editar'],
    ]);
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.status) where.push(`o.status = ${p(q.status)}`);
    if (q.vehicle_id) where.push(`o.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.from) where.push(`o.order_date >= ${p(q.from)}::date`);
    if (q.to) where.push(`o.order_date <= ${p(q.to)}::date`);
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      where.push(
        `(v.plate ilike ${p(`%${q.q.toUpperCase().replace(/[-\s]/g, '')}%`)} or d.full_name ilike ${p(`%${q.q}%`)} or o.station ilike $${params.length}${digits ? ` or o.number::text = ${p(digits)}` : ''})`,
      );
    }
    const { rows } = await ctx.db.query(
      `${ORDER_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by o.number desc limit ${Math.min(Number(q.limit) || 300, 2000)}`,
      params,
    );
    return { orders: rows };
  });

  r.get('/fuel-orders/:id', async (ctx) => {
    requirePerm(ctx.user, 'ordens_abastecimento', 'ver');
    return { order: await getOrder(ctx.db, ctx.params.id) };
  });

  r.post('/fuel-orders', async (ctx) => {
    requirePerm(ctx.user, 'ordens_abastecimento', 'cadastrar');
    const d = validate(ctx.body, ORDER_FIELDS);
    if (!d.max_liters && !d.max_amount) throw badRequest('Informe o limite de litros e/ou o limite de valor.');
    const out = await ctx.tx(async (c) => {
      const v = await checkVehicle(c, d.vehicle_id, { forFueling: true });
      await checkDriver(c, d.driver_id);
      const cols = Object.keys(ORDER_FIELDS);
      const { rows } = await c.query(
        `insert into fuel_orders (${cols.join(', ')}, created_by) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
         returning id, number`,
        [...cols.map((k) => d[k]), ctx.user.id],
      );
      const o = rows[0];
      await vehicleEvent(c, ctx, v.id, {
        type: 'ordem_abastecimento',
        title: `Ordem de abastecimento nº ${o.number}`,
        description: [d.max_liters && `até ${fmtN(d.max_liters)} L`, d.max_amount && `até ${money(d.max_amount)}`, d.station].filter(Boolean).join(' · '),
        refTable: 'fuel_orders',
        refId: o.id,
      });
      await audit(c, ctx, {
        module: 'ordens_abastecimento',
        action: 'criar',
        entity: 'ordem_abastecimento',
        entityId: o.id,
        label: `Nº ${o.number} · ${v.plate}`,
        changes: snapshot(d),
      });
      return o;
    });
    return out;
  });

  r.put('/fuel-orders/:id', async (ctx) => {
    requirePerm(ctx.user, 'ordens_abastecimento', 'editar');
    const d = validate(ctx.body, ORDER_FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from fuel_orders where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Ordem não encontrada.');
      if (before.status !== 'pendente') throw badRequest('Somente ordens pendentes podem ser editadas.');
      if (d.vehicle_id) await checkVehicle(c, d.vehicle_id, { forFueling: true });
      if (d.driver_id) await checkDriver(c, d.driver_id);
      const merged = { ...before, ...d };
      if (!merged.max_liters && !merged.max_amount) throw badRequest('Informe o limite de litros e/ou o limite de valor.');
      const fields = Object.keys(d);
      if (!fields.length) return;
      await c.query(`update fuel_orders set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [
        before.id,
        ...fields.map((f) => d[f]),
      ]);
      await audit(c, ctx, {
        module: 'ordens_abastecimento',
        action: 'editar',
        entity: 'ordem_abastecimento',
        entityId: before.id,
        label: `Nº ${before.number}`,
        changes: diff(before, d, fields),
      });
    });
    return { ok: true };
  });

  r.post('/fuel-orders/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'ordens_abastecimento', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo do cancelamento.');
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from fuel_orders where id = $1 for update', [ctx.params.id]);
      const o = rows[0];
      if (!o) throw notFound('Ordem não encontrada.');
      if (o.status !== 'pendente') throw badRequest('Somente ordens pendentes podem ser canceladas. Se já foi utilizada, cancele o abastecimento primeiro.');
      await c.query(`update fuel_orders set status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [
        o.id,
        ctx.user.id,
        reason,
      ]);
      await vehicleEvent(c, ctx, o.vehicle_id, {
        type: 'ordem_abastecimento',
        title: `Ordem de abastecimento nº ${o.number} cancelada`,
        description: reason,
        refTable: 'fuel_orders',
        refId: o.id,
      });
      await audit(c, ctx, {
        module: 'ordens_abastecimento',
        action: 'cancelar',
        entity: 'ordem_abastecimento',
        entityId: o.id,
        label: `Nº ${o.number}`,
        changes: [{ campo: 'status', anterior: o.status, novo: 'cancelada' }],
        reason,
      });
    });
    return { ok: true };
  });

  // ---------------- Abastecimentos ----------------
  function fuelingFilters(q) {
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.vehicle_id) where.push(`f.vehicle_id = ${p(q.vehicle_id)}`);
    if (q.driver_id) where.push(`f.driver_id = ${p(q.driver_id)}`);
    if (q.fuel_type) where.push(`f.fuel_type = ${p(q.fuel_type)}`);
    if (q.from) where.push(`f.fueled_at >= (${p(q.from)}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    if (q.to) where.push(`f.fueled_at < (${p(q.to)}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
    if (q.station) where.push(`f.station ilike ${p(`%${q.station}%`)}`);
    if (q.status === 'todos') {
      /* sem filtro */
    } else where.push(`f.status = ${p(q.status || 'ativo')}`);
    return { where: where.length ? `where ${where.join(' and ')}` : '', params };
  }

  r.get('/fuelings', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'ver');
    const { where, params } = fuelingFilters(ctx.query);
    const limit = Math.min(Number(ctx.query.limit) || 500, 5000);
    const { rows } = await ctx.db.query(`${FUELING_SELECT} ${where} order by f.fueled_at desc, f.km desc limit ${limit}`, params);
    const { rows: tot } = await ctx.db.query(
      `select ${AVG_SQL} from (select f.* from fuelings f ${where}) t`,
      params,
    );
    let fuelings = rows.map(withFlags);
    if (ctx.query.fora_padrao === '1') fuelings = fuelings.filter((f) => f.out_of_pattern);
    return { fuelings, totals: tot[0], truncated: rows.length === limit };
  });

  r.get('/fuelings/export', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'exportar');
    const { where, params } = fuelingFilters(ctx.query);
    const { rows } = await ctx.db.query(`${FUELING_SELECT} ${where} order by f.fueled_at desc limit 50000`, params);
    await audit(ctx.db, ctx, { module: 'abastecimentos', action: 'exportar', entity: 'abastecimento', label: `${rows.length} registros` });
    return csvResponse(
      'abastecimentos',
      ['Data/hora', 'Placa', 'Frota', 'Motorista', 'KM', 'KM rodados', 'Posto', 'Cidade', 'UF', 'Combustível', 'Litros', 'R$/L', 'Total R$', 'Tanque cheio', 'Média km/L', 'Custo/km', 'Ordem', 'Status', 'Lançado por'],
      rows.map((f) => [
        fmtDT(f.fueled_at),
        f.plate,
        f.fleet_number,
        f.driver_name,
        f.km,
        f.distance,
        f.station,
        f.city,
        f.state,
        labelOf(FUELING_TYPES, f.fuel_type),
        f.liters,
        f.price_per_liter,
        f.total,
        f.full_tank ? 'Sim' : 'Não',
        f.km_per_liter,
        f.cost_per_km,
        f.order_number || f.order_ref,
        f.status,
        f.created_by_name,
      ]),
    );
  });

  r.get('/fuelings/:id', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'ver');
    return { fueling: await getFueling(ctx.db, ctx.params.id) };
  });

  r.post('/fuelings', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'cadastrar');
    const d = validate(ctx.body, FUELING_FIELDS);
    const flags = validate(ctx.body, FLAGS);
    if (ctx.body?.full_tank === undefined) d.full_tank = true;
    resolveValues(d);
    if (d.order_id) d.order_ref = null;

    const result = await ctx.tx(async (c) => {
      const { vehicle, order } = await businessChecks(c, ctx, d, flags);
      const { rows } = await c.query(
        `insert into fuelings (${FUELING_COLS.join(', ')}, created_by) values (${FUELING_COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${FUELING_COLS.length + 1})
         returning id`,
        [...FUELING_COLS.map((k) => d[k]), ctx.user.id],
      );
      const id = rows[0].id;
      const km = await registerKm(c, ctx, vehicle.id, d.km, {
        source: 'abastecimento',
        sourceId: id,
        readingAt: d.fueled_at,
        confirmJump: flags.confirm_jump,
        confirmLower: flags.confirm_lower,
        reason: flags.km_reason,
      });
      if (order) await c.query(`update fuel_orders set status = 'utilizada', updated_at = now() where id = $1`, [order.id]);
      await vehicleEvent(c, ctx, vehicle.id, {
        type: 'abastecimento',
        title: 'Abastecimento',
        description: fuelingDescription(d),
        at: d.fueled_at,
        refTable: 'fuelings',
        refId: id,
      });
      await recalcVehicleFuel(c, vehicle.id);
      await checkPlausibleAverage(c, id, vehicle.id, flags.confirm_avg);
      await audit(c, ctx, {
        module: 'abastecimentos',
        action: 'criar',
        entity: 'abastecimento',
        entityId: id,
        label: `${vehicle.plate} · ${fmtDT(d.fueled_at)}`,
        changes: snapshot(d),
      });
      return { id, km_updated: km.updated, historical: km.historical };
    });
    const f = await getFueling(ctx.db, result.id);
    return { ...result, fueling: f };
  });

  r.put('/fuelings/:id', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'editar');
    const patch = validate(ctx.body, FUELING_FIELDS, { partial: true });
    const flags = validate(ctx.body, FLAGS);
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from fuelings where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Abastecimento não encontrado.');
      if (before.status !== 'ativo') throw badRequest('Abastecimento cancelado não pode ser editado.');
      if (patch.vehicle_id && patch.vehicle_id !== before.vehicle_id) {
        throw badRequest('Para trocar o veículo, cancele este abastecimento e lance novamente no veículo correto.');
      }
      const d = { ...before, ...patch, fueled_at: new Date(patch.fueled_at ?? before.fueled_at).toISOString() };
      for (const k of ['liters', 'price_per_liter', 'total']) d[k] = Number(d[k]);
      // Se mudou litros ou preço sem informar o total, recalcula o total
      if ((patch.liters !== undefined || patch.price_per_liter !== undefined) && patch.total === undefined) d.total = null;
      if (patch.total !== undefined && patch.price_per_liter === undefined) d.price_per_liter = null;
      resolveValues(d);
      if (patch.order_id) d.order_ref = null;

      const { order } = await businessChecks(c, ctx, d, flags, { currentId: before.id, currentOrderId: before.order_id });

      const kmChanged = d.km !== before.km || new Date(d.fueled_at).getTime() !== new Date(before.fueled_at).getTime();
      if (kmChanged) {
        await invalidateReading(c, before.vehicle_id, 'abastecimento', before.id);
        await registerKm(c, ctx, before.vehicle_id, d.km, {
          source: 'abastecimento',
          sourceId: before.id,
          readingAt: d.fueled_at,
          confirmJump: flags.confirm_jump,
          confirmLower: flags.confirm_lower,
          reason: flags.km_reason,
        });
        await syncCurrentKm(c, ctx, before.vehicle_id, { reason: flags.km_reason || 'Edição de abastecimento' });
      }

      // Troca de ordem vinculada
      if ((before.order_id || null) !== (d.order_id || null)) {
        if (before.order_id) await c.query(`update fuel_orders set status = 'pendente', updated_at = now() where id = $1 and status = 'utilizada'`, [before.order_id]);
        if (order) await c.query(`update fuel_orders set status = 'utilizada', updated_at = now() where id = $1`, [order.id]);
      }

      const cols = FUELING_COLS.filter((k) => k !== 'vehicle_id');
      await c.query(`update fuelings set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [
        before.id,
        ...cols.map((k) => d[k]),
      ]);
      await c.query(`update vehicle_events set event_at = $2 where ref_table = 'fuelings' and ref_id = $1 and type = 'abastecimento'`, [
        before.id,
        d.fueled_at,
      ]);
      await recalcVehicleFuel(c, before.vehicle_id);
      await checkPlausibleAverage(c, before.id, before.vehicle_id, flags.confirm_avg);
      const { rows: vp } = await c.query('select plate from vehicles where id = $1', [before.vehicle_id]);
      await audit(c, ctx, {
        module: 'abastecimentos',
        action: 'editar',
        entity: 'abastecimento',
        entityId: before.id,
        label: `${vp[0].plate} · ${fmtDT(before.fueled_at)}`,
        changes: diff(
          { ...before, fueled_at: new Date(before.fueled_at).toISOString(), liters: Number(before.liters), price_per_liter: Number(before.price_per_liter), total: Number(before.total) },
          d,
          cols,
        ),
      });
    });
    return { fueling: await getFueling(ctx.db, ctx.params.id) };
  });

  r.post('/fuelings/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo do cancelamento.');
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select f.*, v.plate from fuelings f join vehicles v on v.id = f.vehicle_id where f.id = $1 for update of f', [ctx.params.id]);
      const f = rows[0];
      if (!f) throw notFound('Abastecimento não encontrado.');
      if (f.status !== 'ativo') throw badRequest('Este abastecimento já está cancelado.');
      await c.query(`update fuelings set status = 'cancelado', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now() where id = $1`, [
        f.id,
        ctx.user.id,
        reason,
      ]);
      await invalidateReading(c, f.vehicle_id, 'abastecimento', f.id);
      await syncCurrentKm(c, ctx, f.vehicle_id, { reason: `Cancelamento de abastecimento: ${reason}` });
      if (f.order_id) await c.query(`update fuel_orders set status = 'pendente', updated_at = now() where id = $1 and status = 'utilizada'`, [f.order_id]);
      await c.query(
        `update vehicle_events set title = 'Abastecimento (cancelado)', description = 'CANCELADO — ' || coalesce(description, '')
          where ref_table = 'fuelings' and ref_id = $1 and type = 'abastecimento'`,
        [f.id],
      );
      await vehicleEvent(c, ctx, f.vehicle_id, {
        type: 'abastecimento_cancelado',
        title: 'Abastecimento cancelado',
        description: `${fmtDT(f.fueled_at)} · ${fmtN(f.liters)} L — ${reason}`,
        refTable: 'fuelings',
        refId: f.id,
      });
      await recalcVehicleFuel(c, f.vehicle_id);
      await audit(c, ctx, {
        module: 'abastecimentos',
        action: 'cancelar',
        entity: 'abastecimento',
        entityId: f.id,
        label: `${f.plate} · ${fmtDT(f.fueled_at)}`,
        changes: [{ campo: 'status', anterior: 'ativo', novo: 'cancelado' }],
        reason,
      });
    });
    return { ok: true };
  });

  // ---------------- Médias ----------------
  // Médias por veículo no período (a data considerada é a do abastecimento que fecha o ciclo de tanque cheio)
  r.get('/fuel/averages', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'ver');
    const q = ctx.query;
    const params = [];
    const where = [`status = 'ativo'`];
    if (q.from) {
      params.push(q.from);
      where.push(`fueled_at >= ($${params.length}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`fueled_at < ($${params.length}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    if (q.vehicle_id) {
      params.push(q.vehicle_id);
      where.push(`vehicle_id = $${params.length}`);
    }
    const w = where.join(' and ');
    const { rows } = await ctx.db.query(
      `select a.*, v.plate, v.fleet_number, v.brand, v.model, v.type, overall.km_per_liter as overall_km_per_liter
         from (select vehicle_id, ${AVG_SQL} from fuelings where ${w} group by vehicle_id) a
         join vehicles v on v.id = a.vehicle_id
         left join lateral (select case when sum(calc_liters) > 0 then (sum(calc_distance) / sum(calc_liters))::float end as km_per_liter
                              from fuelings x where x.vehicle_id = a.vehicle_id and x.status = 'ativo') overall on true
        order by a.km_per_liter desc nulls last`,
      params,
    );
    const { rows: fleet } = await ctx.db.query(`select ${AVG_SQL} from fuelings where ${w}`, params);
    return { vehicles: rows, fleet: fleet[0] };
  });

  // Série por mês ou ano (gráfico). Média por abastecimento vem de /fuelings?vehicle_id=
  r.get('/fuel/series', async (ctx) => {
    requirePerm(ctx.user, 'abastecimentos', 'ver');
    const group = ctx.query.group === 'year' ? 'year' : 'month';
    const params = [];
    const where = [`status = 'ativo'`];
    if (ctx.query.vehicle_id) {
      params.push(ctx.query.vehicle_id);
      where.push(`vehicle_id = $${params.length}`);
    }
    if (ctx.query.from) {
      params.push(ctx.query.from);
      where.push(`fueled_at >= ($${params.length}::date)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    if (ctx.query.to) {
      params.push(ctx.query.to);
      where.push(`fueled_at < ($${params.length}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
    }
    const { rows } = await ctx.db.query(
      `select to_char(date_trunc('${group}', fueled_at at time zone 'America/Sao_Paulo'), '${group === 'year' ? 'YYYY' : 'YYYY-MM'}') as period, ${AVG_SQL}
         from fuelings where ${where.join(' and ')} group by 1 order by 1`,
      params,
    );
    return { series: rows, group };
  });

  // Resumo de combustível para a ficha do veículo
  r.get('/vehicles/:id/fuel-summary', async (ctx) => {
    requireAny(ctx.user, [
      ['veiculos', 'ver'],
      ['abastecimentos', 'ver'],
    ]);
    const id = ctx.params.id;
    const db = ctx.db;
    const { rows: last } = await db.query(
      `select id, fueled_at, km, liters, total, km_per_liter, station, fuel_type from fuelings
        where vehicle_id = $1 and status = 'ativo' order by fueled_at desc limit 1`,
      [id],
    );
    const { rows: lastAvg } = await db.query(
      `select km_per_liter, fueled_at from fuelings where vehicle_id = $1 and status = 'ativo' and km_per_liter is not null order by km desc limit 1`,
      [id],
    );
    const { rows: d90 } = await db.query(
      `select ${AVG_SQL} from fuelings where vehicle_id = $1 and status = 'ativo' and fueled_at >= now() - interval '90 days'`,
      [id],
    );
    const { rows: all } = await db.query(`select ${AVG_SQL} from fuelings where vehicle_id = $1 and status = 'ativo'`, [id]);
    const { rows: month } = await db.query(
      `select ${AVG_SQL} from fuelings where vehicle_id = $1 and status = 'ativo'
          and fueled_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`,
      [id],
    );
    const { rows: pend } = await db.query(`select count(*)::int as n from fuel_orders where vehicle_id = $1 and status = 'pendente'`, [id]);
    return {
      last: last[0] || null,
      last_average: lastAvg[0] || null,
      last_90_days: d90[0],
      overall: all[0],
      month: month[0],
      pending_orders: pend[0].n,
    };
  });
}
