import { validate } from '../validate.js';
import { badRequest, notFound, conflict } from '../http.js';
import { requirePerm } from '../permissions.js';
import { audit, diff, snapshot } from '../audit.js';
import { DRIVER_STATUS, CNH_CATEGORIES, OCCURRENCE_TYPES } from '../../shared/constants.js';

const keys = (l) => l.map((i) => i.key);

const FIELDS = {
  full_name: { type: 'string', required: true, max: 120, label: 'Nome completo' },
  cpf: { type: 'cpf', required: true, label: 'CPF' },
  cnh_number: { type: 'digits', max: 20, label: 'Número da CNH' },
  cnh_category: { type: 'enum', values: CNH_CATEGORIES, label: 'Categoria da CNH' },
  cnh_expiry: { type: 'date', label: 'Validade da CNH' },
  phone: { type: 'string', max: 30, label: 'Telefone' },
  admission_date: { type: 'date', label: 'Data de admissão' },
  notes: { type: 'text', max: 4000, label: 'Observações' },
};
const EDITABLE = Object.keys(FIELDS);

const BASE_SELECT = `
  select d.*, (d.cnh_expiry - (now() at time zone 'America/Sao_Paulo')::date) as cnh_days_left,
         v.id as vehicle_id, v.plate as vehicle_plate, v.fleet_number as vehicle_fleet, a.start_at as vehicle_since
    from drivers d
    left join driver_assignments a on a.driver_id = d.id and a.end_at is null
    left join vehicles v on v.id = a.vehicle_id`;

async function getDriver(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Motorista não encontrado.');
  const { rows } = await db.query(`${BASE_SELECT} where d.id = $1`, [id]);
  if (!rows[0]) throw notFound('Motorista não encontrado.');
  return rows[0];
}

