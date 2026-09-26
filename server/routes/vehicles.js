import { validate } from '../validate.js';
import { badRequest, notFound, conflict } from '../http.js';
import { requirePerm, requireAny } from '../permissions.js';
import { audit, diff, snapshot, vehicleEvent } from '../audit.js';
import { registerKm } from '../km.js';
import { aetCheck } from './documents.js';
import {
  VEHICLE_TYPES,
  FUEL_TYPES,
  VEHICLE_STATUS,
  TOWED_TYPES,
  TRACTOR_TYPES,
  labelOf,
} from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);

const FIELDS = {
  plate: { type: 'plate', required: true, label: 'Placa' },
  fleet_number: { type: 'string', max: 20, label: 'Número da frota', upper: true },
  brand: { type: 'string', max: 60, label: 'Marca' },
  model: { type: 'string', max: 80, label: 'Modelo' },
  year_manufacture: { type: 'int', min: 1950, max: 2100, label: 'Ano de fabricação' },
  year_model: { type: 'int', min: 1950, max: 2101, label: 'Ano do modelo' },
  chassis: { type: 'string', max: 30, upper: true, label: 'Chassi' },
  renavam: { type: 'renavam', label: 'RENAVAM' },
  type: { type: 'enum', values: keys(VEHICLE_TYPES), required: true, label: 'Tipo' },
  fuel_type: { type: 'enum', values: keys(FUEL_TYPES), label: 'Combustível' },
  tank_capacity: { type: 'number', min: 0, max: 5000, label: 'Capacidade do tanque' },
  acquisition_date: { type: 'date', label: 'Data de aquisição' },
  axle_config: { type: 'string', max: 40, label: 'Configuração de eixos' },
  color: { type: 'string', max: 30, label: 'Cor', upper: true },
  body_type: { type: 'string', max: 60, label: 'Carroceria', upper: true },
  pbt: { type: 'number', min: 0, max: 200, label: 'PBT (t)' },
  cmt: { type: 'number', min: 0, max: 200, label: 'CMT (t)' },
  capacity: { type: 'number', min: 0, max: 200, label: 'Capacidade de carga (t)' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};
const EDITABLE = Object.keys(FIELDS);

const BASE_SELECT = `
  select v.*,
         d.id as driver_id, d.full_name as driver_name, da.start_at as driver_since,
         (select coalesce(json_agg(json_build_object('id', t.id, 'plate', t.plate, 'fleet_number', t.fleet_number, 'type', t.type,
                   'since', vc.start_at) order by vc.start_at), '[]'::json)
            from vehicle_couplings vc join vehicles t on t.id = vc.trailer_id
           where vc.tractor_id = v.id and vc.end_at is null) as trailers,
         (select json_build_object('id', t.id, 'plate', t.plate, 'fleet_number', t.fleet_number, 'since', vc.start_at)
            from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id
           where vc.trailer_id = v.id and vc.end_at is null) as tractor
    from vehicles v
    left join driver_assignments da on da.vehicle_id = v.id and da.end_at is null
    left join drivers d on d.id = da.driver_id`;

async function getVehicle(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Veículo não encontrado.');
  const { rows } = await db.query(`${BASE_SELECT} where v.id = $1`, [id]);
  if (!rows[0]) throw notFound('Veículo não encontrado.');
  return rows[0];
}

async function lockVehicle(c, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Veículo não encontrado.');
  const { rows } = await c.query('select * from vehicles where id = $1 for update', [id]);
  if (!rows[0]) throw notFound('Veículo não encontrado.');
  return rows[0];
}

const vLabel = (v) => (v.fleet_number ? `${v.plate} (frota ${v.fleet_number})` : v.plate);

/** Encerra o vínculo de motorista aberto do veículo (se houver). */
async function endAssignment(c, ctx, vehicle, reason) {
  const { rows } = await c.query(
    `update driver_assignments set end_at = now(), end_km = $2, ended_by = $3
      where vehicle_id = $1 and end_at is null returning driver_id`,
    [vehicle.id, vehicle.current_km, ctx.user.id],
  );
  if (!rows[0]) return null;
  const { rows: d } = await c.query('select full_name from drivers where id = $1', [rows[0].driver_id]);
  await vehicleEvent(c, ctx, vehicle.id, {
    type: 'motorista',
    title: 'Motorista desvinculado',
    description: `${d[0].full_name}${reason ? ` — ${reason}` : ''}`,
    refTable: 'drivers',
    refId: rows[0].driver_id,
  });
  return rows[0].driver_id;
}

async function endCoupling(c, ctx, trailerId, reason) {
  const { rows } = await c.query(
    `update vehicle_couplings vc set end_at = now(), ended_by = $2,
            end_km = (select current_km from vehicles where id = vc.tractor_id)
      where trailer_id = $1 and end_at is null returning tractor_id`,
    [trailerId, ctx.user.id],
  );
  if (!rows[0]) return null;
  const { rows: vs } = await c.query('select id, plate, fleet_number from vehicles where id = any($1)', [[rows[0].tractor_id, trailerId]]);
  const tractor = vs.find((x) => x.id === rows[0].tractor_id);
  const trailer = vs.find((x) => x.id === trailerId);
  const suffix = reason ? ` — ${reason}` : '';
  await vehicleEvent(c, ctx, tractor.id, { type: 'engate', title: 'Implemento desengatado', description: vLabel(trailer) + suffix });
  await vehicleEvent(c, ctx, trailer.id, { type: 'engate', title: 'Desengatado do cavalo', description: vLabel(tractor) + suffix });
  return rows[0].tractor_id;
}

export default function (r) {
  // Lista enxuta para campos de seleção em outros módulos
  r.get('/vehicles/options', async (ctx) => {
    const { rows } = await ctx.db.query(
      `select id, plate, fleet_number, type, status, current_km, model from vehicles
        where status <> 'inativo' or $1 order by plate`,
      [ctx.query.all === '1'],
    );
    return { vehicles: rows };
  });

  r.get('/vehicles', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.q) {
      const term = `%${q.q.trim().toUpperCase().replace(/[-\s]/g, '')}%`;
      const raw = `%${q.q.trim()}%`;
      where.push(`(v.plate like ${p(term)} or upper(coalesce(v.fleet_number,'')) like ${p(raw.toUpperCase())}
                  or v.model ilike ${p(raw)} or v.brand ilike ${p(raw)} or d.full_name ilike ${p(raw)})`);
    }
    if (q.group === 'implementos') where.push(`v.type = any(${p(TOWED_TYPES)})`);
    if (q.group === 'frota') where.push(`not (v.type = any(${p(TOWED_TYPES)}))`);
    if (q.type) where.push(`v.type = ${p(q.type)}`);
    if (q.status) where.push(`v.status = ${p(q.status)}`);
    else if (q.inativos !== '1') where.push(`v.status <> 'inativo'`);
    const { rows } = await ctx.db.query(
      `${BASE_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by v.fleet_number nulls last, v.plate`,
      params,
    );
    return { vehicles: rows };
  });

  r.get('/vehicles/:id', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const v = await getVehicle(ctx.db, ctx.params.id);
    // KM rodado por carretas/implementos: soma do KM do cavalo durante cada engate
    if (TOWED_TYPES.includes(v.type)) {
      const { rows } = await ctx.db.query(
        `select coalesce(sum(greatest(coalesce(vc.end_km, t.current_km) - coalesce(vc.start_km, 0), 0)), 0)::int as km
           from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id where vc.trailer_id = $1`,
        [v.id],
      );
      v.towed_km = rows[0].km;
    }
    const { rows: lastKm } = await ctx.db.query(
      `select k.km, k.reading_at, k.source, u.username from km_readings k left join users u on u.id = k.user_id
        where k.vehicle_id = $1 order by k.reading_at desc, k.id desc limit 1`,
      [v.id],
    );
    v.last_km_reading = lastKm[0] || null;
    return { vehicle: v };
  });

  r.post('/vehicles', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'cadastrar');
    const data = validate(ctx.body, FIELDS);
    const extra = validate(ctx.body, {
      current_km: { type: 'int', min: 0, max: 9_999_999, label: 'Quilometragem atual' },
      status: { type: 'enum', values: keys(VEHICLE_STATUS).filter((s) => s !== 'inativo'), label: 'Status' },
    });
    const km = extra.current_km ?? 0;
    const status = extra.status || 'disponivel';
    if (TOWED_TYPES.includes(data.type) && !data.fuel_type) data.fuel_type = 'nenhum';

    const id = await ctx.tx(async (c) => {
      const cols = [...EDITABLE, 'current_km', 'km_updated_at', 'status', 'created_by'];
      const vals = [...EDITABLE.map((k) => data[k]), km, km ? new Date().toISOString() : null, status, ctx.user.id];
      const { rows } = await c.query(
        `insert into vehicles (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        vals,
      );
      const newId = rows[0].id;
      if (km) {
        await c.query(
          `insert into km_readings (vehicle_id, km, previous_km, source, user_id) values ($1, $2, null, 'cadastro', $3)`,
          [newId, km, ctx.user.id],
        );
      }
      await vehicleEvent(c, ctx, newId, {
        type: 'cadastro',
        title: 'Veículo cadastrado',
        description: `${labelOf(VEHICLE_TYPES, data.type)} ${[data.brand, data.model].filter(Boolean).join(' ')}${km ? ` — KM inicial ${km.toLocaleString('pt-BR')}` : ''}`,
      });
      await audit(c, ctx, {
        module: 'veiculos',
        action: 'criar',
        entity: 'veiculo',
        entityId: newId,
        label: data.plate,
        changes: snapshot({ ...data, current_km: km, status }),
      });
      return newId;
    });
    return { id };
  });

  r.put('/vehicles/:id', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'editar');
    const data = validate(ctx.body, FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      const before = await lockVehicle(c, ctx.params.id);
      const fields = Object.keys(data);
      if (!fields.length) return;
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      await c.query(`update vehicles set ${sets}, updated_at = now() where id = $1`, [before.id, ...fields.map((f) => data[f])]);
      const changes = diff(before, data, fields);
      await audit(c, ctx, { module: 'veiculos', action: 'editar', entity: 'veiculo', entityId: before.id, label: before.plate, changes });
      if (changes.length) {
        await vehicleEvent(c, ctx, before.id, {
          type: 'edicao',
          title: 'Cadastro atualizado',
          description: changes.map((ch) => FIELDS[ch.campo]?.label || ch.campo).join(', '),
        });
      }
    });
    return { ok: true };
  });

  r.post('/vehicles/:id/status', async (ctx) => {
    const { status, reason } = validate(ctx.body, {
      status: { type: 'enum', values: keys(VEHICLE_STATUS), required: true, label: 'Status' },
      reason: { type: 'string', max: 500, label: 'Motivo' },
    });
    await ctx.tx(async (c) => {
      const v = await lockVehicle(c, ctx.params.id);
      if (v.status === status) return;
      // Inativar/reativar exige a permissão "Cancelar"
      requirePerm(ctx.user, 'veiculos', status === 'inativo' || v.status === 'inativo' ? 'cancelar' : 'editar');
      if (status === 'inativo' && !reason) throw badRequest('Informe o motivo da inativação.');
      await c.query('update vehicles set status = $2, updated_at = now() where id = $1', [v.id, status]);
      if (status === 'inativo') {
        await endAssignment(c, ctx, v, 'veículo inativado');
        await endCoupling(c, ctx, v.id, 'veículo inativado');
        const { rows } = await c.query('select trailer_id from vehicle_couplings where tractor_id = $1 and end_at is null', [v.id]);
        for (const row of rows) await endCoupling(c, ctx, row.trailer_id, 'cavalo inativado');
      }
      await vehicleEvent(c, ctx, v.id, {
        type: 'status',
        title: `Status: ${labelOf(VEHICLE_STATUS, status)}`,
        description: `${labelOf(VEHICLE_STATUS, v.status)} → ${labelOf(VEHICLE_STATUS, status)}${reason ? ` — ${reason}` : ''}`,
      });
      await audit(c, ctx, {
        module: 'veiculos',
        action: status === 'inativo' ? 'inativar' : 'alterar_status',
        entity: 'veiculo',
        entityId: v.id,
        label: v.plate,
        changes: [{ campo: 'status', anterior: v.status, novo: status }],
        reason,
      });
    });
    return { ok: true };
  });

  r.post('/vehicles/:id/km', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'editar');
    const d = validate(ctx.body, {
      km: { type: 'int', required: true, min: 0, max: 9_999_999, label: 'Quilometragem' },
      reading_at: { type: 'datetime', label: 'Data da leitura' },
      reason: { type: 'string', max: 500, label: 'Motivo' },
      confirm_lower: { type: 'bool' },
      confirm_jump: { type: 'bool' },
    });
    if (d.reading_at && new Date(d.reading_at) > new Date(Date.now() + 5 * 60e3)) throw badRequest('A data da leitura não pode ser no futuro.');
    const result = await ctx.tx((c) =>
      registerKm(c, ctx, ctx.params.id, d.km, {
        source: 'manual',
        readingAt: d.reading_at,
        reason: d.reason,
        confirmLower: d.confirm_lower,
        confirmJump: d.confirm_jump,
      }),
    );
    return result;
  });

  r.get('/vehicles/:id/km', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const { rows } = await ctx.db.query(
      `select k.id, k.km, k.previous_km, k.reading_at, k.source, k.is_correction, k.reason, u.username
         from km_readings k left join users u on u.id = k.user_id
        where k.vehicle_id = $1 order by k.reading_at desc, k.id desc limit $2`,
      [ctx.params.id, Math.min(Number(ctx.query.limit) || 100, 1000)],
    );
    return { readings: rows };
  });

  r.get('/vehicles/:id/events', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const params = [ctx.params.id];
    let extra = '';
    if (ctx.query.type) {
      params.push(ctx.query.type);
      extra = ` and e.type = $${params.length}`;
    }
    const { rows } = await ctx.db.query(
      `select e.id, e.event_at, e.type, e.title, e.description, e.ref_table, e.ref_id, e.data, u.username
         from vehicle_events e left join users u on u.id = e.user_id
        where e.vehicle_id = $1${extra} order by e.event_at desc, e.id desc limit ${Math.min(Number(ctx.query.limit) || 200, 1000)}`,
      params,
    );
    return { events: rows };
  });

  r.get('/vehicles/:id/assignments', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const { rows } = await ctx.db.query(
      `select a.id, a.driver_id, d.full_name as driver_name, a.start_at, a.end_at, a.start_km, a.end_km, a.notes
         from driver_assignments a join drivers d on d.id = a.driver_id
        where a.vehicle_id = $1 order by a.start_at desc`,
      [ctx.params.id],
    );
    return { assignments: rows };
  });

  r.get('/vehicles/:id/couplings', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'ver');
    const { rows } = await ctx.db.query(
      `select vc.id, vc.start_at, vc.end_at, vc.start_km, vc.end_km,
              t.id as tractor_id, t.plate as tractor_plate, t.fleet_number as tractor_fleet,
              r.id as trailer_id, r.plate as trailer_plate, r.fleet_number as trailer_fleet
         from vehicle_couplings vc join vehicles t on t.id = vc.tractor_id join vehicles r on r.id = vc.trailer_id
        where vc.tractor_id = $1 or vc.trailer_id = $1 order by vc.start_at desc`,
      [ctx.params.id],
    );
    return { couplings: rows };
  });

  // Vincular / desvincular motorista
  r.post('/vehicles/:id/driver', async (ctx) => {
    requireAny(ctx.user, [
      ['veiculos', 'editar'],
      ['motoristas', 'editar'],
    ]);
    const { driver_id, notes } = validate(ctx.body, {
      driver_id: { type: 'uuid', label: 'Motorista' },
      notes: { type: 'string', max: 500, label: 'Observação' },
    });
    await ctx.tx(async (c) => {
      const v = await lockVehicle(c, ctx.params.id);
      const { rows: cur } = await c.query('select driver_id from driver_assignments where vehicle_id = $1 and end_at is null', [v.id]);
      const currentDriver = cur[0]?.driver_id || null;
      if (currentDriver === driver_id) return;
      if (driver_id && v.status === 'inativo') throw badRequest('Veículo inativo não pode receber motorista.');
      if (driver_id && TOWED_TYPES.includes(v.type)) throw badRequest('Carretas e implementos não recebem motorista — vincule ao cavalo.');

      let driver;
      if (driver_id) {
        const { rows } = await c.query('select id, full_name, status from drivers where id = $1 for update', [driver_id]);
        driver = rows[0];
        if (!driver) throw notFound('Motorista não encontrado.');
        if (driver.status === 'inativo') throw badRequest('Motorista inativo não pode ser vinculado.');
      }

      await endAssignment(c, ctx, v, notes);

      if (driver) {
        // Se o motorista estava em outro veículo, encerra aquele vínculo
        const { rows: other } = await c.query(
          `select v.* from driver_assignments a join vehicles v on v.id = a.vehicle_id where a.driver_id = $1 and a.end_at is null`,
          [driver.id],
        );
        if (other[0]) await endAssignment(c, ctx, other[0], `transferido para ${v.plate}`);
        await c.query(
          `insert into driver_assignments (driver_id, vehicle_id, start_km, notes, created_by) values ($1, $2, $3, $4, $5)`,
          [driver.id, v.id, v.current_km, notes, ctx.user.id],
        );
        await vehicleEvent(c, ctx, v.id, {
          type: 'motorista',
          title: 'Motorista vinculado',
          description: `${driver.full_name}${notes ? ` — ${notes}` : ''}`,
          refTable: 'drivers',
          refId: driver.id,
        });
      }
      const { rows: prev } = currentDriver
        ? await c.query('select full_name from drivers where id = $1', [currentDriver])
        : { rows: [] };
      await audit(c, ctx, {
        module: 'veiculos',
        action: 'vincular_motorista',
        entity: 'veiculo',
        entityId: v.id,
        label: v.plate,
        changes: [{ campo: 'motorista', anterior: prev[0]?.full_name ?? null, novo: driver?.full_name ?? null }],
        reason: notes,
      });
    });
    return { ok: true };
  });

  // Engatar / desengatar carreta ou implemento
  r.post('/vehicles/:id/couple', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'editar');
    const { trailer_id } = validate(ctx.body, { trailer_id: { type: 'uuid', required: true, label: 'Implemento' } });
    const { tractor, trailer } = await ctx.tx(async (c) => {
      const tractor = await lockVehicle(c, ctx.params.id);
      const trailer = await lockVehicle(c, trailer_id);
      if (!TRACTOR_TYPES.includes(tractor.type)) throw badRequest('Somente cavalos mecânicos e caminhões podem engatar implementos.');
      if (!TOWED_TYPES.includes(trailer.type)) throw badRequest('Selecione uma carreta ou implemento.');
      if (tractor.status === 'inativo' || trailer.status === 'inativo') throw badRequest('Veículo inativo não pode ser engatado.');
      const { rows: open } = await c.query('select tractor_id from vehicle_couplings where trailer_id = $1 and end_at is null', [
        trailer.id,
      ]);
      if (open[0]?.tractor_id === tractor.id) throw conflict('Este implemento já está engatado neste veículo.');
      if (open[0]) await endCoupling(c, ctx, trailer.id, `transferido para ${tractor.plate}`);
      await c.query(`insert into vehicle_couplings (tractor_id, trailer_id, start_km, created_by) values ($1, $2, $3, $4)`, [
        tractor.id,
        trailer.id,
        tractor.current_km,
        ctx.user.id,
      ]);
      await vehicleEvent(c, ctx, tractor.id, { type: 'engate', title: 'Implemento engatado', description: vLabel(trailer) });
      await vehicleEvent(c, ctx, trailer.id, {
        type: 'engate',
        title: 'Engatado no cavalo',
        description: `${vLabel(tractor)} — KM do cavalo ${tractor.current_km.toLocaleString('pt-BR')}`,
      });
      await audit(c, ctx, {
        module: 'veiculos',
        action: 'engatar',
        entity: 'veiculo',
        entityId: tractor.id,
        label: tractor.plate,
        changes: [{ campo: 'implemento', anterior: null, novo: trailer.plate }],
      });
      return { tractor, trailer };
    });
    // Aviso (não bloqueia): o cavalo tem AET e este implemento não está autorizado nela
    const check = await aetCheck(ctx.db, tractor.id, trailer.id);
    const aetWarning = check.covered
      ? null
      : `${trailer.plate} não consta na AET vigente de ${tractor.plate}${check.missing.length ? ` (${check.missing.join('; ')})` : ''}. Confira antes de rodar em rota que exige AET.`;
    return { ok: true, aet_warning: aetWarning };
  });

  r.post('/vehicles/:id/uncouple', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'editar');
    const { trailer_id } = validate(ctx.body, { trailer_id: { type: 'uuid', required: true, label: 'Implemento' } });
    await ctx.tx(async (c) => {
      const tractor = await lockVehicle(c, ctx.params.id);
      const { rows } = await c.query(
        'select 1 from vehicle_couplings where tractor_id = $1 and trailer_id = $2 and end_at is null',
        [tractor.id, trailer_id],
      );
      if (!rows[0]) throw notFound('Este implemento não está engatado neste veículo.');
      const { rows: t } = await c.query('select plate from vehicles where id = $1', [trailer_id]);
      await endCoupling(c, ctx, trailer_id);
      await audit(c, ctx, {
        module: 'veiculos',
        action: 'desengatar',
        entity: 'veiculo',
        entityId: tractor.id,
        label: tractor.plate,
        changes: [{ campo: 'implemento', anterior: t[0].plate, novo: null }],
      });
    });
    return { ok: true };
  });

  // Exclusão definitiva: só para cadastro feito por engano, sem registros vinculados
  r.del('/vehicles/:id', async (ctx) => {
    requirePerm(ctx.user, 'veiculos', 'excluir');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo da exclusão.');
    await ctx.tx(async (c) => {
      const v = await lockVehicle(c, ctx.params.id);
      const { rows: refs } = await c.query(
        `select (select count(*) from driver_assignments where vehicle_id = $1)
              + (select count(*) from vehicle_couplings where tractor_id = $1 or trailer_id = $1)
              + (select count(*) from driver_occurrences where vehicle_id = $1) as n`,
        [v.id],
      );
      if (refs[0].n > 0) {
        throw conflict('Este veículo possui histórico (motoristas, engates ou ocorrências). Use Inativar em vez de excluir.', {
          code: 'VINCULADO',
        });
      }
      await c.query('update vehicles set photo_id = null where id = $1', [v.id]);
      await c.query(`update attachments set deleted_at = now(), deleted_by = $2 where entity = 'vehicle' and entity_id = $1`, [
        v.id,
        ctx.user.id,
      ]);
      await c.query('delete from km_readings where vehicle_id = $1', [v.id]);
      await c.query('delete from vehicle_events where vehicle_id = $1', [v.id]);
      await c.query('delete from vehicles where id = $1', [v.id]);
      await audit(c, ctx, {
        module: 'veiculos',
        action: 'excluir',
        entity: 'veiculo',
        entityId: v.id,
        label: v.plate,
        changes: snapshot(v, [...EDITABLE, 'current_km', 'status']).map((x) => ({ ...x, anterior: x.novo, novo: null })),
        reason,
      });
    });
    return { ok: true };
  });
}