export default function (r) {
  r.get('/drivers/options', async (ctx) => {
    const { rows } = await ctx.db.query(
      `select d.id, d.full_name, d.status, d.cnh_expiry, a.vehicle_id from drivers d
         left join driver_assignments a on a.driver_id = d.id and a.end_at is null
        where d.status <> 'inativo' or $1 order by d.full_name`,
      [ctx.query.all === '1'],
    );
    return { drivers: rows };
  });

  r.get('/drivers', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'ver');
    const q = ctx.query;
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.q) {
      const raw = `%${q.q.trim()}%`;
      const digits = q.q.replace(/\D/g, '');
      where.push(
        `(d.full_name ilike ${p(raw)} or v.plate ilike ${p(raw.toUpperCase().replace(/[-\s]/g, ''))}${digits ? ` or d.cpf like ${p(`%${digits}%`)} or d.cnh_number like ${p(`%${digits}%`)}` : ''})`,
      );
    }
    if (q.status) where.push(`d.status = ${p(q.status)}`);
    else if (q.inativos !== '1') where.push(`d.status <> 'inativo'`);
    if (q.cnh === 'vencendo') {
      where.push(`d.cnh_expiry <= (now() at time zone 'America/Sao_Paulo')::date + ${p(Number(q.dias) || 30)}::int`);
    }
    const { rows } = await ctx.db.query(
      `${BASE_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by d.full_name`,
      params,
    );
    return { drivers: rows };
  });

  r.get('/drivers/:id', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'ver');
    return { driver: await getDriver(ctx.db, ctx.params.id) };
  });

  r.get('/drivers/:id/assignments', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'ver');
    const { rows } = await ctx.db.query(
      `select a.id, a.vehicle_id, v.plate, v.fleet_number, v.model, a.start_at, a.end_at, a.start_km, a.end_km, a.notes,
              (coalesce(a.end_km, v.current_km) - a.start_km) as km_driven
         from driver_assignments a join vehicles v on v.id = a.vehicle_id
        where a.driver_id = $1 order by a.start_at desc`,
      [ctx.params.id],
    );
    return { assignments: rows };
  });

  r.get('/drivers/:id/audit', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'ver');
    const { rows } = await ctx.db.query(
      `select id, username, action, changes, reason, created_at from audit_log
        where entity = 'motorista' and entity_id = $1 order by created_at desc limit 200`,
      [ctx.params.id],
    );
    return { entries: rows };
  });

  r.post('/drivers', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'cadastrar');
    const data = validate(ctx.body, FIELDS);
    const { status } = validate(ctx.body, { status: { type: 'enum', values: keys(DRIVER_STATUS), label: 'Status' } });
    const id = await ctx.tx(async (c) => {
      const cols = [...EDITABLE, 'status', 'created_by'];
      const { rows } = await c.query(
        `insert into drivers (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        [...EDITABLE.map((k) => data[k]), status || 'ativo', ctx.user.id],
      );
      await audit(c, ctx, {
        module: 'motoristas',
        action: 'criar',
        entity: 'motorista',
        entityId: rows[0].id,
        label: data.full_name,
        changes: snapshot({ ...data, status: status || 'ativo' }),
      });
      return rows[0].id;
    });
    return { id };
  });

  r.put('/drivers/:id', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'editar');
    const data = validate(ctx.body, FIELDS, { partial: true });
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from drivers where id = $1 for update', [ctx.params.id]);
      const before = rows[0];
      if (!before) throw notFound('Motorista não encontrado.');
      const fields = Object.keys(data);
      if (!fields.length) return;
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      await c.query(`update drivers set ${sets}, updated_at = now() where id = $1`, [before.id, ...fields.map((f) => data[f])]);
      await audit(c, ctx, {
        module: 'motoristas',
        action: 'editar',
        entity: 'motorista',
        entityId: before.id,
        label: before.full_name,
        changes: diff(before, data, fields),
      });
    });
    return { ok: true };
  });

  r.post('/drivers/:id/status', async (ctx) => {
    const { status, reason } = validate(ctx.body, {
      status: { type: 'enum', values: keys(DRIVER_STATUS), required: true, label: 'Status' },
      reason: { type: 'string', max: 500, label: 'Motivo' },
    });
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from drivers where id = $1 for update', [ctx.params.id]);
      const d = rows[0];
      if (!d) throw notFound('Motorista não encontrado.');
      if (d.status === status) return;
      requirePerm(ctx.user, 'motoristas', status === 'inativo' || d.status === 'inativo' ? 'cancelar' : 'editar');
      if (status === 'inativo' && !reason) throw badRequest('Informe o motivo da inativação.');
      await c.query('update drivers set status = $2, updated_at = now() where id = $1', [d.id, status]);
      if (status === 'inativo') {
        const { rows: a } = await c.query(
          `update driver_assignments a set end_at = now(), ended_by = $2,
                  end_km = (select current_km from vehicles where id = a.vehicle_id)
            where driver_id = $1 and end_at is null returning vehicle_id`,
          [d.id, ctx.user.id],
        );
        if (a[0]) {
          await c.query(
            `insert into vehicle_events (vehicle_id, type, title, description, ref_table, ref_id, user_id)
             values ($1, 'motorista', 'Motorista desvinculado', $2, 'drivers', $3, $4)`,
            [a[0].vehicle_id, `${d.full_name} — motorista inativado`, d.id, ctx.user.id],
          );
        }
      }
      await audit(c, ctx, {
        module: 'motoristas',
        action: status === 'inativo' ? 'inativar' : 'alterar_status',
        entity: 'motorista',
        entityId: d.id,
        label: d.full_name,
        changes: [{ campo: 'status', anterior: d.status, novo: status }],
        reason,
      });
    });
    return { ok: true };
  });

  r.del('/drivers/:id', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'excluir');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo da exclusão.');
    await ctx.tx(async (c) => {
      const { rows } = await c.query('select * from drivers where id = $1 for update', [ctx.params.id]);
      const d = rows[0];
      if (!d) throw notFound('Motorista não encontrado.');
      const { rows: refs } = await c.query(
        `select (select count(*) from driver_assignments where driver_id = $1)
              + (select count(*) from driver_occurrences where driver_id = $1) as n`,
        [d.id],
      );
      if (refs[0].n > 0) {
        throw conflict('Este motorista possui histórico (veículos ou ocorrências). Use Inativar em vez de excluir.', {
          code: 'VINCULADO',
        });
      }
      await c.query(`update attachments set deleted_at = now(), deleted_by = $2 where entity = 'driver' and entity_id = $1`, [
        d.id,
        ctx.user.id,
      ]);
      await c.query('delete from drivers where id = $1', [d.id]);
      await audit(c, ctx, {
        module: 'motoristas',
        action: 'excluir',
        entity: 'motorista',
        entityId: d.id,
        label: d.full_name,
        changes: snapshot(d, [...EDITABLE, 'status']).map((x) => ({ ...x, anterior: x.novo, novo: null })),
        reason,
      });
    });
    return { ok: true };
  });

  // ----- Ocorrências -----
  r.get('/drivers/:id/occurrences', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'ver');
    const { rows } = await ctx.db.query(
      `select o.*, v.plate, u.username as created_by_name, cu.username as cancelled_by_name
         from driver_occurrences o
         left join vehicles v on v.id = o.vehicle_id
         left join users u on u.id = o.created_by
         left join users cu on cu.id = o.cancelled_by
        where o.driver_id = $1 order by o.occurred_on desc, o.created_at desc`,
      [ctx.params.id],
    );
    return { occurrences: rows };
  });

  r.post('/drivers/:id/occurrences', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'editar');
    const data = validate(ctx.body, {
      occurred_on: { type: 'date', required: true, label: 'Data' },
      type: { type: 'enum', values: keys(OCCURRENCE_TYPES), required: true, label: 'Tipo' },
      description: { type: 'text', required: true, max: 2000, label: 'Descrição' },
      vehicle_id: { type: 'uuid', label: 'Veículo' },
    });
    const d = await getDriver(ctx.db, ctx.params.id);
    const id = await ctx.tx(async (c) => {
      const { rows } = await c.query(
        `insert into driver_occurrences (driver_id, vehicle_id, occurred_on, type, description, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [d.id, data.vehicle_id, data.occurred_on, data.type, data.description, ctx.user.id],
      );
      if (data.vehicle_id) {
        await c.query(
          `insert into vehicle_events (vehicle_id, event_at, type, title, description, ref_table, ref_id, user_id)
           values ($1, $2::date + time '12:00', 'ocorrencia', $3, $4, 'driver_occurrences', $5, $6)`,
          [
            data.vehicle_id,
            data.occurred_on,
            `Ocorrência: ${OCCURRENCE_TYPES.find((t) => t.key === data.type).label}`,
            `${d.full_name} — ${data.description}`,
            rows[0].id,
            ctx.user.id,
          ],
        );
      }
      await audit(c, ctx, {
        module: 'motoristas',
        action: 'registrar_ocorrencia',
        entity: 'motorista',
        entityId: d.id,
        label: d.full_name,
        changes: snapshot(data),
      });
      return rows[0].id;
    });
    return { id };
  });

  r.post('/occurrences/:id/cancel', async (ctx) => {
    requirePerm(ctx.user, 'motoristas', 'cancelar');
    const reason = String(ctx.body?.reason ?? '').trim();
    if (reason.length < 5) throw badRequest('Informe o motivo do cancelamento.');
    await ctx.tx(async (c) => {
      const { rows } = await c.query(
        `update driver_occurrences set cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
          where id = $1 and cancelled_at is null returning driver_id, description`,
        [ctx.params.id, ctx.user.id, reason],
      );
      if (!rows[0]) throw notFound('Ocorrência não encontrada ou já cancelada.');
      await audit(c, ctx, {
        module: 'motoristas',
        action: 'cancelar_ocorrencia',
        entity: 'motorista',
        entityId: rows[0].driver_id,
        label: rows[0].description.slice(0, 80),
        reason,
      });
    });
    return { ok: true };
  });
}
